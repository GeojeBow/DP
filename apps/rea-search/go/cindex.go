package main

// Content index for folders the user chooses, built for hundreds of
// thousands of files.
//
// Reading every file for every search does not scale, so folders that are
// searched often can get a content index:
//
//   - Bigram (two-character) inverted index: every pair of adjacent
//     characters points to the documents containing it. Bigrams work for
//     Korean, where words carry particles (보고서를, 보고서는) and splitting on
//     spaces would miss matches. A search term's bigrams are intersected to get
//     a short candidate list; only those files are opened to confirm the match
//     and cut snippets. No copy of the text is kept, so the index stays small
//     and results always reflect the file as it is now.
//   - The index lives on disk in segments, like a search engine: documents
//     are indexed in batches, each batch is written as one immutable segment
//     (sorted bigram dictionary + delta/varint-compressed postings), and
//     segments are merged when there are too many. Memory use stays flat no
//     matter how many files are indexed; a lookup is a binary search through a
//     small in-memory sample of each dictionary plus one disk read.
//   - Indexing runs in the background on all CPU cores and resumes after a
//     restart. Changes are picked up from the NTFS change journal (or a
//     periodic folder walk) and only changed files are re-read.

import (
	"bufio"
	"encoding/binary"
	"encoding/gob"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"
)

const (
	segMagic      = "RSG1"
	segEntry      = 20 // gram u64, postings offset u64, count u32
	sampleEvery   = 128
	flushDocs     = 2000
	flushPostings = 6_000_000
	mergeAt       = 12 // merge when there are more segments than this
)

type CDoc struct {
	Path      string
	Size, Mod int64
	Dead      bool
}

// ---- segment (immutable, on disk) ----

type segment struct {
	Name   string
	f      *os.File
	n      int
	sample []uint64 // every sampleEvery-th gram
}

func openSegment(dir, name string) (*segment, error) {
	f, err := os.Open(filepath.Join(dir, name))
	if err != nil {
		return nil, err
	}
	hdr := make([]byte, 8)
	if _, err := f.ReadAt(hdr, 0); err != nil || string(hdr[:4]) != segMagic {
		f.Close()
		return nil, fmt.Errorf("bad segment %s", name)
	}
	s := &segment{Name: name, f: f, n: int(binary.LittleEndian.Uint32(hdr[4:]))}
	// read the dictionary once, keeping only a sample of grams
	r := bufio.NewReaderSize(io.NewSectionReader(f, 8, int64(s.n)*segEntry), 1<<16)
	e := make([]byte, segEntry)
	for i := 0; i < s.n; i++ {
		if _, err := io.ReadFull(r, e); err != nil {
			f.Close()
			return nil, err
		}
		if i%sampleEvery == 0 {
			s.sample = append(s.sample, binary.LittleEndian.Uint64(e))
		}
	}
	return s, nil
}

func (s *segment) entry(i int) (gram, off uint64, cnt uint32) {
	e := make([]byte, segEntry)
	s.f.ReadAt(e, 8+int64(i)*segEntry)
	le := binary.LittleEndian
	return le.Uint64(e), le.Uint64(e[8:]), le.Uint32(e[16:])
}

// postings returns the sorted doc ids containing gram.
func (s *segment) postings(gram uint64) []uint32 {
	if s.n == 0 {
		return nil
	}
	b := sort.Search(len(s.sample), func(i int) bool { return s.sample[i] > gram }) - 1
	if b < 0 {
		return nil
	}
	lo := b * sampleEvery
	hi := min(lo+sampleEvery, s.n)
	block := make([]byte, (hi-lo)*segEntry)
	if _, err := s.f.ReadAt(block, 8+int64(lo)*segEntry); err != nil && err != io.EOF {
		return nil
	}
	le := binary.LittleEndian
	j := sort.Search(hi-lo, func(i int) bool { return le.Uint64(block[i*segEntry:]) >= gram })
	if j == hi-lo || le.Uint64(block[j*segEntry:]) != gram {
		return nil
	}
	off := le.Uint64(block[j*segEntry+8:])
	cnt := le.Uint32(block[j*segEntry+16:])
	return s.readPostings(off, cnt)
}

func (s *segment) readPostings(off uint64, cnt uint32) []uint32 {
	r := bufio.NewReaderSize(io.NewSectionReader(s.f, int64(off), 1<<40), 4096)
	out := make([]uint32, 0, cnt)
	var prev uint64
	for i := uint32(0); i < cnt; i++ {
		d, err := binary.ReadUvarint(r)
		if err != nil {
			break
		}
		prev += d
		out = append(out, uint32(prev))
	}
	return out
}

