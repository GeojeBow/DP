package main

// Text from PDF files, written from the PDF specification (ISO 32000).
//
// The reader collects every object (including those packed in object
// streams), walks the page tree, and runs each page's content stream through
// a small interpreter that only follows the text operators. Character codes
// become Unicode through the font's ToUnicode map when it has one, otherwise
// through its simple 8-bit encoding. Encrypted PDFs and scanned pages (images
// with no text) give nothing.

import (
	"bytes"
	"compress/zlib"
	"errors"
	"io"
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf16"

	"golang.org/x/text/encoding/charmap"
)

type pdfRef struct{ num, gen int }

type pdfName string

type pdfDict map[pdfName]any

type pdfStream struct {
	dict pdfDict
	raw  []byte
}

type pdfDoc struct {
	data  []byte
	offs  map[int]int // object number -> where its value starts
	objs  map[int]any
	fonts map[pdfRef]*pdfFont
}

var pdfObjRe = regexp.MustCompile(`(\d+)\s+(\d+)\s+obj\b`)

func extractPDF(p string) (string, error) {
	b, err := readLimited(p)
	if err != nil {
		return "", err
	}
	if !bytes.HasPrefix(bytes.TrimLeft(b[:min(len(b), 1024)], "\x00\r\n\t "), []byte("%PDF")) {
		return "", errNotText
	}
	d := &pdfDoc{data: b, objs: map[int]any{}, fonts: map[pdfRef]*pdfFont{}}
	d.load()
	if d.encrypted() {
		return "", errEncrypted
	}
	var sb strings.Builder
	for _, pg := range d.pages() {
		d.pageText(pg, &sb)
		if sb.Len() > maxTextBytes {
			break
		}
	}
	if strings.TrimSpace(sb.String()) == "" {
		return "", errNoPDFText
	}
	return capText(sb.String()), nil
}

var errNoPDFText = errors.New("글자가 없는 PDF (스캔한 이미지일 수 있음)")

func (d *pdfDoc) load() {
	// first find where every object starts, so stream lengths stored as
	// references can be looked up without searching the file again
	d.offs = map[int]int{}
	type at struct{ num, pos int }
	var order []at
	for _, m := range pdfObjRe.FindAllSubmatchIndex(d.data, -1) {
		num, _ := strconv.Atoi(string(d.data[m[2]:m[3]]))
		d.offs[num] = m[1] // later definitions (incremental updates) win
		order = append(order, at{num, m[1]})
	}
	for _, o := range order {
		if d.offs[o.num] != o.pos {
			continue
		}
		lx := &pdfLexer{b: d.data, i: o.pos}
		v := lx.value(0)
		if dict, ok := v.(pdfDict); ok {
			lx.skipSpace()
			if bytes.HasPrefix(d.data[lx.i:], []byte("stream")) {
				v = d.readStream(dict, lx.i+len("stream"))
			}
		}
		d.objs[o.num] = v
	}
	// objects packed inside object streams
	for _, v := range d.objs {
		st, ok := v.(*pdfStream)
		if !ok || st.dict["Type"] != pdfName("ObjStm") {
			continue
		}
		data := d.decode(st)
		n, _ := d.resolve(st.dict["N"]).(float64)
		first, _ := d.resolve(st.dict["First"]).(float64)
		if data == nil || int(first) > len(data) {
			continue
		}
		hl := &pdfLexer{b: data[:int(first)]}
		for k := 0; k < int(n); k++ {
			on, ok1 := hl.value(0).(float64)
			off, ok2 := hl.value(0).(float64)
			if !ok1 || !ok2 {
				break
			}
			if _, have := d.objs[int(on)]; have {
				continue
			}
			pos := int(first) + int(off)
			if pos < len(data) {
				d.objs[int(on)] = (&pdfLexer{b: data, i: pos}).value(0)
			}
		}
	}
}

