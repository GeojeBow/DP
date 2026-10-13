package main

import (
	"bytes"
	"os"
	"testing"
)

// The in-app manual is a copy of README.md; keep them the same.
func TestManualMatchesReadme(t *testing.T) {
	readme, err := os.ReadFile("../README.md")
	if err != nil {
		t.Skip("README.md not next to the source")
	}
	manual, _ := webFS.ReadFile("web/manual.md")
	if !bytes.Equal(readme, manual) {
		t.Fatal("web/manual.md differs from README.md: copy README.md to web/manual.md")
	}
}