// writeSegment writes grams (sorted) with their postings lists.
func writeSegment(path string, grams []uint64, lists func(i int) []uint32) error {
	tmp := path + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	w := bufio.NewWriterSize(f, 1<<20)
	le := binary.LittleEndian
	hdr := make([]byte, 8)
	copy(hdr, segMagic)
	le.PutUint32(hdr[4:], uint32(len(grams)))
	w.Write(hdr)
	// postings go after the dictionary; compute offsets first
	encoded := make([][]byte, len(grams))
	off := uint64(8 + len(grams)*segEntry)
	e := make([]byte, segEntry)
	var vb [binary.MaxVarintLen64]byte
	for i, g := range grams {
		var buf []byte
		var prev uint32
		l := lists(i)
		for _, id := range l {
			n := binary.PutUvarint(vb[:], uint64(id-prev))
			buf = append(buf, vb[:n]...)
			prev = id
		}
		encoded[i] = buf
		le.PutUint64(e, g)
		le.PutUint64(e[8:], off)
		le.PutUint32(e[16:], uint32(len(l)))
		w.Write(e)
		off += uint64(len(buf))
	}
	for _, b := range encoded {
		w.Write(b)
	}
	if err := w.Flush(); err != nil {
		f.Close()
		return err
	}
	f.Close()
	return os.Rename(tmp, path)
}

// ---- index ----

type CIndex struct {
	mu      sync.RWMutex
	dir     string
	Folders []string
	docs    []CDoc
	flushed int // docs[:flushed] are covered by segments
	byPath  map[string]uint32
	segs    []*segment
	pending map[uint64][]uint32 // postings of docs not yet in a segment
	pendN   int
	nextSeg int

	dirtyMu sync.Mutex
	dirty   map[string]bool // paths reported changed by the change journal

	smu    sync.Mutex
	status string
	busy   bool
	walked time.Time
}

type cindexDisk struct {
	Folders  []string
	Docs     []CDoc
	Segments []string
	NextSeg  int
}

func OpenCIndex(dir string) *CIndex {
	c := &CIndex{dir: dir, byPath: map[string]uint32{}, pending: map[uint64][]uint32{}, dirty: map[string]bool{}}
	os.MkdirAll(dir, 0o755)
	keep := map[string]bool{"content.gob": true}
	if f, err := os.Open(filepath.Join(dir, "content.gob")); err == nil {
		var d cindexDisk
		if gob.NewDecoder(f).Decode(&d) == nil {
			c.Folders, c.docs, c.nextSeg = d.Folders, d.Docs, d.NextSeg
			for _, name := range d.Segments {
				if s, err := openSegment(dir, name); err == nil {
					c.segs = append(c.segs, s)
					keep[name] = true
				}
			}
			c.flushed = len(c.docs)
			for i, doc := range c.docs {
				if !doc.Dead {
					c.byPath[strings.ToLower(doc.Path)] = uint32(i)
				}
			}
		}
		f.Close()
	}
	// remove segments left over from an interrupted write or merge
	if ents, err := os.ReadDir(dir); err == nil {
		for _, e := range ents {
			if !keep[e.Name()] {
				os.Remove(filepath.Join(dir, e.Name()))
			}
		}
	}
	return c
}

// saveLocked writes the document table; caller holds c.mu (read is enough).
func (c *CIndex) saveLocked() error {
	d := cindexDisk{Folders: c.Folders, Docs: c.docs[:c.flushed], NextSeg: c.nextSeg}
	for _, s := range c.segs {
		d.Segments = append(d.Segments, s.Name)
	}
	tmp := filepath.Join(c.dir, "content.gob.tmp")
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	w := bufio.NewWriterSize(f, 1<<20)
	err = gob.NewEncoder(w).Encode(&d)
	if err == nil {
		err = w.Flush()
	}
	f.Close()
	if err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(c.dir, "content.gob"))
}

type CIndexStatus struct {
	Folders  []string `json:"folders"`
	Docs     int      `json:"docs"`
	Segments int      `json:"segments"`
	Status   string   `json:"status"`
	Busy     bool     `json:"busy"`
}

func (c *CIndex) Status() CIndexStatus {
	c.mu.RLock()
	st := CIndexStatus{Folders: append([]string{}, c.Folders...), Docs: len(c.byPath), Segments: len(c.segs)}
	c.mu.RUnlock()
	c.smu.Lock()
	st.Status, st.Busy = c.status, c.busy
	c.smu.Unlock()
	return st
}

func (c *CIndex) setStatus(s string) {
	c.smu.Lock()
	c.status = s
	c.smu.Unlock()
}

