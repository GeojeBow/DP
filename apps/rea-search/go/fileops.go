package main

// Acting on several results at once: copy or move them to a folder, send
// them to the Recycle Bin, or rename one. Only indexed items are touched
// (by key, never by a path sent from the page). On Windows the shell does
// the work, with its usual progress, "replace?" and undo support.

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

type fileOpReq struct {
	Op   string   `json:"op"` // copy, move, trash, rename
	Keys []string `json:"keys"`
	Dest string   `json:"dest"` // copy/move: empty = ask with a folder picker
	Name string   `json:"name"` // rename
}

func (s *server) fileOp(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req fileOpReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		bad(w, "잘못된 요청")
		return
	}
	v := s.eng.View()
	var keys []uint64
	var paths []string
	for _, ks := range req.Keys {
		k, ok := parseKey(ks)
		if !ok {
			continue
		}
		if p := v.Path(k); p != "" {
			keys, paths = append(keys, k), append(paths, p)
		}
	}
	if len(paths) == 0 {
		bad(w, "항목을 찾을 수 없습니다")
		return
	}
	if len(paths) > 10000 {
		bad(w, "한 번에 1만 개까지 다룰 수 있습니다")
		return
	}
	res := map[string]any{"op": req.Op, "count": len(paths)}
	switch req.Op {
	case "copy", "move":
		dest := strings.TrimSpace(req.Dest)
		if dest == "" {
			title := map[string]string{"copy": "복사할 위치를 고르세요", "move": "옮길 위치를 고르세요"}[req.Op]
			d, err := pickFolder(title)
			if err != nil {
				bad(w, err.Error())
				return
			}
			if d == "" {
				writeJSON(w, map[string]any{"cancelled": true})
				return
			}
			dest = d
		}
		if st, err := os.Stat(dest); err != nil || !st.IsDir() {
			bad(w, "폴더가 아닙니다: "+dest)
			return
		}
		aborted, err := shellFileOp(req.Op, paths, dest)
		if err != nil {
			errorf("%s 실패 (%d개 → %s): %v", opName(req.Op), len(paths), dest, err)
			bad(w, err.Error())
			return
		}
		logf("%s: %d개 → %s%s", opName(req.Op), len(paths), dest, map[bool]string{true: " (일부 취소)"}[aborted])
		res["dest"], res["aborted"] = dest, aborted
	case "trash":
		aborted, err := shellFileOp("trash", paths, "")
		if err != nil {
			errorf("휴지통으로 보내기 실패 (%d개): %v", len(paths), err)
			bad(w, err.Error())
			return
		}
		logf("휴지통으로 보냄: %d개%s", len(paths), map[bool]string{true: " (일부 취소)"}[aborted])
		res["aborted"] = aborted
	case "rename":
		name := strings.TrimSpace(req.Name)
		if len(paths) != 1 || name == "" || strings.ContainsAny(name, `\/:*?"<>|`) || name == "." || name == ".." {
			bad(w, `이름에 \ / : * ? " < > | 는 쓸 수 없습니다`)
			return
		}
		to := filepath.Join(filepath.Dir(paths[0]), name)
		if _, err := os.Lstat(to); err == nil && !strings.EqualFold(to, paths[0]) {
			bad(w, "같은 이름이 이미 있습니다: "+name)
			return
		}
		if err := os.Rename(paths[0], to); err != nil {
			bad(w, "이름을 바꾸지 못했습니다: "+errText(err))
			return
		}
		logf("이름 바꿈: %s → %s", paths[0], name)
		ix := v.of(keys[0])
		_, dir, _ := ix.Node(keys[0])
		if par, ok := v.Parent(keys[0]); ok {
			ix.Upsert(keys[0], par, name, dir)
		}
		s.eng.bump()
		writeJSON(w, res)
		return
	default:
		bad(w, "알 수 없는 작업")
		return
	}
	// moved or deleted items leave the index now; the change journal (or the
	// next walk) brings in what appeared elsewhere
	if req.Op != "copy" {
		gone := 0
		for i, p := range paths {
			if _, err := os.Lstat(p); err != nil {
				v.of(keys[i]).Remove(keys[i])
				gone++
			}
		}
		res["done"] = gone
		s.eng.bump()
	}
	writeJSON(w, res)
}

func opName(op string) string {
	return map[string]string{"copy": "복사", "move": "이동", "trash": "휴지통"}[op]
}

func (s *server) pickFolderHandler(w http.ResponseWriter, r *http.Request) {
	d, err := pickFolder(r.URL.Query().Get("title"))
	if err != nil {
		bad(w, err.Error())
		return
	}
	writeJSON(w, map[string]string{"path": d})
}

var errNoShell = fmt.Errorf("Windows에서만 쓸 수 있습니다")
