package main

// Content query: what to look for inside files.
//
//	회의 예산          both words (AND)
//	회의 | 예산        either (OR; "OR" also works)
//	회의 !취소         without (NOT; "-취소" also works)
//	"분기 실적"        exact phrase
//
// Options: match case, whole word, regular expression.

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

type CQOpts struct {
	Case, Word, Regex bool
}

type cterm struct {
	text string         // lower-cased unless Case
	re   *regexp.Regexp // set for whole-word and regex terms
	neg  bool
}

type CQuery struct {
	groups [][]cterm // OR of AND-groups
	opts   CQOpts
}

var cTokenRe = regexp.MustCompile(`[!-]?"[^"]*"|\S+`)

func wordRe(s string, caseSens bool) *regexp.Regexp {
	flags := "(?i)"
	if caseSens {
		flags = ""
	}
	// \b is ASCII-only in Go, so spell out letter/number boundaries
	return regexp.MustCompile(flags + `(?:^|[^\p{L}\p{N}_])(` + regexp.QuoteMeta(s) + `)(?:$|[^\p{L}\p{N}_])`)
}

func ParseContentQuery(text string, o CQOpts) (*CQuery, error) {
	q := &CQuery{opts: o}
	text = strings.TrimSpace(text)
	if text == "" {
		return q, nil
	}
	if o.Regex {
		expr := text
		if !o.Case {
			expr = "(?i)" + expr
		}
		re, err := regexp.Compile("(?m)" + expr)
		if err != nil {
			return nil, err
		}
		q.groups = [][]cterm{{{re: re}}}
		return q, nil
	}
	var cur []cterm
	flush := func() {
		if len(cur) > 0 {
			q.groups = append(q.groups, cur)
		}
		cur = nil
	}
	for _, tok := range cTokenRe.FindAllString(text, -1) {
		switch tok {
		case "|", "OR", "또는":
			flush()
			continue
		case "AND", "그리고":
			continue
		}
		neg := false
		if tok == "NOT" {
			continue
		}
		if strings.HasPrefix(tok, "!") || (strings.HasPrefix(tok, "-") && len(tok) > 1) {
			neg, tok = true, tok[1:]
		}
		tok = strings.Trim(tok, `"`)
		if tok == "" {
			continue
		}
		t := cterm{text: tok, neg: neg}
		if !o.Case {
			t.text = strings.ToLower(tok)
		}
		if o.Word {
			t.re = wordRe(tok, o.Case)
		}
		cur = append(cur, t)
	}
	flush()
	return q, nil
}

func (q *CQuery) Empty() bool { return len(q.groups) == 0 }

// prepared text for matching
type ctext struct {
	orig, cmp string // cmp is lower-cased unless Case
}

func (q *CQuery) prep(s string) ctext {
	if q.opts.Case || q.opts.Regex {
		return ctext{s, s}
	}
	return ctext{s, strings.ToLower(s)}
}

func (t cterm) in(c ctext) bool {
	if t.re != nil {
		return t.re.MatchString(c.orig)
	}
	return strings.Contains(c.cmp, t.text)
}

func (q *CQuery) Match(c ctext) bool {
	for _, g := range q.groups {
		ok := true
		for _, t := range g {
			if t.in(c) == t.neg {
				ok = false
				break
			}
		}
		if ok {
			return true
		}
	}
	return false
}

// Seg is a piece of a snippet line; M marks a highlighted match.
type Seg struct {
	T string `json:"t"`
	M bool   `json:"m,omitempty"`
}

type Snippet struct {
	Line int   `json:"line"`
	Segs []Seg `json:"segs"`
}

// spans returns byte ranges of positive-term matches in one line.
func (q *CQuery) spans(line string) [][2]int {
	var out [][2]int
	cmp := line
	lowered := false
	if !q.opts.Case && !q.opts.Regex {
		cmp = strings.ToLower(line)
		lowered = true
	}
	sameLen := len(cmp) == len(line)
	for _, g := range q.groups {
		for _, t := range g {
			if t.neg {
				continue
			}
			if t.re != nil {
				for _, m := range t.re.FindAllStringSubmatchIndex(line, 20) {
					if len(m) >= 4 && m[2] >= 0 {
						out = append(out, [2]int{m[2], m[3]})
					} else {
						out = append(out, [2]int{m[0], m[1]})
					}
				}
				continue
			}
			if lowered && !sameLen {
				continue
			}
			for from := 0; from < len(cmp) && len(out) < 50; {
				i := strings.Index(cmp[from:], t.text)
				if i < 0 || t.text == "" {
					break
				}
				out = append(out, [2]int{from + i, from + i + len(t.text)})
				from += i + len(t.text)
			}
		}
	}
	return out
}

// Snippets returns up to max matching lines (cut to ~160 characters around
// the first match) and the total number of matching lines.
func (q *CQuery) Snippets(text string, max int) ([]Snippet, int) {
	var out []Snippet
	total := 0
	lineNo := 0
	for len(text) > 0 {
		lineNo++
		var line string
		if i := strings.IndexByte(text, '\n'); i >= 0 {
			line, text = text[:i], text[i+1:]
		} else {
			line, text = text, ""
		}
		sp := q.spans(line)
		if len(sp) == 0 {
			continue
		}
		total++
		if len(out) < max {
			out = append(out, Snippet{Line: lineNo, Segs: cutSegs(strings.TrimRight(line, "\r"), sp, 160)})
		}
	}
	return out, total
}

func cutSegs(line string, sp [][2]int, width int) []Seg {
	// window around the first match
	first := sp[0][0]
	for _, s := range sp {
		if s[0] < first {
			first = s[0]
		}
	}
	start := first - width/3
	if start < 0 {
		start = 0
	}
	for start > 0 && !utf8.RuneStart(line[start]) {
		start--
	}
	end := start + width*3 // bytes; Korean is 3 bytes per character
	if end > len(line) {
		end = len(line)
	}
	for end < len(line) && !utf8.RuneStart(line[end]) {
		end++
	}
	marked := make([]bool, end-start)
	for _, s := range sp {
		for i := max(s[0], start); i < min(s[1], end); i++ {
			marked[i-start] = true
		}
	}
	var segs []Seg
	if start > 0 {
		segs = append(segs, Seg{T: "…"})
	}
	i := start
	for i < end {
		j := i
		for j < end && marked[j-start] == marked[i-start] {
			j++
		}
		segs = append(segs, Seg{T: strings.Map(cleanRune, line[i:j]), M: marked[i-start]})
		i = j
	}
	if end < len(line) {
		segs = append(segs, Seg{T: "…"})
	}
	return segs
}

func cleanRune(r rune) rune {
	if r == '\t' {
		return ' '
	}
	if unicode.IsControl(r) {
		return -1
	}
	return r
}
