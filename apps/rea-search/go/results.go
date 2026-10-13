package main

// Result shaping on top of a name search: file-type categories, size and
// date filters, sorting, duplicate detection. Sizes and dates are not in the
// name index, so they are read with Lstat on demand (in parallel) and cached
// until the file changes.

import (
	"sort"
	"strings"
)

// ---- categories ----

var categoryExts = map[string][]string{
	"doc":     strings.Fields("txt md rtf doc docx odt hwp hwpx pdf xls xlsx xlsm csv ods ppt pptx odp epub log ini cfg"),
	"image":   strings.Fields("jpg jpeg png gif bmp webp tif tiff svg ico heic heif raw cr2 nef psd ai"),
	"video":   strings.Fields("mp4 mkv avi mov wmv flv webm m4v mpg mpeg ts 3gp"),
	"audio":   strings.Fields("mp3 wav flac aac ogg m4a wma opus mid midi"),
	"archive": strings.Fields("zip 7z rar tar gz tgz bz2 xz iso cab alz egg"),
	"exe":     strings.Fields("exe msi bat cmd ps1 com scr appx msix lnk"),
	"code":    strings.Fields("c h cpp hpp cs java kt go rs py js ts tsx jsx html htm css scss json xml yaml yml toml sql sh php rb swift vue lua r m dart"),
}

var extCategory = func() map[string]string {
	m := map[string]string{}
	for c, exts := range categoryExts {
		for _, e := range exts {
			m[e] = c
		}
	}
	return m
}()

// Categories in display order; "folder" and "other" are implicit.
var categoryOrder = []string{"folder", "doc", "image", "video", "audio", "archive", "exe", "code", "other"}

func extOf(name string) string {
	dot := strings.LastIndexByte(name, '.')
	if dot <= 0 || dot == len(name)-1 {
		return ""
	}
	return strings.ToLower(name[dot+1:])
}

func categoryOf(name string, dir bool) string {
	if dir {
		return "folder"
	}
	if c, ok := extCategory[extOf(name)]; ok {
		return c
	}
	return "other"
}

// meta is a file's size and modification time (unix seconds). ok=false
// means it could not be read.
type meta struct {
	size int64
	mod  int64
	ok   bool
}

// ---- filters and sorting ----

type Filter struct {
	Category string // "" = all
	MinSize  int64  // bytes, -1 = none
	MaxSize  int64
	After    int64 // unix seconds, 0 = none
	Before   int64
	Sort     string // name, path, size, mod, ext, type
	Desc     bool
}

func (f Filter) needsMeta() bool {
	return f.MinSize >= 0 || f.MaxSize >= 0 || f.After > 0 || f.Before > 0 || f.Sort == "size" || f.Sort == "mod"
}

// MetaLimit caps how many results are stat'ed for size/date work.
const MetaLimit = 500000

// Facets counts results per category.
func Facets(v *View, keys []uint64) map[string]int {
	out := map[string]int{}
	for _, k := range keys {
		name, dir, ok := v.Node(k)
		if ok {
			out[categoryOf(name, dir)]++
		}
	}
	return out
}

// Apply narrows and orders a name-search result. truncated reports that only
// the first MetaLimit results were considered for size/date filters.
func Apply(v *View, keys []uint64, f Filter, progress func(int, int)) (out []uint64, truncated bool) {
	out = keys
	if f.Category != "" {
		res := make([]uint64, 0, len(keys)/4)
		for _, k := range keys {
			name, dir, ok := v.Node(k)
			if ok && categoryOf(name, dir) == f.Category {
				res = append(res, k)
			}
		}
		out = res
	}
	if f.needsMeta() {
		if len(out) > MetaLimit {
			out, truncated = out[:MetaLimit], true
		}
		v.EnsureMeta(out, progress)
		if f.MinSize >= 0 || f.MaxSize >= 0 || f.After > 0 || f.Before > 0 {
			res := make([]uint64, 0, len(out))
			for _, k := range out {
				m, _ := v.Meta(k)
				if !m.ok {
					continue
				}
				if f.MinSize >= 0 && m.size < f.MinSize || f.MaxSize >= 0 && (m.size < 0 || m.size > f.MaxSize) {
					continue
				}
				if f.After > 0 && m.mod < f.After || f.Before > 0 && m.mod >= f.Before {
					continue
				}
				res = append(res, k)
			}
			out = res
		}
	}
	if (f.Sort == "" || f.Sort == "name") && !f.Desc {
		return out, truncated // index order is already by name
	}
	if sameSlice(out, keys) {
		out = append([]uint64(nil), out...) // never reorder the cached search result
	}
	sortKeys(v, out, f.Sort, f.Desc)
	return out, truncated
}

func sameSlice(a, b []uint64) bool { return len(a) > 0 && len(b) > 0 && &a[0] == &b[0] }

func sortKeys(v *View, keys []uint64, by string, desc bool) {
	type item struct {
		k   uint64
		s   string
		n   int64
		dir bool
	}
	items := make([]item, len(keys))
	for i, k := range keys {
		name, dir, _ := v.Node(k)
		it := item{k: k, dir: dir}
		switch by {
		case "path":
			it.s = strings.ToLower(v.Folder(k)) + "\x00" + strings.ToLower(name)
		case "size", "mod":
			m, _ := v.Meta(k)
			it.n = m.size
			if by == "mod" {
				it.n = m.mod
			}
			it.s = strings.ToLower(name)
		case "ext", "type":
			it.s = categoryOf(name, dir) + "\x00" + extOf(name) + "\x00" + strings.ToLower(name)
			if by == "ext" {
				it.s = extOf(name) + "\x00" + strings.ToLower(name)
			}
		default:
			it.s = strings.ToLower(name)
		}
		items[i] = it
	}
	numeric := by == "size" || by == "mod"
	sort.SliceStable(items, func(i, j int) bool {
		a, b := items[i], items[j]
		if numeric && a.n != b.n {
			return (a.n < b.n) != desc
		}
		if a.s != b.s {
			return (a.s < b.s) != desc
		}
		return false
	})
	for i := range items {
		keys[i] = items[i].k
	}
}

// Duplicates groups files with the same name and size. It returns the keys
// ordered group by group, and the group number of each key.
func Duplicates(v *View, keys []uint64, progress func(int, int)) ([]uint64, map[uint64]int) {
	var files []uint64
	for _, k := range keys {
		if _, dir, ok := v.Node(k); ok && !dir {
			files = append(files, k)
		}
		if len(files) >= MetaLimit {
			break
		}
	}
	v.EnsureMeta(files, progress)
	type gk struct {
		name string
		size int64
	}
	groups := map[gk][]uint64{}
	var order []gk
	for _, k := range files {
		m, _ := v.Meta(k)
		if !m.ok || m.size <= 0 {
			continue
		}
		name, _, _ := v.Node(k)
		g := gk{strings.ToLower(name), m.size}
		if _, seen := groups[g]; !seen {
			order = append(order, g)
		}
		groups[g] = append(groups[g], k)
	}
	// biggest wasted space first
	sort.SliceStable(order, func(i, j int) bool {
		a, b := order[i], order[j]
		return a.size*int64(len(groups[a])-1) > b.size*int64(len(groups[b])-1)
	})
	var out []uint64
	gid := map[uint64]int{}
	n := 0
	for _, g := range order {
		if len(groups[g]) < 2 {
			continue
		}
		n++
		for _, k := range groups[g] {
			out = append(out, k)
			gid[k] = n
		}
	}
	return out, gid
}