func (d *pdfDoc) readStream(dict pdfDict, i int) *pdfStream {
	if i < len(d.data) && d.data[i] == '\r' {
		i++
	}
	if i < len(d.data) && d.data[i] == '\n' {
		i++
	}
	end := -1
	if n, ok := d.resolveNoStream(dict["Length"]).(float64); ok && i+int(n) <= len(d.data) {
		e := i + int(n)
		if bytes.Contains(d.data[e:min(len(d.data), e+32)], []byte("endstream")) {
			end = e
		}
	}
	if end < 0 {
		k := bytes.Index(d.data[i:], []byte("endstream"))
		if k < 0 {
			return &pdfStream{dict: dict}
		}
		end = i + k
	}
	return &pdfStream{dict: dict, raw: d.data[i:end]}
}

// resolveNoStream resolves a reference while objects are still loading
// (used for stream /Length), by parsing the target object directly.
func (d *pdfDoc) resolveNoStream(v any) any {
	r, ok := v.(pdfRef)
	if !ok {
		return v
	}
	if o, ok := d.objs[r.num]; ok {
		return o
	}
	if pos, ok := d.offs[r.num]; ok {
		return (&pdfLexer{b: d.data, i: pos}).value(0)
	}
	return nil
}

func (d *pdfDoc) resolve(v any) any {
	for k := 0; k < 16; k++ {
		r, ok := v.(pdfRef)
		if !ok {
			return v
		}
		v = d.objs[r.num]
	}
	return nil
}

func (d *pdfDoc) dict(v any) pdfDict {
	switch t := d.resolve(v).(type) {
	case pdfDict:
		return t
	case *pdfStream:
		return t.dict
	}
	return nil
}

func (d *pdfDoc) encrypted() bool {
	for _, v := range d.objs {
		if st, ok := v.(*pdfStream); ok && st.dict["Type"] == pdfName("XRef") && st.dict["Encrypt"] != nil {
			return true
		}
	}
	for _, m := range regexp.MustCompile(`trailer\s*<<`).FindAllIndex(d.data, -1) {
		if t, ok := (&pdfLexer{b: d.data, i: m[1] - 2}).value(0).(pdfDict); ok && t["Encrypt"] != nil {
			return true
		}
	}
	return false
}

// decode returns a stream's decoded bytes (Flate only; other filters give nil).
func (d *pdfDoc) decode(st *pdfStream) []byte {
	var filters []any
	switch f := d.resolve(st.dict["Filter"]).(type) {
	case pdfName:
		filters = []any{f}
	case []any:
		filters = f
	}
	data := st.raw
	for _, f := range filters {
		switch d.resolve(f) {
		case pdfName("FlateDecode"), pdfName("Fl"):
			zr, err := zlib.NewReader(bytes.NewReader(data))
			if err != nil {
				return nil
			}
			out, err := io.ReadAll(io.LimitReader(zr, maxFileBytes*2))
			if len(out) == 0 && err != nil {
				return nil
			}
			data = out
		default:
			return nil
		}
	}
	return data
}

// pages returns page dictionaries in order, with inherited Resources filled in.
func (d *pdfDoc) pages() []pdfDict {
	var root pdfDict
	for _, v := range d.objs {
		if dd := d.dict(v); dd != nil && dd["Type"] == pdfName("Catalog") {
			root = dd
		}
	}
	var out []pdfDict
	seen := map[any]bool{}
	var walk func(v any, res any, depth int)
	walk = func(v any, res any, depth int) {
		if depth > 64 || seen[v] && v != nil {
			return
		}
		if r, ok := v.(pdfRef); ok {
			seen[r] = true
		}
		n := d.dict(v)
		if n == nil {
			return
		}
		if n["Resources"] != nil {
			res = n["Resources"]
		}
		if kids, ok := d.resolve(n["Kids"]).([]any); ok {
			for _, k := range kids {
				walk(k, res, depth+1)
			}
			return
		}
		pg := pdfDict{"Contents": n["Contents"], "Resources": res}
		out = append(out, pg)
	}
	if root != nil {
		walk(root["Pages"], nil, 0)
	}
	if len(out) == 0 { // damaged page tree: take every page object
		for num := 0; num <= len(d.objs)*4 && len(out) < 100000; num++ {
			if n := d.dict(d.objs[num]); n != nil && n["Type"] == pdfName("Page") {
				out = append(out, pdfDict{"Contents": n["Contents"], "Resources": n["Resources"]})
			}
		}
	}
	return out
}

