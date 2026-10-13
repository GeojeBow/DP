package main

// Text from the older binary document formats that live inside a compound
// file (see cfb.go). Each reader follows the format's published
// specification: Hancom's "HWP 5.0 file format" document, and Microsoft's
// [MS-DOC], [MS-XLS] and [MS-PPT]. Only the text is read; layout, numbers
// and pictures are ignored. Encrypted documents are skipped.

import (
	"bytes"
	"compress/flate"
	"encoding/binary"
	"fmt"
	"io"
	"strings"
	"unicode/utf16"

	"golang.org/x/text/encoding/charmap"
)

var le = binary.LittleEndian

func extractCFB(p string, ext string) (string, error) {
	b, err := readLimited(p)
	if err != nil {
		return "", err
	}
	c, err := openCFB(b)
	if err != nil {
		return "", errNotText
	}
	var sb strings.Builder
	switch ext {
	case "hwp":
		err = hwpText(c, &sb)
	case "doc":
		err = docText(c, &sb)
	case "xls":
		err = xlsText(c, &sb)
	case "ppt":
		err = pptText(c, &sb)
	default:
		err = errNotText
	}
	if err == errEncrypted {
		return "", err
	}
	if err != nil && sb.Len() == 0 {
		return "", errNotText
	}
	return capText(sb.String()), nil
}

func capText(s string) string {
	if len(s) > maxTextBytes {
		s = string(trimPartialRune([]byte(s[:maxTextBytes])))
	}
	return s
}

// ---- HWP 5.0 ----

func hwpText(c *cfbFile, sb *strings.Builder) error {
	head, err := c.stream("FileHeader")
	if err != nil || len(head) < 40 || !bytes.HasPrefix(head, []byte("HWP Document File")) {
		return errNotText
	}
	flags := le.Uint32(head[36:])
	if flags&2 != 0 || flags&4 != 0 { // password, or distribution copy
		return errEncrypted
	}
	compressed := flags&1 != 0
	body := c.find("BodyText")
	if body < 0 {
		return errNotText
	}
	n := 0
	for _, name := range c.children(body) {
		if strings.HasPrefix(name, "Section") {
			n++
		}
	}
	for i := 0; i < n && sb.Len() < maxTextBytes; i++ {
		data, err := c.stream("BodyText", fmt.Sprintf("Section%d", i))
		if err != nil {
			continue
		}
		if compressed {
			data, err = io.ReadAll(io.LimitReader(flate.NewReader(bytes.NewReader(data)), maxFileBytes*2))
			if err != nil && len(data) == 0 {
				continue
			}
		}
		hwpRecords(data, sb)
	}
	return nil
}

const hwpParaText = 0x10 + 51

func hwpRecords(d []byte, sb *strings.Builder) {
	for len(d) >= 4 {
		h := le.Uint32(d)
		d = d[4:]
		tag, size := h&0x3FF, int(h>>20)
		if size == 0xFFF {
			if len(d) < 4 {
				return
			}
			size = int(le.Uint32(d))
			d = d[4:]
		}
		if size < 0 || size > len(d) {
			return
		}
		if tag == hwpParaText {
			hwpParaChars(d[:size], sb)
		}
		d = d[size:]
	}
}

// hwpParaChars decodes one paragraph's UTF-16 text. Codes below 32 are
// controls: some take one character, the rest take eight (the control id
// and its parameters).
func hwpParaChars(d []byte, sb *strings.Builder) {
	u := make([]uint16, 0, len(d)/2)
	for i := 0; i+1 < len(d); {
		ch := le.Uint16(d[i:])
		if ch >= 32 {
			u = append(u, ch)
			i += 2
			continue
		}
		switch ch {
		case 0, 10, 13, 24, 25, 26, 27, 28, 29, 30, 31:
			if ch == 10 {
				u = append(u, '\n')
			}
			if ch == 30 || ch == 31 { // non-breaking / fixed-width space
				u = append(u, ' ')
			}
			i += 2
		default:
			if ch == 9 {
				u = append(u, '\t')
			}
			i += 16
		}
	}
	sb.WriteString(string(utf16.Decode(u)))
	sb.WriteByte('\n')
}

// ---- Word 97-2003 (.doc) ----

