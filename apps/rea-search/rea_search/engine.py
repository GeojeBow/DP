"""Ties index, indexers, live updates and the on-disk cache together."""

from __future__ import annotations

import os
import pickle
import threading
import time

from .index import Index, IndexBuilder
from . import walker

CACHE_VERSION = 1
COMPACT_AT = 20000  # fold live changes back into the sorted index after this many


def cache_path() -> str:
    base = os.environ.get("LOCALAPPDATA") or os.path.join(os.path.expanduser("~"), ".cache")
    return os.path.join(base, "rea-search", "index.pkl")


class Engine:
    def __init__(self, roots: list[str] | None = None, force_walk: bool = False,
                 progress=None, log=print):
        self.roots = roots
        self.force_walk = force_walk or bool(roots)
        self.progress = progress
        self.log = log
        self.index = Index()
        self.mode = "empty"
        self.volumes = []
        self._stop = threading.Event()
        self.on_change = None  # called from the watcher thread after changes are applied

    # ---- building -----------------------------------------------------
    def _ntfs_possible(self) -> bool:
        if os.name != "nt" or self.force_walk:
            return False
        from . import ntfs
        if not ntfs.is_admin():
            self.log("관리자 권한이 아니라서 MFT를 직접 읽을 수 없습니다. 폴더 탐색 방식으로 색인합니다.")
            return False
        return bool(ntfs.ntfs_drives())

    def build(self) -> None:
        t = time.perf_counter()
        b = IndexBuilder()
        if self._ntfs_possible():
            from . import ntfs
            self._close_volumes()
            self.volumes = [ntfs.Volume(d, i + 1) for i, d in enumerate(ntfs.ntfs_drives())]
            for v in self.volumes:
                v.enumerate_into(b, self.progress)
            vols = {v.base >> 64: v.root_key for v in self.volumes}
            idx = b.build(default_root=lambda k: vols.get(k >> 64))
            self.mode = "ntfs"
        else:
            walker.walk_into(b, self.roots or walker.default_roots(), self.progress,
                             skip=[os.path.dirname(cache_path())])
            idx = b.build()
            self.mode = "walk"
        self.index = idx
        self.log(f"색인 완료: {len(idx):,}개 항목, {time.perf_counter() - t:.1f}초 ({self.mode})")

    def load_or_build(self) -> None:
        """Start from the cache when possible, like Everything does on launch."""
        if self._load_cache():
            return
        self.build()
        self.save()

    # ---- cache --------------------------------------------------------
    def save(self) -> None:
        p = cache_path()
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with self.index.lock:
            idx = self.index.compact() if self.index.overlay_size else self.index
            data = {"v": CACHE_VERSION, "mode": self.mode, "roots": self.roots,
                    "index": idx.state(),
                    "journals": {v.letter: (v.journal_id, v.next_usn) for v in self.volumes}}
        tmp = p + ".tmp"
        with open(tmp, "wb") as f:
            pickle.dump(data, f, protocol=pickle.HIGHEST_PROTOCOL)
        os.replace(tmp, p)

    def _load_cache(self) -> bool:
        p = cache_path()
        if not os.path.exists(p):
            return False
        t = time.perf_counter()
        try:
            with open(p, "rb") as f:
                data = pickle.load(f)
        except Exception as e:  # corrupt cache: rebuild
            self.log(f"캐시를 읽지 못했습니다 ({e}). 다시 색인합니다.")
            return False
        if data.get("v") != CACHE_VERSION or data.get("roots") != self.roots:
            return False
        want_ntfs = self._ntfs_possible()
        if want_ntfs != (data["mode"] == "ntfs"):
            return False
        self.index = Index.from_state(data["index"])
        self.mode = data["mode"]
        if self.mode == "ntfs":
            from . import ntfs
            self._close_volumes()
            self.volumes = [ntfs.Volume(d, i + 1) for i, d in enumerate(ntfs.ntfs_drives())]
            for v in self.volumes:
                saved = data["journals"].get(v.letter)
                if not saved or saved[0] != v.journal_id or saved[1] < v.first_usn:
                    self.log(f"{v.letter}: 변경 기록이 끊겨서 다시 색인합니다.")
                    return False
                v.next_usn = saved[1]
            try:
                n = self.poll_changes()  # catch up on what changed while we were closed
            except OSError:
                return False
            self.log(f"캐시에서 {len(self.index):,}개 항목을 {time.perf_counter() - t:.1f}초 만에 불러오고 "
                     f"변경 {n:,}건을 반영했습니다.")
        else:
            self.log(f"캐시에서 {len(self.index):,}개 항목을 불러왔습니다. 백그라운드에서 다시 탐색합니다.")
            threading.Thread(target=self._rebuild_bg, daemon=True).start()
        return True

    def _rebuild_bg(self) -> None:
        self.build()
        self.save()
        if self.on_change:
            self.on_change()

    # ---- live updates -------------------------------------------------
    def poll_changes(self) -> int:
        if self.mode != "ntfs":
            return 0
        from . import ntfs
        n = 0
        for v in self.volumes:
            for key, pkey, reason, is_dir, name in v.read_changes():
                ntfs.apply_change(self.index, v, key, pkey, reason, is_dir, name)
                n += 1
        if self.index.overlay_size > COMPACT_AT:
            new = self.index.compact()
            self.index = new
        return n

    def start_watching(self, interval: float = 1.0) -> None:
        if self.mode != "ntfs":
            return

        def loop():
            while not self._stop.wait(interval):
                try:
                    if self.poll_changes() and self.on_change:
                        self.on_change()
                except OSError as e:
                    self.log(f"변경 감시 오류: {e}. 다시 색인합니다.")
                    self.build()
                    if self.on_change:
                        self.on_change()

        threading.Thread(target=loop, daemon=True).start()

    def stop(self) -> None:
        self._stop.set()
        try:
            if self.mode != "empty":  # never overwrite the cache with an unfinished index
                self.save()
        finally:
            self._close_volumes()

    def _close_volumes(self) -> None:
        for v in self.volumes:
            v.close()
        self.volumes = []

    # ---- queries ------------------------------------------------------
    def search(self, text: str) -> list:
        return self.index.search(text)