func (c *CIndex) HasFolders() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.Folders) > 0
}

func (c *CIndex) AddFolder(p string) error {
	p = filepath.Clean(p)
	if st, err := os.Stat(p); err != nil || !st.IsDir() {
		return fmt.Errorf("폴더를 찾을 수 없습니다: %s", p)
	}
	c.mu.Lock()
	for _, f := range c.Folders {
		if strings.EqualFold(f, p) || underAny(p, []string{f}) {
			c.mu.Unlock()
			return nil // already covered
		}
	}
	c.Folders = append(c.Folders, p)
	c.saveLocked()
	c.mu.Unlock()
	c.walkSoon()
	return nil
}

func (c *CIndex) RemoveFolder(p string) {
	c.mu.Lock()
	var keep []string
	for _, f := range c.Folders {
		if !strings.EqualFold(f, p) {
			keep = append(keep, f)
		}
	}
	c.Folders = keep
	c.saveLocked()
	c.mu.Unlock()
	c.walkSoon()
}

// walkSoon asks for a full folder check now, or right after the current one.
func (c *CIndex) walkSoon() {
	c.smu.Lock()
	c.walked = time.Time{}
	c.smu.Unlock()
	go c.Refresh(true)
}

func (c *CIndex) walkDue(every time.Duration) bool {
	c.smu.Lock()
	defer c.smu.Unlock()
	return time.Since(c.walked) > every
}

