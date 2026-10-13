//go:build !windows

package main

import (
	"io"
	"os"
	"path/filepath"
)

func pickFolder(title string) (string, error) { return "", errNoShell }

// shellFileOp without the Windows shell: plain copy and move (for tests);
// there is no Recycle Bin.
func shellFileOp(op string, paths []string, dest string) (bool, error) {
	for _, p := range paths {
		to := filepath.Join(dest, filepath.Base(p))
		switch op {
		case "move":
			if err := os.Rename(p, to); err != nil {
				return false, err
			}
		case "copy":
			if err := copyFile(p, to); err != nil {
				return false, err
			}
		default:
			return false, errNoShell
		}
	}
	return false, nil
}

func copyFile(from, to string) error {
	in, err := os.Open(from)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(to)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}
