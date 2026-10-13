package main

import (
	"os"
	"strings"
	"testing"
)

// REA_EXTRACT="a.hwp b.pdf" go test -run TestExtractFiles -v prints what
// content search would read from real files.
func TestExtractFiles(t *testing.T) {
	list := os.Getenv("REA_EXTRACT")
	if list == "" {
		t.Skip("set REA_EXTRACT")
	}
	for _, p := range strings.Split(list, "\n") {
		if p == "" {
			continue
		}
		s, err := ExtractText(p)
		r := []rune(strings.Join(strings.Fields(s), " "))
		if len(r) > 160 {
			r = r[:160]
		}
		t.Logf("%s: %d bytes err=%v | %s", p[strings.LastIndex(p, "/")+1:], len(s), err, string(r))
	}
}