func (d *pdfDoc) pageText(pg pdfDict, sb *strings.Builder) {
	var content []byte
	switch c := d.resolve(pg["Contents"]).(type) {
	case *pdfStream:
		content = d.decode(c)
	case []any:
		for _, part := range c {
			if st, ok := d.resolve(part).(*pdfStream); ok {
				content = append(content, d.decode(st)...)
				content = append(content, '\n')
			}
		}
	}
	d.runContent(content, d.dict(pg["Resources"]), sb, 0)
	sb.WriteByte('\n')
}

// ---- fonts ----

type pdfFont struct {
	widths   map[uint32]float64 // glyph widths in 1/1000 of the font size
	dw       float64            // default width
	cmap     map[uint32]string
	twoByte  bool
	codeLens []int // byte lengths from the codespace ranges
	simple   *charmap.Charmap
}

func (d *pdfDoc) font(v any) *pdfFont {
	r, isRef := v.(pdfRef)
	if isRef {
		if f, ok := d.fonts[r]; ok {
			return f
		}
	}
	fd := d.dict(v)
	f := &pdfFont{simple: charmap.Windows1252, dw: 500, widths: map[uint32]float64{}}
	if fd != nil {
		if fd["Subtype"] == pdfName("Type0") {
			f.twoByte = true
			f.dw = 1000
			if desc, ok := d.resolve(fd["DescendantFonts"]).([]any); ok && len(desc) > 0 {
				if cid := d.dict(desc[0]); cid != nil {
					if w, ok := d.resolve(cid["DW"]).(float64); ok {
						f.dw = w
					}
					d.cidWidths(f, cid["W"])
				}
			}
		} else {
			first, _ := d.resolve(fd["FirstChar"]).(float64)
			if ws, ok := d.resolve(fd["Widths"]).([]any); ok {
				for i, w := range ws {
					if n, ok := d.resolve(w).(float64); ok {
						f.widths[uint32(int(first)+i)] = n
					}
				}
			}
			if fdesc := d.dict(fd["FontDescriptor"]); fdesc != nil {
				if mw, ok := d.resolve(fdesc["MissingWidth"]).(float64); ok && mw > 0 {
					f.dw = mw
				}
			}
		}
		switch d.resolve(fd["Encoding"]) {
		case pdfName("MacRomanEncoding"):
			f.simple = charmap.Macintosh
		}
		if st, ok := d.resolve(fd["ToUnicode"]).(*pdfStream); ok {
			f.parseCMap(d.decode(st))
		}
	}
	if isRef {
		d.fonts[r] = f
	}
	return f
}

var (
	cmapBfChar  = regexp.MustCompile(`(?s)beginbfchar(.*?)endbfchar`)
	cmapBfRange = regexp.MustCompile(`(?s)beginbfrange(.*?)endbfrange`)
	cmapSpace   = regexp.MustCompile(`(?s)begincodespacerange(.*?)endcodespacerange`)
)

func (f *pdfFont) parseCMap(b []byte) {
	if b == nil {
		return
	}
	f.cmap = map[uint32]string{}
	hexes := func(s []byte) []any {
		lx := &pdfLexer{b: s}
		var out []any
		for len(out) < 1<<20 {
			v := lx.value(0)
			if v == nil {
				return out
			}
			out = append(out, v)
		}
		return out
	}
	for _, m := range cmapSpace.FindAllSubmatch(b, -1) {
		vs := hexes(m[1])
		for i := 0; i+1 < len(vs); i += 2 {
			if s, ok := vs[i].(pdfHex); ok {
				f.codeLens = append(f.codeLens, len(s))
			}
		}
	}
	for _, m := range cmapBfChar.FindAllSubmatch(b, -1) {
		vs := hexes(m[1])
		for i := 0; i+1 < len(vs); i += 2 {
			src, ok1 := vs[i].(pdfHex)
			dst, ok2 := vs[i+1].(pdfHex)
			if ok1 && ok2 {
				f.cmap[codeOf(src)] = utf16be(dst)
				f.noteLen(len(src))
			}
		}
	}
	for _, m := range cmapBfRange.FindAllSubmatch(b, -1) {
		vs := hexes(m[1])
		for i := 0; i+2 < len(vs); i += 3 {
			lo, ok1 := vs[i].(pdfHex)
			hi, ok2 := vs[i+1].(pdfHex)
			if !ok1 || !ok2 {
				continue
			}
			f.noteLen(len(lo))
			a, z := codeOf(lo), codeOf(hi)
			if z < a || z-a > 0xFFFF {
				continue
			}
			switch dst := vs[i+2].(type) {
			case pdfHex:
				base := []rune(utf16be(dst))
				if len(base) == 0 {
					continue
				}
				for c := a; c <= z; c++ {
					r := append([]rune{}, base...)
					r[len(r)-1] += rune(c - a)
					f.cmap[c] = string(r)
				}
			case []any:
				for k, x := range dst {
					if h, ok := x.(pdfHex); ok && a+uint32(k) <= z {
						f.cmap[a+uint32(k)] = utf16be(h)
					}
				}
			}
		}
	}
}