func docText(c *cfbFile, sb *strings.Builder) error {
	wd, err := c.stream("WordDocument")
	if err != nil || len(wd) < 0x1AA || le.Uint16(wd) != 0xA5EC {
		return errNotText
	}
	flags := le.Uint16(wd[0x0A:])
	if flags&0x0100 != 0 { // encrypted
		return errEncrypted
	}
	tname := "0Table"
	if flags&0x0200 != 0 {
		tname = "1Table"
	}
	tbl, err := c.stream(tname)
	if err != nil {
		return errNotText
	}
	fc, lcb := le.Uint32(wd[0x1A2:]), le.Uint32(wd[0x1A6:])
	if uint64(fc)+uint64(lcb) > uint64(len(tbl)) {
		return errNotText
	}
	clx := tbl[fc : fc+lcb]
	// skip Prc entries, find the piece table
	for len(clx) > 0 && clx[0] == 1 {
		if len(clx) < 3 {
			return errNotText
		}
		n := int(int16(le.Uint16(clx[1:])))
		if n < 0 || 3+n > len(clx) {
			return errNotText
		}
		clx = clx[3+n:]
	}
	if len(clx) < 5 || clx[0] != 2 {
		return errNotText
	}
	plc := clx[5:]
	if n := int(le.Uint32(clx[1:])); n < len(plc) {
		plc = plc[:n]
	}
	pieces := (len(plc) - 4) / 12
	if pieces <= 0 {
		return errNotText
	}
	w := docWriter{sb: sb}
	for i := 0; i < pieces && sb.Len() < maxTextBytes; i++ {
		cp0, cp1 := le.Uint32(plc[4*i:]), le.Uint32(plc[4*i+4:])
		pcd := plc[4*(pieces+1)+8*i:]
		fcv := le.Uint32(pcd[2:])
		n := int(cp1) - int(cp0)
		if n <= 0 || n > maxTextBytes {
			continue
		}
		if fcv&0x40000000 != 0 { // 8-bit characters
			off := int(fcv&^0x40000000) / 2
			if off+n > len(wd) {
				continue
			}
			for _, ch := range wd[off : off+n] {
				w.put(rune(charmap.Windows1252.DecodeByte(ch)))
			}
		} else {
			off := int(fcv)
			if off+2*n > len(wd) {
				continue
			}
			u := make([]uint16, n)
			for k := range u {
				u[k] = le.Uint16(wd[off+2*k:])
			}
			for _, r := range utf16.Decode(u) {
				w.put(r)
			}
		}
	}
	return nil
}

// docWriter turns Word's special characters into plain text and drops field
// codes (the part between 0x13 and 0x14), keeping field results.
type docWriter struct {
	sb    *strings.Builder
	field []bool // per open field: inside its code part
}

func (w *docWriter) put(r rune) {
	switch r {
	case 0x13:
		w.field = append(w.field, true)
		return
	case 0x14:
		if len(w.field) > 0 {
			w.field[len(w.field)-1] = false
		}
		return
	case 0x15:
		if len(w.field) > 0 {
			w.field = w.field[:len(w.field)-1]
		}
		return
	}
	for _, code := range w.field {
		if code {
			return
		}
	}
	switch r {
	case '\r', 0x0B, 0x0C, 0x0E:
		w.sb.WriteByte('\n')
	case 0x07:
		w.sb.WriteByte('\t')
	case 0x1E:
		w.sb.WriteByte('-')
	case '\t':
		w.sb.WriteByte('\t')
	default:
		if r >= 32 {
			w.sb.WriteRune(r)
		}
	}
}

// ---- Excel 97-2003 (.xls) ----

func xlsText(c *cfbFile, sb *strings.Builder) error {
	wb, err := c.stream("Workbook")
	if err != nil {
		if wb, err = c.stream("Book"); err != nil {
			return errNotText
		}
	}
	type rec struct {
		typ  uint16
		data []byte
	}
	var recs []rec
	for d := wb; len(d) >= 4; {
		typ, n := le.Uint16(d), int(le.Uint16(d[2:]))
		if 4+n > len(d) {
			break
		}
		recs = append(recs, rec{typ, d[4 : 4+n]})
		d = d[4+n:]
	}
	for i, r := range recs {
		switch r.typ {
		case 0x002F: // FILEPASS: encrypted
			return errEncrypted
		case 0x0085: // BOUNDSHEET: sheet name
			if len(r.data) > 8 {
				s := xlsShortString(r.data[6:])
				sb.WriteString(s + "\n")
			}
		case 0x00FC: // SST: all cell strings
			parts := [][]byte{r.data}
			for j := i + 1; j < len(recs) && recs[j].typ == 0x003C; j++ {
				parts = append(parts, recs[j].data)
			}
			xlsSST(parts, sb)
		}
	}
	return nil
}

