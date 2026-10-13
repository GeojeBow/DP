package main

import (
	"archive/zip"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"golang.org/x/text/encoding/korean"
)

func TestOptionsCaseRegexPath(t *testing.T) {
	ix := sample()
	eq(t, namesOpt(ix, "Report", NameOpts{Case: true}), []string{"Report 2026.docx"})
	eq(t, namesOpt(ix, `^(cat|dog)\.`, NameOpts{Regex: true}), []string{"cat.jpg", "dog.png"})
	eq(t, namesOpt(ix, "pictures", NameOpts{Path: true}), []string{"cat.jpg", "dog.png", "Pictures"})
	if _, err := ParseQueryOpts("([", NameOpts{Regex: true}); err == nil {
		t.Fatal("bad regex accepted")
	}
}

func namesOpt(ix *Index, q string, o NameOpts) []string {
	out := []string{}
	for _, k := range ix.SearchOpts(q, o) {
		n, _, _ := ix.Node(k)
		out = append(out, n)
	}
	return out
}

func TestStateRoundTrip(t *testing.T) {
	ix := sample()
	ix.Upsert(100, 5, "bird.gif", false)
	ix2 := IndexFromState(ix.State())
	eq(t, names(ix2, "bird | cat"), []string{"bird.gif", "cat.jpg"})
	if p := ix2.Path(100); p != `C:\Pictures\bird.gif` {
		t.Fatalf("path %q", p)
	}
}

// tree builds a small folder with known sizes and dates.
func tree(t *testing.T) string {
	d := t.TempDir()
	write := func(rel string, size int, age time.Duration) {
		p := filepath.Join(d, rel)
		os.MkdirAll(filepath.Dir(p), 0o755)
		os.WriteFile(p, []byte(strings.Repeat("x", size)), 0o644)
		tm := time.Now().Add(-age)
		os.Chtimes(p, tm, tm)
	}
	write("docs/a.txt", 10, time.Hour)
	write("docs/b.pdf", 5000, 48*time.Hour)
	write("pics/a.jpg", 300, 24*time.Hour*40)
	write("pics/copy/a.jpg", 300, time.Hour)
	write("music/song.mp3", 9000, time.Hour)
	return d
}

func walkView(t *testing.T, d string) *View {
	b := NewBuilder()
	walkInto(b, []string{d}, 2<<56, nil)
	return NewView([]*Index{b.Build(nil)}, []uint64{2})
}

func TestFiltersSortDuplicates(t *testing.T) {
	v := walkView(t, tree(t))
	all := v.Search("")
	f := Facets(v, all)
	if f["image"] != 2 || f["doc"] != 2 || f["audio"] != 1 || f["folder"] < 4 {
		t.Fatalf("facets %v", f)
	}
	nm := func(keys []uint64) []string {
		out := []string{}
		for _, k := range keys {
			n, _, _ := v.Node(k)
			out = append(out, n)
		}
		return out
	}
	got, _ := Apply(v, all, Filter{Category: "image", MinSize: -1, MaxSize: -1}, nil)
	eq(t, nm(got), []string{"a.jpg", "a.jpg"})
	got, _ = Apply(v, all, Filter{MinSize: 1000, MaxSize: -1, Sort: "size", Desc: true}, nil)
	eq(t, nm(got), []string{"song.mp3", "b.pdf"})
	got, _ = Apply(v, all, Filter{MinSize: -1, MaxSize: -1, After: time.Now().Add(-2 * time.Hour).Unix()}, nil)
	for _, n := range nm(got) {
		if n == "b.pdf" || n == "a.jpg" && len(got) > 10 {
			t.Fatalf("date filter kept %s", n)
		}
	}
	dups, groups := Duplicates(v, all, nil)
	if len(dups) != 2 || groups[dups[0]] != 1 || groups[dups[1]] != 1 {
		t.Fatalf("duplicates %v %v", nm(dups), groups)
	}
}

func TestViewMergesSorted(t *testing.T) {
	a := NewBuilder()
	a.AddRoot(1, "C:")
	a.Add(2, 1, "banana.txt", false)
	a.Add(3, 1, "date.txt", false)
	b := NewBuilder()
	b.AddRoot(2<<56|1, `\\server\share`)
	b.Add(2<<56|2, 2<<56|1, "apple.txt", false)
	b.Add(2<<56|3, 2<<56|1, "cherry.txt", false)
	v := NewView([]*Index{a.Build(nil), b.Build(nil)}, []uint64{0, 2})
	got := []string{}
	for _, k := range v.Search(".txt") {
		n, _, _ := v.Node(k)
		got = append(got, n)
	}
	eq(t, got, []string{"apple.txt", "banana.txt", "cherry.txt", "date.txt"})
	if p := v.Path(2<<56 | 2); p != `\\server\share\apple.txt` {
		t.Fatalf("network path %q", p)
	}
}