// cidWidths reads a CID font's W array: "c [w1 w2 ...]" or "c1 c2 w".
func (d *pdfDoc) cidWidths(f *pdfFont, v any) {
	arr, ok := d.resolve(v).([]any)
	if !ok {
		return
	}
	for i := 0; i < len(arr) && len(f.widths) < 1<<17; {
		c, ok := d.resolve(arr[i]).(float64)
		if !ok || i+1 >= len(arr) {
			return
		}
		if ws, ok := d.resolve(arr[i+1]).([]any); ok {
			for k, w := range ws {
				if n, ok := d.resolve(w).(float64); ok {
					f.widths[uint32(c)+uint32(k)] = n
				}
			}
			i += 2
			continue
		}
		if i+2 >= len(arr) {
			return
		}
		c2, ok1 := d.resolve(arr[i+1]).(float64)
		w, ok2 := d.resolve(arr[i+2]).(float64)
		if ok1 && ok2 && c2 >= c && c2-c < 1<<16 {
			for k := uint32(c); k <= uint32(c2); k++ {
				f.widths[k] = w
			}
		}
		i += 3
	}
}

func (f *pdfFont) noteLen(n int) {
	if len(f.codeLens) == 0 && n == 2 {
		f.twoByte = true
	}
}

func codeOf(h pdfHex) uint32 {
	var c uint32
	for _, b := range []byte(h) {
		c = c<<8 | uint32(b)
	}
	return c
}

func utf16be(h pdfHex) string {
	b := []byte(h)
	u := make([]uint16, len(b)/2)
	for i := range u {
		u[i] = uint16(b[2*i])<<8 | uint16(b[2*i+1])
	}
	return string(utf16.Decode(u))
}

// text writes the decoded string and returns its advance in text space.
func (f *pdfFont) text(s []byte, sb *strings.Builder, size, tc, tw float64) float64 {
	adv := 0.0
	width := 1
	if f.twoByte {
		width = 2
	}
	if len(f.codeLens) > 0 {
		width = f.codeLens[0]
		for _, l := range f.codeLens {
			if l > width {
				width = l
			}
		}
		if allSame(f.codeLens) {
			width = f.codeLens[0]
		} else {
			width = 0 // mixed lengths: try the shortest match first
		}
	}
	for i := 0; i < len(s); {
		w := width
		if w == 0 {
			w = 1
			for _, l := range []int{1, 2, 3, 4} {
				if i+l <= len(s) {
					if _, ok := f.cmap[codeOf(pdfHex(s[i:i+l]))]; ok {
						w = l
						break
					}
				}
			}
		}
		if i+w > len(s) {
			break
		}
		code := codeOf(pdfHex(s[i : i+w]))
		gw, ok := f.widths[code]
		if !ok {
			gw = f.dw
		}
		adv += gw/1000*size + tc
		if w == 1 && s[i] == ' ' {
			adv += tw
		}
		if t, ok := f.cmap[code]; ok {
			sb.WriteString(t)
		} else if w == 1 {
			if r := f.simple.DecodeByte(s[i]); r >= 32 {
				sb.WriteRune(r)
			}
		}
		i += w
	}
	return adv
}

func allSame(a []int) bool {
	for _, x := range a {
		if x != a[0] {
			return false
		}
	}
	return true
}

// ---- content stream ----

