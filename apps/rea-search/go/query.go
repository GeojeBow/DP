package main

import (
	"regexp"
	"strings"
)

// Query is one AND-group of a search string.
//
//	foo bar       name contains foo AND bar (case-insensitive)
//	a | b         OR between groups
//	!foo          name does not contain foo
//	*.txt  a?c    wildcards, matched against the whole name
//	dir\foo       a term with \ or / is matched against the full path
//	ext:jpg;png   extension filter
//	file:  folder:
//	"two words"   quoted term
type Query struct {
	Plain, Negated, Wildcards, Paths []string
	Exts                             map[string]bool
	Only                             string
	Case, InPath                     bool
	Re                               *regexp.Regexp // regex mode: replaces the term lists
}

func (q *Query) Empty() bool {
	return len(q.Plain)+len(q.Negated)+len(q.Wildcards)+len(q.Paths) == 0 && q.Exts == nil && q.Only == "" && q.Re == nil
}

var tokenRe = regexp.MustCompile(`!?"[^"]*"|\S+`)
var orRe = regexp.MustCompile(`\s*\|\s*`)

func ParseQuery(text string) []*Query {
	q, _ := ParseQueryOpts(text, NameOpts{})
	return q
}

// ParseQueryOpts applies the search-box toggles. In regex mode the whole text
// is one expression (case-insensitive unless Case is on).
func ParseQueryOpts(text string, o NameOpts) ([]*Query, error) {
	if o.Regex {
		expr := text
		if !o.Case {
			expr = "(?i)" + expr
		}
		re, err := regexp.Compile(expr)
		if err != nil {
			return nil, err
		}
		if strings.TrimSpace(text) == "" {
			re = nil
		}
		return []*Query{{Re: re, Case: true, InPath: o.Path}}, nil
	}
	var out []*Query
	for _, g := range orRe.Split(text, -1) {
		q := &Query{Case: o.Case, InPath: o.Path}
		for _, tok := range tokenRe.FindAllString(g, -1) {
			neg := strings.HasPrefix(tok, "!")
			if neg {
				tok = tok[1:]
			}
			tok = strings.Trim(tok, `"`)
			if tok == "" {
				continue
			}
			if low := strings.ToLower(tok); strings.HasPrefix(low, "ext:") || strings.HasSuffix(low, ":") || !o.Case {
				tok = low
			}
			switch {
			case strings.HasPrefix(tok, "ext:"):
				q.Exts = map[string]bool{}
				for _, e := range strings.Split(tok[4:], ";") {
					if e = strings.TrimPrefix(e, "."); e != "" {
						q.Exts[e] = true
					}
				}
			case tok == "file:" || tok == "files:":
				q.Only = "file"
			case tok == "folder:" || tok == "folders:":
				q.Only = "folder"
			case neg:
				q.Negated = append(q.Negated, tok)
			case strings.ContainsAny(tok, `\/`):
				q.Paths = append(q.Paths, strings.ReplaceAll(tok, "/", `\`))
			case strings.ContainsAny(tok, "*?"):
				q.Wildcards = append(q.Wildcards, tok)
			default:
				q.Plain = append(q.Plain, tok)
			}
		}
		out = append(out, q)
	}
	return out, nil
}

// wildMatch matches the whole string against a pattern with * and ?.
func wildMatch(pat, s string) bool {
	if !strings.Contains(pat, "?") { // bytes are safe without '?': no rune splitting needed
		return wildMatchT([]byte(pat), []byte(s))
	}
	return wildMatchT([]rune(pat), []rune(s))
}

func wildMatchT[T byte | rune](p, n []T) bool {
	pi, si, star, mark := 0, 0, -1, 0
	for si < len(n) {
		if pi < len(p) && (p[pi] == '?' || p[pi] == n[si]) {
			pi++
			si++
		} else if pi < len(p) && p[pi] == '*' {
			star, mark = pi, si
			pi++
		} else if star >= 0 {
			pi = star + 1
			mark++
			si = mark
		} else {
			return false
		}
	}
	for pi < len(p) && p[pi] == '*' {
		pi++
	}
	return pi == len(p)
}