func xlsShortString(d []byte) string {
	if len(d) < 2 {
		return ""
	}
	n, hi := int(d[0]), d[1]&1 != 0
	d = d[2:]
	if hi {
		if 2*n > len(d) {
			return ""
		}
		u := make([]uint16, n)
		for i := range u {
			u[i] = le.Uint16(d[2*i:])
		}
		return string(utf16.Decode(u))
	}
	if n > len(d) {
		n = len(d)
	}
	return latin1(d[:n])
}

func latin1(b []byte) string {
	r := make([]rune, len(b))
	for i, c := range b {
		r[i] = rune(c)
	}
	return string(r)
}

// xlsSST reads the shared string table. Strings may be split across
// CONTINUE records; a split inside the characters restarts with a new
// option byte that says whether the rest is 8- or 16-bit.
func xlsSST(parts [][]byte, sb *strings.Builder) {
	p, d := 0, parts[0]
	next := func() bool {
		for p+1 < len(parts) {
			p++
			d = parts[p]
			if len(d) > 0 {
				return true
			}
		}
		return false
	}
	need := func(n int) bool {
		for len(d) < n {
			if len(d) != 0 || !next() {
				return false
			}
		}
		return true
	}
	if !need(8) {
		return
	}
	count := int(le.Uint32(d[4:]))
	d = d[8:]
	for s := 0; s < count && sb.Len() < maxTextBytes; s++ {
		if len(d) == 0 && !next() {
			return
		}
		if !need(3) {
			return
		}
		cch, flags := int(le.Uint16(d)), d[2]
		d = d[3:]
		runs, ext := 0, 0
		if flags&8 != 0 {
			if !need(2) {
				return
			}
			runs = int(le.Uint16(d))
			d = d[2:]
		}
		if flags&4 != 0 {
			if !need(4) {
				return
			}
			ext = int(le.Uint32(d))
			d = d[4:]
		}
		hi := flags&1 != 0
		u := make([]uint16, 0, cch)
		for len(u) < cch {
			if len(d) == 0 {
				if !next() || len(d) < 1 {
					return
				}
				hi = d[0]&1 != 0
				d = d[1:]
			}
			if hi {
				for len(u) < cch && len(d) >= 2 {
					u = append(u, le.Uint16(d))
					d = d[2:]
				}
				if len(d) == 1 {
					d = d[1:]
				}
			} else {
				for len(u) < cch && len(d) >= 1 {
					u = append(u, uint16(d[0]))
					d = d[1:]
				}
			}
		}
		sb.WriteString(string(utf16.Decode(u)))
		sb.WriteByte('\n')
		skip := 4*runs + ext
		for skip > 0 {
			if len(d) == 0 && !next() {
				return
			}
			k := min(skip, len(d))
			d = d[k:]
			skip -= k
		}
	}
}

// ---- PowerPoint 97-2003 (.ppt) ----

func pptText(c *cfbFile, sb *strings.Builder) error {
	d, err := c.stream("PowerPoint Document")
	if err != nil {
		return errNotText
	}
	for len(d) >= 8 && sb.Len() < maxTextBytes {
		ver, typ, n := le.Uint16(d)&0xF, le.Uint16(d[2:]), int(le.Uint32(d[4:]))
		d = d[8:]
		if ver == 0xF { // container: its children follow
			continue
		}
		if n < 0 || n > len(d) {
			break
		}
		switch typ {
		case 0x0FA0: // TextCharsAtom, UTF-16
			u := make([]uint16, n/2)
			for i := range u {
				u[i] = le.Uint16(d[2*i:])
			}
			sb.WriteString(strings.ReplaceAll(string(utf16.Decode(u)), "\r", "\n"))
			sb.WriteByte('\n')
		case 0x0FA8: // TextBytesAtom, 8-bit
			sb.WriteString(strings.ReplaceAll(latin1(d[:n]), "\r", "\n"))
			sb.WriteByte('\n')
		}
		d = d[n:]
	}
	return nil
}