// textState follows where text lands so that runs placed next to each other
// join up, gaps become spaces and new lines become line breaks. Without this,
// a PDF that places each word (or each character) separately would break
// words apart.
type textState struct {
	sb      *strings.Builder
	tm, tlm [6]float64
	font    *pdfFont
	size    float64
	tc, tw  float64 // character and word spacing
	tz      float64 // horizontal scaling (1 = 100%)
	tl      float64 // leading
	px, py  float64 // where the previous run ended
	started bool
}

func mulTd(m [6]float64, tx, ty float64) [6]float64 {
	m[4], m[5] = tx*m[0]+ty*m[2]+m[4], tx*m[1]+ty*m[3]+m[5]
	return m
}

func (t *textState) newLine(tx, ty float64) {
	t.tlm = mulTd(t.tlm, tx, ty)
	t.tm = t.tlm
}

func (t *textState) scale() (float64, float64) {
	sx := math.Hypot(t.tm[0], t.tm[1]) * t.size
	sy := math.Hypot(t.tm[2], t.tm[3]) * t.size
	if sx == 0 {
		sx = 1
	}
	if sy == 0 {
		sy = sx
	}
	return sx, sy
}

// show writes one string operand and moves the text position past it.
func (t *textState) show(s []byte) {
	x, y := t.tm[4], t.tm[5]
	sx, sy := t.scale()
	if t.started {
		// distance from the end of the previous run, along and across the line
		dx, dy := x-t.px, y-t.py
		ux, uy := t.tm[0], t.tm[1]
		if n := math.Hypot(ux, uy); n > 0 {
			ux, uy = ux/n, uy/n
		} else {
			ux, uy = 1, 0
		}
		along, across := dx*ux+dy*uy, -dx*uy+dy*ux
		switch {
		case math.Abs(across) > sy*0.5:
			t.sb.WriteByte('\n')
		case along > sx*0.15 || along < -sx*2:
			t.sb.WriteByte(' ')
		}
	}
	adv := t.font.text(s, t.sb, t.size, t.tc, t.tw)
	t.tm = mulTd(t.tm, adv*t.tz, 0)
	t.px, t.py = t.tm[4], t.tm[5]
	t.started = true
}

func (d *pdfDoc) runContent(content []byte, res pdfDict, sb *strings.Builder, depth int) {
	if content == nil || depth > 8 {
		return
	}
	var fonts, xobjs pdfDict
	if res != nil {
		fonts, xobjs = d.dict(res["Font"]), d.dict(res["XObject"])
	}
	id := [6]float64{1, 0, 0, 1, 0, 0}
	t := &textState{sb: sb, tm: id, tlm: id, font: &pdfFont{simple: charmap.Windows1252}, size: 1, tz: 1}
	lx := &pdfLexer{b: content, ops: true}
	var stack []any
	num := func(i int) float64 { // i-th operand from the end
		if len(stack) > i {
			if n, ok := stack[len(stack)-1-i].(float64); ok {
				return n
			}
		}
		return 0
	}
	arg := func(i int) any {
		if len(stack) > i {
			return stack[len(stack)-1-i]
		}
		return nil
	}
	for {
		v := lx.value(0)
		if v == nil {
			break
		}
		op, isOp := v.(pdfOp)
		if !isOp {
			if len(stack) < 4096 {
				stack = append(stack, v)
			}
			continue
		}
		switch op {
		case "BI": // inline image: skip to EI
			k := bytes.Index(content[lx.i:], []byte("EI"))
			if k < 0 {
				return
			}
			lx.i += k + 2
		case "BT":
			t.tm, t.tlm = id, id
		case "Tf":
			if n, ok := arg(1).(pdfName); ok && fonts != nil {
				t.font = d.font(fonts[n])
			}
			t.size = num(0)
		case "Tc":
			t.tc = num(0)
		case "Tw":
			t.tw = num(0)
		case "Tz":
			t.tz = num(0) / 100
		case "TL":
			t.tl = num(0)
		case "Td":
			t.newLine(num(1), num(0))
		case "TD":
			t.tl = -num(0)
			t.newLine(num(1), num(0))
		case "Tm":
			t.tlm = [6]float64{num(5), num(4), num(3), num(2), num(1), num(0)}
			t.tm = t.tlm
		case "T*":
			t.newLine(0, -t.tl)
		case "Tj", "'", "\"":
			if op != "Tj" {
				t.newLine(0, -t.tl)
			}
			if op == "\"" {
				t.tw, t.tc = num(2), num(1)
			}
			switch s := arg(0).(type) {
			case pdfString:
				t.show([]byte(s))
			case pdfHex:
				t.show([]byte(s))
			}
		case "TJ":
			arr, _ := arg(0).([]any)
			for _, x := range arr {
				switch s := x.(type) {
				case pdfString:
					t.show([]byte(s))
				case pdfHex:
					t.show([]byte(s))
				case float64:
					t.tm = mulTd(t.tm, -s/1000*t.size*t.tz, 0)
				}
			}
		case "Do":
			if n, ok := arg(0).(pdfName); ok && xobjs != nil {
				if st, ok := d.resolve(xobjs[n]).(*pdfStream); ok && st.dict["Subtype"] == pdfName("Form") {
					sub := d.dict(st.dict["Resources"])
					if sub == nil {
						sub = res
					}
					sb.WriteByte('\n')
					d.runContent(d.decode(st), sub, sb, depth+1)
					sb.WriteByte('\n')
				}
			}
		}
		stack = stack[:0]
		if sb.Len() > maxTextBytes {
			return
		}
	}
}