func underAny(p string, folders []string) bool {
	lp := strings.ToLower(p)
	for _, f := range folders {
		lf := strings.TrimRight(strings.ToLower(f), `\/`)
		if lp == lf || strings.HasPrefix(lp, lf+`\`) || strings.HasPrefix(lp, lf+"/") {
			return true
		}
	}
	return false
}

// Notify is called with paths the change journal reports as changed.
func (c *CIndex) Notify(p string) {
	c.mu.RLock()
	in := underAny(p, c.Folders)
	c.mu.RUnlock()
	if !in {
		return
	}
	c.dirtyMu.Lock()
	c.dirty[p] = true
	c.dirtyMu.Unlock()
}

type ctask struct {
	path      string
	size, mod int64
}

// Refresh brings the index in line with the disk. full walks every folder;
// otherwise only paths reported by Notify are checked.
func (c *CIndex) Refresh(full bool) {
	c.smu.Lock()
	if c.busy {
		c.smu.Unlock()
		return
	}
	c.busy = true
	c.smu.Unlock()
	defer func() {
		c.smu.Lock()
		c.busy = false
		c.smu.Unlock()
	}()

	c.mu.RLock()
	folders := append([]string{}, c.Folders...)
	c.mu.RUnlock()

	var work []ctask
	removed := 0
	check := func(p string, size, mod int64) {
		c.mu.RLock()
		i, ok := c.byPath[strings.ToLower(p)]
		fresh := ok && c.docs[i].Size == size && c.docs[i].Mod == mod
		c.mu.RUnlock()
		if !fresh {
			work = append(work, ctask{p, size, mod})
		}
	}
	indexable := func(name string, size int64) bool {
		kind := contentKind(name)
		return kind != "" && size <= maxFileBytes && !(kind == "sniff" && size > 4<<20)
	}

	if full {
		c.smu.Lock()
		c.walked = time.Now() // a request arriving from here on triggers another walk
		c.smu.Unlock()
		c.setStatus("내용 색인: 폴더 확인 중...")
		seen := map[string]bool{}
		n := 0
		for _, root := range folders {
			filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
				if err != nil || d.IsDir() {
					return nil
				}
				if n++; n%5000 == 0 {
					c.setStatus(fmt.Sprintf("내용 색인: 폴더 확인 중... %d개", n))
				}
				info, err := d.Info()
				if err != nil || !indexable(d.Name(), info.Size()) {
					return nil
				}
				seen[strings.ToLower(p)] = true
				check(p, info.Size(), info.ModTime().Unix())
				return nil
			})
		}
		c.mu.Lock()
		for lp, i := range c.byPath {
			if !seen[lp] {
				c.docs[i].Dead = true
				delete(c.byPath, lp)
				removed++
			}
		}
		c.mu.Unlock()
		c.dirtyMu.Lock()
		c.dirty = map[string]bool{}
		c.dirtyMu.Unlock()
	} else {
		c.dirtyMu.Lock()
		paths := c.dirty
		c.dirty = map[string]bool{}
		c.dirtyMu.Unlock()
		for p := range paths {
			info, err := os.Stat(p)
			if err != nil || info.IsDir() || !indexable(info.Name(), info.Size()) || !underAny(p, folders) {
				c.mu.Lock()
				if i, ok := c.byPath[strings.ToLower(p)]; ok {
					c.docs[i].Dead = true
					delete(c.byPath, strings.ToLower(p))
					removed++
				}
				c.mu.Unlock()
				continue
			}
			check(p, info.Size(), info.ModTime().Unix())
		}
	}

	c.indexFiles(work)
	c.mu.Lock()
	c.flushLocked()
	if removed > 0 || len(work) > 0 {
		c.saveLocked()
	}
	c.mu.Unlock()
	c.maybeMerge()
	st := c.Status()
	if len(folders) == 0 {
		c.setStatus("")
	} else {
		c.setStatus(fmt.Sprintf("내용 색인 완료: 파일 %d개", st.Docs))
	}
}

// indexFiles extracts text on all cores and adds the documents.
func (c *CIndex) indexFiles(work []ctask) {
	if len(work) == 0 {
		return
	}
	type done struct {
		t     ctask
		grams []uint64
	}
	in := make(chan ctask)
	out := make(chan done, 64)
	var wg sync.WaitGroup
	for w := 0; w < runtime.NumCPU(); w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for t := range in {
				text, _ := ExtractText(t.path) // unreadable files are recorded with no text
				out <- done{t, uniqueGrams(text)}
			}
		}()
	}
	go func() {
		for _, t := range work {
			in <- t
		}
		close(in)
		wg.Wait()
		close(out)
	}()
	start := time.Now()
	n := 0
	for d := range out {
		c.mu.Lock()
		c.addLocked(d.t, d.grams)
		c.mu.Unlock()
		if n++; n%50 == 0 {
			rate := float64(n) / time.Since(start).Seconds()
			left := time.Duration(float64(len(work)-n)/rate) * time.Second
			c.setStatus(fmt.Sprintf("내용 색인 중... %d / %d (남은 시간 약 %s)", n, len(work), left.Round(time.Second)))
		}
	}
}

func uniqueGrams(text string) []uint64 {
	if text == "" {
		return nil
	}
	set := map[uint64]struct{}{}
	bigrams(strings.ToLower(text), func(g uint64) { set[g] = struct{}{} })
	out := make([]uint64, 0, len(set))
	for g := range set {
		out = append(out, g)
	}
	return out
}

func bigrams(lower string, fn func(uint64)) {
	var prev rune = -1
	for _, r := range lower {
		if unicode.IsSpace(r) || unicode.IsControl(r) {
			prev = -1
			continue
		}
		if prev >= 0 {
			fn(uint64(prev)<<32 | uint64(r))
		}
		prev = r
	}
}

func (c *CIndex) addLocked(t ctask, grams []uint64) {
	lp := strings.ToLower(t.path)
	if old, ok := c.byPath[lp]; ok {
		c.docs[old].Dead = true
	}
	id := uint32(len(c.docs))
	c.docs = append(c.docs, CDoc{Path: t.path, Size: t.size, Mod: t.mod})
	c.byPath[lp] = id
	for _, g := range grams {
		c.pending[g] = append(c.pending[g], id)
	}
	c.pendN += len(grams)
	if len(c.docs)-c.flushed >= flushDocs || c.pendN >= flushPostings {
		c.flushLocked()
		c.saveLocked()
	}
}

// flushLocked writes pending postings as a new segment.
func (c *CIndex) flushLocked() {
	if c.flushed == len(c.docs) {
		return
	}
	if len(c.pending) > 0 {
		grams := make([]uint64, 0, len(c.pending))
		for g := range c.pending {
			grams = append(grams, g)
		}
		sort.Slice(grams, func(i, j int) bool { return grams[i] < grams[j] })
		name := fmt.Sprintf("seg%06d.idx", c.nextSeg)
		c.nextSeg++
		if err := writeSegment(filepath.Join(c.dir, name), grams, func(i int) []uint32 { return c.pending[grams[i]] }); err != nil {
			logf("내용 색인 저장 실패: %v", err)
			return
		}
		s, err := openSegment(c.dir, name)
		if err != nil {
			logf("내용 색인 열기 실패: %v", err)
			return
		}
		c.segs = append(c.segs, s)
	}
	c.pending, c.pendN = map[uint64][]uint32{}, 0
	c.flushed = len(c.docs)
}

// maybeMerge combines all segments into one, dropping deleted documents.
// Postings of older segments come first, so lists stay sorted.
func (c *CIndex) maybeMerge() {
	c.mu.RLock()
	if len(c.segs) <= mergeAt {
		c.mu.RUnlock()
		return
	}
	segs := append([]*segment{}, c.segs...)
	dead := make([]bool, len(c.docs))
	for i, d := range c.docs {
		dead[i] = d.Dead
	}
	name := fmt.Sprintf("seg%06d.idx", c.nextSeg)
	c.mu.RUnlock()
	c.setStatus("내용 색인 정리 중...")

	// k-way merge of the sorted dictionaries
	type cursor struct {
		s    *segment
		i    int
		gram uint64
		off  uint64
		cnt  uint32
	}
	var curs []*cursor
	for _, s := range segs {
		if s.n > 0 {
			g, o, n := s.entry(0)
			curs = append(curs, &cursor{s, 0, g, o, n})
		}
	}
	var grams []uint64
	var lists [][]uint32
	for len(curs) > 0 {
		minG := curs[0].gram
		for _, k := range curs {
			minG = min(minG, k.gram)
		}
		var l []uint32
		next := curs[:0]
		for _, k := range curs {
			if k.gram == minG {
				for _, id := range k.s.readPostings(k.off, k.cnt) {
					if int(id) < len(dead) && !dead[id] {
						l = append(l, id)
					}
				}
				k.i++
				if k.i < k.s.n {
					k.gram, k.off, k.cnt = k.s.entry(k.i)
				} else {
					continue
				}
			}
			next = append(next, k)
		}
		curs = next
		if len(l) > 0 {
			grams = append(grams, minG)
			lists = append(lists, l)
		}
	}
	if err := writeSegment(filepath.Join(c.dir, name), grams, func(i int) []uint32 { return lists[i] }); err != nil {
		logf("내용 색인 병합 실패: %v", err)
		return
	}
	merged, err := openSegment(c.dir, name)
	if err != nil {
		return
	}
	c.mu.Lock()
	c.nextSeg++
	// keep segments written while merging
	var rest []*segment
	for _, s := range c.segs {
		old := false
		for _, o := range segs {
			old = old || o == s
		}
		if !old {
			rest = append(rest, s)
		}
	}
	c.segs = append([]*segment{merged}, rest...)
	c.saveLocked()
	c.mu.Unlock()
	for _, s := range segs {
		s.f.Close()
		os.Remove(filepath.Join(c.dir, s.Name))
	}
}

// postings across all segments and pending docs, sorted.
func (c *CIndex) postingsLocked(gram uint64) []uint32 {
	var out []uint32
	for _, s := range c.segs {
		out = append(out, s.postings(gram)...)
	}
	out = append(out, c.pending[gram]...)
	return out
}

// Candidates returns the indexed documents that may match, or ok=false when
// the index cannot narrow the query (regex, or a one-character term).
func (c *CIndex) Candidates(q *CQuery) (set map[uint32]bool, ok bool) {
	if q.opts.Regex {
		return nil, false
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	set = map[uint32]bool{}
	for _, g := range q.groups {
		var cur []uint32
		narrowed := false
		for _, t := range g {
			if t.neg {
				continue
			}
			bigrams(strings.ToLower(t.text), func(x uint64) {
				l := c.postingsLocked(x)
				if !narrowed {
					cur, narrowed = l, true
				} else {
					cur = intersect(cur, l)
				}
			})
		}
		if !narrowed {
			return nil, false
		}
		for _, id := range cur {
			set[id] = true
		}
	}
	return set, true
}

// Lookup reports whether a path is indexed, and its doc id.
func (c *CIndex) Lookup(p string) (uint32, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	id, ok := c.byPath[strings.ToLower(p)]
	return id, ok
}

func intersect(a, b []uint32) []uint32 {
	out := make([]uint32, 0, min(len(a), len(b)))
	i, j := 0, 0
	for i < len(a) && j < len(b) {
		switch {
		case a[i] == b[j]:
			out = append(out, a[i])
			i++
			j++
		case a[i] < b[j]:
			i++
		default:
			j++
		}
	}
	return out
}

// Run keeps the index current: changed paths every 20 seconds, and a full
// folder check at start and every walkEvery.
func (c *CIndex) Run(walkEvery time.Duration) {
	defer recoverLog("content index")
	c.Refresh(true)
	for range time.Tick(20 * time.Second) {
		full := c.walkDue(walkEvery)
		c.dirtyMu.Lock()
		hasDirty := len(c.dirty) > 0
		c.dirtyMu.Unlock()
		if full || hasDirty {
			c.Refresh(full)
		}
	}
}

// Close writes pending documents so nothing indexed is lost on exit.
func (c *CIndex) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.flushLocked()
	c.saveLocked()
}
