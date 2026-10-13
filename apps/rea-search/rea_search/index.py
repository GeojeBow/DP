"""In-memory file name index with Everything-style search.

Design (same idea as voidtools Everything):
  * Every file/folder is one entry: name + parent pointer + is_dir.
    Full paths are never stored; they are rebuilt on demand from parents.
  * Entries are kept sorted by lower-cased name, so search results come
    out already sorted with no per-query sort.
  * All lower-cased names are joined into one big string ("blob").
    A substring search is then a loop of str.find() over that blob, which
    runs in C and is far faster than testing names one by one in Python.
  * Live changes (from the NTFS USN journal) go into a small overlay
    (`_extra` / `_removed`) so the big sorted arrays never need rebuilding
    on every change. `compact()` folds the overlay back in.
"""

from __future__ import annotations

import bisect
import fnmatch
import os
import re
import threading
from dataclasses import dataclass, field

SEP = "\n"  # never appears in a file name


class IndexBuilder:
    """Collects raw (key, parent_key, name, is_dir) records, then builds an Index.

    Keys are any hashable ids: NTFS file reference numbers, or plain counters
    for the directory walker. A record whose parent key is unknown is attached
    to the root of its volume.
    """

    def __init__(self) -> None:
        self._recs: dict = {}  # key -> (parent_key, name, is_dir)
        self._roots: dict = {}  # key -> display prefix, e.g. "C:" or "/home/me"

    def add_root(self, key, display: str) -> None:
        self._roots[key] = display
        self._recs[key] = (None, display, True)

    def add(self, key, parent_key, name: str, is_dir: bool) -> None:
        self._recs[key] = (parent_key, name, is_dir)

    def __len__(self) -> int:
        return len(self._recs)

    def build(self, default_root=None) -> "Index":
        recs = self._recs
        keys = list(recs.keys())
        # Sort by lower-cased name; this order is the result order of every search.
        keys.sort(key=lambda k: recs[k][1].lower())
        key_to_idx = {k: i for i, k in enumerate(keys)}
        names, parents, isdir = [], [], bytearray(len(keys))
        for i, k in enumerate(keys):
            pk, name, d = recs[k]
            names.append(name)
            if k in self._roots:
                parents.append(-1)
            else:
                p = key_to_idx.get(pk)
                if p is None and default_root is not None:
                    p = key_to_idx.get(default_root(k))
                parents.append(-1 if p is None else p)
            isdir[i] = 1 if d else 0
        idx = Index()
        idx._load(keys, names, parents, isdir, set(self._roots))
        return idx


@dataclass
class Query:
    """A parsed search string.

    Syntax (subset of Everything):
      foo bar       name contains "foo" AND "bar"   (case-insensitive)
      a | b         OR between whole groups
      !foo          name does NOT contain foo
      *.txt  a?c    wildcards (match the whole name)
      dir\\foo      a term with \\ or / is matched against the full path
      ext:jpg;png   extension filter
      file:  folder:  only files / only folders
      "two words"   quoted term with spaces
    """

    plain: list = field(default_factory=list)
    negated: list = field(default_factory=list)
    wildcards: list = field(default_factory=list)
    literals: list = field(default_factory=list)  # fixed text inside wildcards, e.g. ".mp4" in "*.mp4"
    paths: list = field(default_factory=list)
    exts: set | None = None
    only: str | None = None  # "file" | "folder"

    @property
    def empty(self) -> bool:
        return not (self.plain or self.negated or self.wildcards or self.paths or self.exts or self.only)


_TOKEN = re.compile(r'!?"[^"]*"|\S+')


def parse_query(text: str) -> list[Query]:
    groups = [g for g in re.split(r"\s\|\s|\|", text)]
    out = []
    for g in groups:
        q = Query()
        for tok in _TOKEN.findall(g):
            neg = tok.startswith("!")
            if neg:
                tok = tok[1:]
            tok = tok.strip('"').lower()
            if not tok:
                continue
            if tok.startswith("ext:"):
                q.exts = {e.lstrip(".") for e in tok[4:].split(";") if e}
            elif tok in ("file:", "files:"):
                q.only = "file"
            elif tok in ("folder:", "folders:"):
                q.only = "folder"
            elif neg:
                q.negated.append(tok)
            elif "\\" in tok or "/" in tok:
                q.paths.append(tok.replace("/", "\\"))
            elif "*" in tok or "?" in tok:
                q.wildcards.append(re.compile(fnmatch.translate(tok), re.S))
                q.literals += [p for p in re.split(r"[*?\[\]]", tok) if p]
            else:
                q.plain.append(tok)
        out.append(q)
    return out