// ---- lexer ----

type pdfString string // literal string bytes
type pdfHex string    // hex string bytes
type pdfOp string     // content stream operator

type pdfLexer struct {
	b   []byte
	i   int
	ops bool // content stream: bare words are operators
}

func pdfDelim(c byte) bool {
	return strings.IndexByte("()<>[]{}/%", c) >= 0
}

func pdfSpace(c byte) bool {
	return c == ' ' || c == '\n' || c == '\r' || c == '\t' || c == '\f' || c == 0
}

func (lx *pdfLexer) skipSpace() {
	for lx.i < len(lx.b) {
		c := lx.b[lx.i]
		if pdfSpace(c) {
			lx.i++
		} else if c == '%' {
			for lx.i < len(lx.b) && lx.b[lx.i] != '\n' && lx.b[lx.i] != '\r' {
				lx.i++
			}
		} else {
			return
		}
	}
}

// value reads one value; nil at the end or on garbage it cannot skip.
func (lx *pdfLexer) value(depth int) any {
	for guard := 0; guard < 1<<20; guard++ {
		lx.skipSpace()
		if lx.i >= len(lx.b) || depth > 64 {
			return nil
		}
		c := lx.b[lx.i]
		switch {
		case c == '/':
			lx.i++
			s := lx.i
			for lx.i < len(lx.b) && !pdfSpace(lx.b[lx.i]) && !pdfDelim(lx.b[lx.i]) {
				lx.i++
			}
			return pdfName(unescapeName(lx.b[s:lx.i]))
		case c == '(':
			return lx.literal()
		case c == '<' && lx.i+1 < len(lx.b) && lx.b[lx.i+1] == '<':
			lx.i += 2
			dict := pdfDict{}
			for {
				lx.skipSpace()
				if lx.i >= len(lx.b) {
					return dict
				}
				if lx.b[lx.i] == '>' {
					lx.i += 2
					return dict
				}
				k, ok := lx.value(depth + 1).(pdfName)
				if !ok {
					return dict
				}
				dict[k] = lx.value(depth + 1)
			}
		case c == '<':
			lx.i++
			var h []byte
			for lx.i < len(lx.b) && lx.b[lx.i] != '>' {
				if x := hexVal(lx.b[lx.i]); x >= 0 {
					h = append(h, byte(x))
				}
				lx.i++
			}
			lx.i++
			if len(h)%2 == 1 {
				h = append(h, 0)
			}
			out := make([]byte, len(h)/2)
			for k := range out {
				out[k] = h[2*k]<<4 | h[2*k+1]
			}
			return pdfHex(out)
		case c == '[':
			lx.i++
			var arr []any
			for {
				lx.skipSpace()
				if lx.i >= len(lx.b) {
					return arr
				}
				if lx.b[lx.i] == ']' {
					lx.i++
					if arr == nil {
						arr = []any{}
					}
					return arr
				}
				v := lx.value(depth + 1)
				if v == nil {
					return arr
				}
				arr = append(arr, v)
			}
		case c == ']' || c == '>' || c == ')' || c == '{' || c == '}':
			lx.i++ // stray delimiter
			continue
		case c == '+' || c == '-' || c == '.' || (c >= '0' && c <= '9'):
			s := lx.i
			lx.i++
			for lx.i < len(lx.b) && (lx.b[lx.i] == '.' || lx.b[lx.i] >= '0' && lx.b[lx.i] <= '9') {
				lx.i++
			}
			n, _ := strconv.ParseFloat(string(lx.b[s:lx.i]), 64)
			if !lx.ops { // "12 0 R" is a reference
				save := lx.i
				if g, ok := lx.peekInt(); ok {
					lx.skipSpace()
					if lx.i < len(lx.b) && lx.b[lx.i] == 'R' && (lx.i+1 == len(lx.b) || pdfSpace(lx.b[lx.i+1]) || pdfDelim(lx.b[lx.i+1])) {
						lx.i++
						return pdfRef{int(n), g}
					}
				}
				lx.i = save
			}
			return n
		default:
			s := lx.i
			for lx.i < len(lx.b) && !pdfSpace(lx.b[lx.i]) && !pdfDelim(lx.b[lx.i]) {
				lx.i++
			}
			w := string(lx.b[s:lx.i])
			switch w {
			case "true":
				return true
			case "false":
				return false
			case "null":
				return pdfName("")
			}
			if lx.ops {
				return pdfOp(w)
			}
			return nil // obj/endobj/stream keywords end a value
		}
	}
	return nil
}

