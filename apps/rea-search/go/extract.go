package main

// Text extraction for content search.
//
//   - plain text files: UTF-8, UTF-16 (BOM) and CP949/EUC-KR (common for
//     older Korean Windows files) are detected automatically
//   - Office Open XML / ODF / HWPX documents are zip files of XML; their text
//     is read straight from the XML parts (docx, xlsx, pptx, odt, ods, odp, hwpx)
//
// Binary files are skipped. PDF and the old binary HWP/DOC/XLS formats are not
// supported yet.

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"errors"
	"io"
	"os"
	"path"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/encoding/korean"
	"golang.org/x/text/encoding/unicode"
)

const (
	maxFileBytes = 64 << 20 // files larger than this are skipped
	maxTextBytes = 8 << 20  // extracted text is cut at this size
)

var errNotText = errors.New("not a text file")

var plainExts = map[string]bool{}
var docExts = map[string]bool{"docx": true, "xlsx": true, "xlsm": true, "pptx": true, "odt": true, "ods": true, "odp": true, "hwpx": true}

func init() {
	for _, e := range strings.Fields(`txt text md markdown csv tsv log ini cfg conf config properties json jsonl xml yaml yml toml
		html htm xhtml css scss less js mjs cjs ts tsx jsx vue svelte go py pyw c h cc cpp hpp cs java kt kts rs swift m mm
		sql sh bash zsh bat cmd ps1 psm1 php rb pl lua r dart scala groovy gradle tex rtf srt smi vtt sub reg inf
		gitignore editorconfig env dockerfile makefile cmake proto graphql csproj sln vcxproj props targets manifest nfo diz`) {
		plainExts[e] = true
	}
}

// contentKind says how a file would be read: "text", "doc", "sniff" (unknown
// extension, sniffed for text) or "" (skipped).
func contentKind(name string) string {
	e := extOf(name)
	switch {
	case plainExts[e]:
		return "text"
	case docExts[e]:
		return "doc"
	}
	switch categoryOf(name, false) {
	case "image", "video", "audio", "archive", "exe":
		return ""
	}
	if e == "pdf" || e == "hwp" || e == "doc" || e == "xls" || e == "ppt" || e == "dll" || e == "sys" || e == "bin" || e == "dat" || e == "db" {
		return ""
	}
	return "sniff"
}

