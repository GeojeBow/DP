package main

// Reader for the Compound File Binary format ([MS-CFB], the "OLE" container
// that holds old .hwp, .doc, .xls and .ppt files), written from Microsoft's
// published specification. It only reads; the whole file is in memory.

import (
	"encoding/binary"
	"errors"
	"unicode/utf16"
)

var errCFB = errors.New("not a compound file")

const (
	cfbEnd  = 0xFFFFFFFE
	cfbFree = 0xFFFFFFFF
)

type cfbEntry struct {
	name               string
	typ                byte // 1 storage, 2 stream, 5 root
	left, right, child uint32
	start              uint32
	size               uint64
}

type cfbFile struct {
	data     []byte
	ssz      int // sector size
	fat      []uint32
	minifat  []uint32
	cutoff   uint64
	entries  []cfbEntry
	ministrm []byte
}

func isCFB(b []byte) bool {
	return len(b) >= 512 && string(b[:8]) == "\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1"
}

func openCFB(b []byte) (*cfbFile, error) {
	if !isCFB(b) {
		return nil, errCFB
	}
	le := binary.LittleEndian
	shift := le.Uint16(b[0x1E:])
	if shift != 9 && shift != 12 {
		return nil, errCFB
	}
	c := &cfbFile{data: b, ssz: 1 << shift, cutoff: uint64(le.Uint32(b[0x38:]))}
	// FAT sector list: 109 entries in the header, the rest in DIFAT sectors
	var fatSecs []uint32
	for i := 0; i < 109; i++ {
		s := le.Uint32(b[0x4C+4*i:])
		if s < cfbEnd {
			fatSecs = append(fatSecs, s)
		}
	}
	dif, ndif := le.Uint32(b[0x44:]), le.Uint32(b[0x48:])
	per := c.ssz/4 - 1
	for n := uint32(0); dif < cfbEnd && n < ndif && n < 1<<16; n++ {
		sec := c.sector(dif)
		if sec == nil {
			return nil, errCFB
		}
		if len(sec) < c.ssz {
			return nil, errCFB
		}
		for i := 0; i < per; i++ {
			if s := le.Uint32(sec[4*i:]); s < cfbEnd {
				fatSecs = append(fatSecs, s)
			}
		}
		dif = le.Uint32(sec[4*per:])
	}
	for _, s := range fatSecs {
		sec := c.sector(s)
		if sec == nil {
			return nil, errCFB
		}
		for i := 0; i+4 <= len(sec) && i < c.ssz; i += 4 {
			c.fat = append(c.fat, le.Uint32(sec[i:]))
		}
	}
	dir, err := c.chain(le.Uint32(b[0x30:]), c.fat, c.ssz, c.sector, 0)
	if err != nil {
		return nil, err
	}
	for off := 0; off+128 <= len(dir); off += 128 {
		e := dir[off : off+128]
		nl := int(le.Uint16(e[64:]))
		if nl > 64 {
			nl = 64
		}
		u := make([]uint16, 0, 32)
		for i := 0; i+1 < nl-1; i += 2 {
			u = append(u, le.Uint16(e[i:]))
		}
		c.entries = append(c.entries, cfbEntry{
			name: string(utf16.Decode(u)), typ: e[66],
			left: le.Uint32(e[68:]), right: le.Uint32(e[72:]), child: le.Uint32(e[76:]),
			start: le.Uint32(e[116:]), size: le.Uint64(e[120:]),
		})
	}
	if len(c.entries) == 0 || c.entries[0].typ != 5 {
		return nil, errCFB
	}
	if shift == 9 {
		for i := range c.entries {
			c.entries[i].size &= 0xFFFFFFFF // v3 files may leave junk in the high half
		}
	}
	if mf := le.Uint32(b[0x3C:]); mf < cfbEnd {
		raw, err := c.chain(mf, c.fat, c.ssz, c.sector, 0)
		if err != nil {
			return nil, err
		}
		for i := 0; i+4 <= len(raw); i += 4 {
			c.minifat = append(c.minifat, le.Uint32(raw[i:]))
		}
	}
	root := c.entries[0]
	if root.start < cfbEnd {
		c.ministrm, _ = c.chain(root.start, c.fat, c.ssz, c.sector, root.size)
	}
	return c, nil
}

func (c *cfbFile) sector(n uint32) []byte {
	off := (int64(n) + 1) * int64(c.ssz)
	if off < 0 || off+int64(c.ssz) > int64(len(c.data)) {
		// the last sector of a file may be short
		if off >= 0 && off < int64(len(c.data)) {
			return c.data[off:]
		}
		return nil
	}
	return c.data[off : off+int64(c.ssz)]
}

func (c *cfbFile) miniSector(n uint32) []byte {
	off := int64(n) * 64
	if off < 0 || off+64 > int64(len(c.ministrm)) {
		return nil
	}
	return c.ministrm[off : off+64]
}

// chain follows a sector chain; size 0 means "until the end of the chain".
func (c *cfbFile) chain(start uint32, table []uint32, ssz int, get func(uint32) []byte, size uint64) ([]byte, error) {
	var out []byte
	seen := 0
	for s := start; s < cfbEnd; {
		if seen > len(table) {
			return nil, errCFB // loop
		}
		seen++
		sec := get(s)
		if sec == nil {
			return nil, errCFB
		}
		out = append(out, sec...)
		if size > 0 && uint64(len(out)) >= size {
			break
		}
		if int(s) >= len(table) {
			return nil, errCFB
		}
		s = table[s]
	}
	if size > 0 && uint64(len(out)) > size {
		out = out[:size]
	}
	return out, nil
}

// find returns the entry index at a path like "BodyText/Section0", or -1.
func (c *cfbFile) find(path ...string) int {
	cur := 0
	for _, name := range path {
		cur = c.childNamed(c.entries[cur].child, name, 0)
		if cur < 0 {
			return -1
		}
	}
	return cur
}

func (c *cfbFile) childNamed(i uint32, name string, depth int) int {
	if i >= uint32(len(c.entries)) || depth > 64 {
		return -1
	}
	if c.entries[i].name == name {
		return int(i)
	}
	if r := c.childNamed(c.entries[i].left, name, depth+1); r >= 0 {
		return r
	}
	return c.childNamed(c.entries[i].right, name, depth+1)
}

// children lists the names under a storage.
func (c *cfbFile) children(idx int) []string {
	var out []string
	var walk func(i uint32, depth int)
	walk = func(i uint32, depth int) {
		if i >= uint32(len(c.entries)) || depth > 64 || len(out) > 4096 {
			return
		}
		walk(c.entries[i].left, depth+1)
		out = append(out, c.entries[i].name)
		walk(c.entries[i].right, depth+1)
	}
	walk(c.entries[idx].child, 0)
	return out
}

func (c *cfbFile) stream(path ...string) ([]byte, error) {
	i := c.find(path...)
	if i < 0 || c.entries[i].typ != 2 {
		return nil, errCFB
	}
	e := c.entries[i]
	if e.size == 0 {
		return nil, nil
	}
	if e.size > maxFileBytes*2 {
		return nil, errCFB
	}
	if e.size < c.cutoff {
		return c.chain(e.start, c.minifat, 64, c.miniSector, e.size)
	}
	return c.chain(e.start, c.fat, c.ssz, c.sector, e.size)
}