func TestContentQuery(t *testing.T) {
	text := "1분기 회의록\n예산 보고서를 검토했다\nBudget review: FINAL\n취소된 안건"
	cases := []struct {
		q    string
		o    CQOpts
		want bool
	}{
		{"보고서 예산", CQOpts{}, true},
		{"보고서 휴가", CQOpts{}, false},
		{"휴가 | budget", CQOpts{}, true},
		{"예산 !취소", CQOpts{}, false},
		{"예산 -휴가", CQOpts{}, true},
		{`"budget review"`, CQOpts{}, true},
		{"final", CQOpts{Case: true}, false},
		{"FINAL", CQOpts{Case: true}, true},
		{"view", CQOpts{Word: true}, false},
		{"review", CQOpts{Word: true}, true},
		{`보고서[를는]`, CQOpts{Regex: true}, true},
		{"회의 OR 휴가", CQOpts{}, true},
	}
	for _, c := range cases {
		q, err := ParseContentQuery(c.q, c.o)
		if err != nil {
			t.Fatal(err)
		}
		if got := q.Match(q.prep(text)); got != c.want {
			t.Errorf("%q %+v: got %v", c.q, c.o, got)
		}
	}
	q, _ := ParseContentQuery("보고서", CQOpts{})
	snips, n := q.Snippets(text, 3)
	if n != 1 || snips[0].Line != 2 {
		t.Fatalf("snippets %+v %d", snips, n)
	}
	var marked []string
	for _, s := range snips[0].Segs {
		if s.M {
			marked = append(marked, s.T)
		}
	}
	eq(t, marked, []string{"보고서"})
}

func writeZip(t *testing.T, p string, files map[string]string) {
	f, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(f)
	for name, body := range files {
		w, _ := zw.Create(name)
		w.Write([]byte(body))
	}
	zw.Close()
	f.Close()
}

func TestExtract(t *testing.T) {
	d := t.TempDir()
	writeZip(t, filepath.Join(d, "a.docx"), map[string]string{
		"word/document.xml": `<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>분기 실적</w:t></w:r></w:p><w:p><w:r><w:t>둘째 줄</w:t></w:r></w:p></w:body></w:document>`})
	writeZip(t, filepath.Join(d, "b.xlsx"), map[string]string{
		"xl/sharedStrings.xml":     `<sst><si><t>매출</t></si><si><t>비용</t></si></sst>`,
		"xl/worksheets/sheet1.xml": `<worksheet><sheetData><row><c t="s"><v>0</v></c><c><v>12345</v></c></row></sheetData></worksheet>`})
	writeZip(t, filepath.Join(d, "c.hwpx"), map[string]string{
		"Contents/section0.xml": `<hs:sec xmlns:hs="h" xmlns:hp="p"><hp:p><hp:run><hp:t>한글 문서 내용</hp:t></hp:run></hp:p></hs:sec>`})
	euckr, _ := korean.EUCKR.NewEncoder().Bytes([]byte("옛날 인코딩 파일"))
	os.WriteFile(filepath.Join(d, "d.txt"), euckr, 0o644)
	os.WriteFile(filepath.Join(d, "e.bin.dat"), []byte{0, 1, 2, 3}, 0o644)
	want := map[string]string{"a.docx": "분기 실적\n둘째 줄", "b.xlsx": "매출", "c.hwpx": "한글 문서 내용", "d.txt": "옛날 인코딩 파일"}
	for f, w := range want {
		got, err := ExtractText(filepath.Join(d, f))
		if err != nil || !strings.Contains(got, w) {
			t.Errorf("%s: %q %v", f, got, err)
		}
	}
	if got, _ := ExtractText(filepath.Join(d, "b.xlsx")); strings.Contains(got, "0\t") && !strings.Contains(got, "12345") {
		t.Errorf("xlsx shared index leaked: %q", got)
	}
	if _, err := ExtractText(filepath.Join(d, "e.bin.dat")); err == nil {
		t.Error("binary file was read as text")
	}
}