// ExtractText returns the searchable text of a file.
func ExtractText(p string) (string, error) {
	kind := contentKind(path.Base(strings.ReplaceAll(p, `\`, "/")))
	if kind == "" {
		return "", errNotText
	}
	st, err := os.Stat(p)
	if err != nil {
		return "", err
	}
	if st.IsDir() || st.Size() > maxFileBytes {
		return "", errNotText
	}
	if kind == "doc" {
		return extractZipXML(p, st.Size())
	}
	f, err := os.Open(p)
	if err != nil {
		return "", err
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, maxTextBytes))
	if err != nil {
		return "", err
	}
	return decodeText(b, kind == "sniff")
}

func decodeText(b []byte, strict bool) (string, error) {
	switch {
	case bytes.HasPrefix(b, []byte{0xEF, 0xBB, 0xBF}):
		b = b[3:]
	case bytes.HasPrefix(b, []byte{0xFF, 0xFE}):
		s, err := unicode.UTF16(unicode.LittleEndian, unicode.ExpectBOM).NewDecoder().Bytes(b)
		return string(s), err
	case bytes.HasPrefix(b, []byte{0xFE, 0xFF}):
		s, err := unicode.UTF16(unicode.BigEndian, unicode.ExpectBOM).NewDecoder().Bytes(b)
		return string(s), err
	}
	head := b
	if len(head) > 8000 {
		head = head[:8000]
	}
	if bytes.IndexByte(head, 0) >= 0 {
		return "", errNotText
	}
	if utf8.Valid(b) || utf8.Valid(trimPartialRune(b)) {
		return string(b), nil
	}
	s, err := korean.EUCKR.NewDecoder().Bytes(b) // CP949
	if err != nil {
		return "", errNotText
	}
	if strict && strings.Count(string(s), "�") > len(s)/50 {
		return "", errNotText
	}
	return string(s), nil
}

// trimPartialRune drops a multi-byte character cut off by the read limit.
func trimPartialRune(b []byte) []byte {
	for i := 0; i < 4 && len(b) > 0; i++ {
		if r, _ := utf8.DecodeLastRune(b); r != utf8.RuneError {
			return b
		}
		b = b[:len(b)-1]
	}
	return b
}

// docParts lists the XML parts that hold the text of each document type,
// in reading order.
func docParts(ext string, files []*zip.File) []*zip.File {
	var pick []*zip.File
	match := func(f *zip.File) bool {
		n := f.Name
		switch ext {
		case "docx":
			return n == "word/document.xml" || strings.HasPrefix(n, "word/header") || strings.HasPrefix(n, "word/footer") ||
				n == "word/footnotes.xml" || n == "word/endnotes.xml"
		case "pptx":
			return strings.HasPrefix(n, "ppt/slides/slide") && strings.HasSuffix(n, ".xml") ||
				strings.HasPrefix(n, "ppt/notesSlides/") && strings.HasSuffix(n, ".xml")
		case "xlsx", "xlsm":
			return n == "xl/sharedStrings.xml" || strings.HasPrefix(n, "xl/worksheets/sheet") && strings.HasSuffix(n, ".xml")
		case "hwpx":
			return strings.HasPrefix(n, "Contents/section") && strings.HasSuffix(n, ".xml")
		default: // odt, ods, odp
			return n == "content.xml"
		}
	}
	for _, f := range files {
		if match(f) {
			pick = append(pick, f)
		}
	}
	sort.SliceStable(pick, func(i, j int) bool { return naturalLess(pick[i].Name, pick[j].Name) })
	return pick
}

func extractZipXML(p string, size int64) (string, error) {
	zr, err := zip.OpenReader(p)
	if err != nil {
		return "", errNotText
	}
	defer zr.Close()
	var sb strings.Builder
	for _, f := range docParts(extOf(p), zr.File) {
		if f.UncompressedSize64 > maxFileBytes*2 {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			continue
		}
		xmlText(&sb, io.LimitReader(rc, maxFileBytes*2))
		rc.Close()
		if sb.Len() > maxTextBytes {
			break
		}
	}
	return sb.String(), nil
}

// xmlText appends character data, with a line break after paragraph-like
// elements and a tab after table cells.
func xmlText(sb *strings.Builder, r io.Reader) {
	d := xml.NewDecoder(r)
	d.Strict = false
	sharedCell, inV := false, false // xlsx: <c t="s"><v>3</v> is an index, not text
	for {
		tok, err := d.Token()
		if err != nil {
			return
		}
		switch t := tok.(type) {
		case xml.CharData:
			if !(inV && sharedCell) {
				sb.Write(t)
			}
		case xml.StartElement:
			switch t.Name.Local {
			case "c":
				sharedCell = false
				for _, a := range t.Attr {
					if a.Name.Local == "t" && a.Value == "s" {
						sharedCell = true
					}
				}
			case "v":
				inV = true
			case "tab":
				sb.WriteByte('\t')
			case "br", "cr":
				sb.WriteByte('\n')
			}
		case xml.EndElement:
			if t.Name.Local == "v" {
				inV = false
			}
			switch t.Name.Local {
			case "p", "h", "tr", "row", "si", "title":
				sb.WriteByte('\n')
			case "tc", "c", "table-cell":
				sb.WriteByte('\t')
			}
		}
		if sb.Len() > maxTextBytes {
			return
		}
	}
}

// naturalLess orders "slide2.xml" before "slide10.xml".
func naturalLess(a, b string) bool {
	na, pa := trailingNum(a)
	nb, pb := trailingNum(b)
	if pa == pb && na >= 0 && nb >= 0 {
		return na < nb
	}
	return a < b
}

func trailingNum(s string) (int, string) {
	s = strings.TrimSuffix(s, ".xml")
	i := len(s)
	for i > 0 && s[i-1] >= '0' && s[i-1] <= '9' {
		i--
	}
	n, err := strconv.Atoi(s[i:])
	if err != nil {
		return -1, s
	}
	return n, s[:i]
}