class Index:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self._load([], [], [], bytearray(), set())

    # ---- construction -------------------------------------------------
    def _load(self, keys, names, parents, isdir, roots) -> None:
        self.keys = keys
        self.names = names
        self.parents = parents
        self.isdir = isdir
        self.roots = roots
        self.key_to_idx = {k: i for i, k in enumerate(keys)}
        self.lower = [n.lower() for n in names]
        self.blob = SEP + SEP.join(self.lower) + SEP
        # starts[i] = offset of name i inside blob
        self.starts = []
        pos = 1
        for n in self.lower:
            self.starts.append(pos)
            pos += len(n) + 1
        self._extra: dict = {}  # key -> (parent_key, name, is_dir); live additions/renames
        self._removed: set = set()  # main indices that are deleted or superseded by _extra
        self._path_cache: dict = {}

    def state(self) -> dict:
        """Plain data for saving to disk (see cache.py)."""
        return {"keys": self.keys, "names": self.names, "parents": self.parents,
                "isdir": bytes(self.isdir), "roots": list(self.roots)}

    @classmethod
    def from_state(cls, st: dict) -> "Index":
        idx = cls()
        idx._load(st["keys"], st["names"], st["parents"], bytearray(st["isdir"]), set(st["roots"]))
        return idx

    def __len__(self) -> int:
        return len(self.keys) - len(self._removed) + len(self._extra)

    # ---- live updates -------------------------------------------------
    def upsert(self, key, parent_key, name: str, is_dir: bool) -> None:
        with self.lock:
            i = self.key_to_idx.get(key)
            if i is not None:
                self._removed.add(i)
            self._extra[key] = (parent_key, name, is_dir)
            if is_dir:
                self._path_cache.clear()

    def remove(self, key) -> None:
        with self.lock:
            i = self.key_to_idx.get(key)
            if i is not None:
                self._removed.add(i)
            if self._extra.pop(key, None) is not None or (i is not None and self.isdir[i]):
                self._path_cache.clear()

    def compact(self) -> "Index":
        """Rebuild a fresh sorted Index with the overlay merged in."""
        with self.lock:
            b = IndexBuilder()
            for i, k in enumerate(self.keys):
                if i in self._removed:
                    continue
                p = self.parents[i]
                if p == -1:
                    b.add_root(k, self.names[i])
                else:
                    b.add(k, self.keys[p], self.names[i], bool(self.isdir[i]))
            for k, (pk, name, d) in self._extra.items():
                b.add(k, pk, name, d)
            return b.build()

    @property
    def overlay_size(self) -> int:
        return len(self._extra) + len(self._removed)

    # ---- entry access -------------------------------------------------
    def node(self, key):
        """(name, parent_key, is_dir) for a key, live overlay first."""
        e = self._extra.get(key)
        if e is not None:
            return e[1], e[0], e[2]
        i = self.key_to_idx.get(key)
        if i is None:
            return None
        p = self.parents[i]
        return self.names[i], (None if p == -1 else self.keys[p]), bool(self.isdir[i])

    def path(self, key) -> str:
        """Full path, rebuilt by walking parent pointers (folders are cached)."""
        parts = []
        k = key
        seen = 0
        while k is not None and seen < 512:
            if k != key and k in self._path_cache:
                parts.append(self._path_cache[k])
                break
            n = self.node(k)
            if n is None:
                break
            parts.append(n[0])
            if k in self.roots:
                break
            k = n[1]
            seen += 1
        parts.reverse()
        full = _join(parts)
        _, pk, _ = self.node(key) or (None, None, None)
        if pk is not None and pk not in self._path_cache:
            self._path_cache[pk] = os.path.dirname(full) or full
        return full

    def folder(self, key) -> str:
        n = self.node(key)
        if n is None or n[1] is None:
            return ""
        return self.path(n[1])

    # ---- search -------------------------------------------------------
    def search(self, text: str) -> list:
        """Return matching keys, sorted by name (live changes listed first)."""
        groups = parse_query(text)
        with self.lock:
            if len(groups) == 1:
                return self._search_group(groups[0])
            seen, out = set(), []
            for g in groups:
                for k in self._search_group(g):
                    if k not in seen:
                        seen.add(k)
                        out.append(k)
            return out

    def _search_group(self, q: Query) -> list:
        extra_hits = [k for k, (pk, name, d) in self._extra.items()
                      if self._match(q, k, name.lower(), d)]
        keys, removed = self.keys, self._removed
        if q.empty:
            main = keys if not removed else [k for i, k in enumerate(keys) if i not in removed]
            return extra_hits + list(main)

        cand = self._candidates(q)
        out = extra_hits
        lower, isdir = self.lower, self.isdir
        need_check = len(q.plain) > 1 or q.literals or q.negated or q.wildcards or q.paths or q.exts or q.only
        for i in cand:
            if i in removed:
                continue
            if need_check and not self._match(q, keys[i], lower[i], isdir[i]):
                continue
            out.append(keys[i])
        return out

    def _candidates(self, q: Query):
        """Indices whose name contains the longest plain term (C-speed scan)."""
        terms = q.plain + q.literals
        if not terms:
            return range(len(self.keys))
        term = max(terms, key=len)
        blob, starts, find = self.blob, self.starts, self.blob.find
        res = []
        pos = find(term, 1)
        while pos != -1:
            i = bisect.bisect_right(starts, pos) - 1
            res.append(i)
            # jump to the next name so one name is reported only once
            nxt = starts[i + 1] if i + 1 < len(starts) else len(blob)
            pos = find(term, nxt)
        return res

    def _match(self, q: Query, key, low: str, is_dir) -> bool:
        for t in q.plain:
            if t not in low:
                return False
        for t in q.negated:
            if t in low:
                return False
        for rx in q.wildcards:
            if not rx.match(low):
                return False
        if q.only == "file" and is_dir:
            return False
        if q.only == "folder" and not is_dir:
            return False
        if q.exts is not None:
            if is_dir:
                return False
            dot = low.rfind(".")
            if dot < 0 or low[dot + 1:] not in q.exts:
                return False
        if q.paths:
            p = self.path(key).lower().replace("/", "\\")  # compare with \ on every OS
            for t in q.paths:
                if t not in p:
                    return False
        return True


def _join(parts: list) -> str:
    if not parts:
        return ""
    head = parts[0]
    if len(head) == 2 and head[1] == ":":  # Windows drive "C:"
        head += "\\"
        return head + "\\".join(parts[1:])
    return os.path.join(head, *parts[1:])