func (lx *pdfLexer) peekInt() (int, bool) {
	lx.skipSpace()
	s := lx.i
	for lx.i < len(lx.b) && lx.b[lx.i] >= '0' && lx.b[lx.i] <= '9' {
		lx.i++
	}
	if s == lx.i {
		return 0, false
	}
	n, err := strconv.Atoi(string(lx.b[s:lx.i]))
	return n, err == nil
}

func (lx *pdfLexer) literal() pdfString {
	lx.i++ // (
	var out []byte
	depth := 1
	for lx.i < len(lx.b) {
		c := lx.b[lx.i]
		lx.i++
		switch c {
		case '(':
			depth++
		case ')':
			depth--
			if depth == 0 {
				return pdfString(out)
			}
		case '\\':
			if lx.i >= len(lx.b) {
				return pdfString(out)
			}
			e := lx.b[lx.i]
			lx.i++
			switch e {
			case 'n':
				c = '\n'
			case 'r':
				c = '\r'
			case 't':
				c = '\t'
			case 'b':
				c = '\b'
			case 'f':
				c = '\f'
			case '\r':
				if lx.i < len(lx.b) && lx.b[lx.i] == '\n' {
					lx.i++
				}
				continue
			case '\n':
				continue
			default:
				if e >= '0' && e <= '7' {
					v := int(e - '0')
					for k := 0; k < 2 && lx.i < len(lx.b) && lx.b[lx.i] >= '0' && lx.b[lx.i] <= '7'; k++ {
						v = v*8 + int(lx.b[lx.i]-'0')
						lx.i++
					}
					c = byte(v)
				} else {
					c = e
				}
			}
		}
		out = append(out, c)
	}
	return pdfString(out)
}

func hexVal(c byte) int {
	switch {
	case c >= '0' && c <= '9':
		return int(c - '0')
	case c >= 'a' && c <= 'f':
		return int(c-'a') + 10
	case c >= 'A' && c <= 'F':
		return int(c-'A') + 10
	}
	return -1
}

func unescapeName(b []byte) string {
	if bytes.IndexByte(b, '#') < 0 {
		return string(b)
	}
	var out []byte
	for i := 0; i < len(b); i++ {
		if b[i] == '#' && i+2 < len(b) && hexVal(b[i+1]) >= 0 && hexVal(b[i+2]) >= 0 {
			out = append(out, byte(hexVal(b[i+1])<<4|hexVal(b[i+2])))
			i += 2
		} else {
			out = append(out, b[i])
		}
	}
	return string(out)
}
