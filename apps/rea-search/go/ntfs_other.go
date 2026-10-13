//go:build !windows

package main

import "os"

func buildNTFS(progress func(int, string), log func(string)) (*Index, watcher, bool) {
	return nil, nil, false
}

func defaultRoots() []string {
	home, _ := os.UserHomeDir()
	return []string{home}
}

func resumeNTFS(saved map[string][2]int64, log func(string)) (watcher, bool) { return nil, false }

func canNTFS() bool { return false }