func TestContentIndex(t *testing.T) {
	src := t.TempDir()
	for i := 0; i < 30; i++ {
		body := fmt.Sprintf("문서 %d 일반 내용", i)
		if i%10 == 3 {
			body += "\n비밀 프로젝트 보고서를 첨부합니다"
		}
		os.WriteFile(filepath.Join(src, fmt.Sprintf("f%02d.txt", i)), []byte(body), 0o644)
	}
	dir := t.TempDir()
	c := OpenCIndex(dir)
	c.AddFolder(src)
	waitIdle(c)
	q, _ := ParseContentQuery("프로젝트 보고서", CQOpts{})
	set, ok := c.Candidates(q)
	if !ok || len(set) != 3 {
		t.Fatalf("candidates %v %v", set, ok)
	}
	// change a file, delete another, reopen from disk
	os.WriteFile(filepath.Join(src, "f05.txt"), []byte("이제 비밀 프로젝트 보고서 포함"), 0o644)
	os.Chtimes(filepath.Join(src, "f05.txt"), time.Now().Add(time.Minute), time.Now().Add(time.Minute))
	os.Remove(filepath.Join(src, "f03.txt"))
	c.Refresh(true)
	c.Close()
	c2 := OpenCIndex(dir)
	set, _ = c2.Candidates(q)
	got := []string{}
	for id := range set {
		if c2.docs[id].Dead {
			continue
		}
		got = append(got, filepath.Base(c2.docs[id].Path))
	}
	sortStrings(got)
	eq(t, got, []string{"f05.txt", "f13.txt", "f23.txt"})
	if !reflect.DeepEqual(c2.Folders, []string{src}) {
		t.Fatal("folders not saved")
	}
}

func TestContentIndexSegmentsMerge(t *testing.T) {
	src := t.TempDir()
	for i := 0; i < 40; i++ {
		os.WriteFile(filepath.Join(src, fmt.Sprintf("n%02d.md", i)), []byte(fmt.Sprintf("공통 단어 고유%02d", i)), 0o644)
	}
	c := OpenCIndex(t.TempDir())
	c.Folders = []string{src}
	// force tiny segments to exercise flushing and merging
	for i := 0; i < 40; i++ {
		p := filepath.Join(src, fmt.Sprintf("n%02d.md", i))
		text, _ := ExtractText(p)
		c.mu.Lock()
		c.addLocked(ctask{p, 1, int64(i)}, uniqueGrams(text))
		c.flushLocked()
		c.mu.Unlock()
	}
	if len(c.segs) != 40 {
		t.Fatalf("segments %d", len(c.segs))
	}
	c.maybeMerge()
	if len(c.segs) != 1 {
		t.Fatalf("after merge %d segments", len(c.segs))
	}
	for _, term := range []string{"공통 단어", "고유17"} {
		q, _ := ParseContentQuery(term, CQOpts{})
		set, _ := c.Candidates(q)
		want := 40
		if term == "고유17" {
			want = 1
		}
		if len(set) != want {
			t.Fatalf("%s: %d candidates", term, len(set))
		}
	}
}

func waitIdle(c *CIndex) {
	time.Sleep(50 * time.Millisecond)
	for i := 0; i < 200; i++ {
		if st := c.Status(); !st.Busy {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
}

func sortStrings(s []string) {
	for i := range s {
		for j := i + 1; j < len(s); j++ {
			if s[j] < s[i] {
				s[i], s[j] = s[j], s[i]
			}
		}
	}
}

func TestExtractOldFormatsAndPDF(t *testing.T) {
	cases := map[string][]string{
		"testdata/sample.doc":        {"분기 실적 보고서", "회의 예산은 Budget 2026 apple", "셀하나\t셀둘"},
		"testdata/sample.xls":        {"사과", "회의예산"},
		"testdata/sample-office.pdf": {"분기 실적 보고서", "회의 예산은 Budget 2026 apple"},
		"testdata/sample-chrome.pdf": {"크롬 PDF 시험", "Hello World"},
	}
	for p, wants := range cases {
		s, err := ExtractText(p)
		if err != nil {
			t.Fatalf("%s: %v", p, err)
		}
		for _, w := range wants {
			if !strings.Contains(s, w) {
				t.Errorf("%s: missing %q in %q", p, w, s)
			}
		}
	}
}
