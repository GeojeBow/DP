"""Everything-style window: a search box over a live result list (tkinter)."""

from __future__ import annotations

import os
import subprocess
import sys
import threading
import time
import tkinter as tk
from tkinter import ttk

from .engine import Engine

PAGE = 500  # rows added to the list at a time; more load as you scroll


def human_size(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            return f"{n:,.0f} {unit}" if unit == "B" else f"{n:,.1f} {unit}"
        n /= 1024
    return ""


def open_path(path: str) -> None:
    if os.name == "nt":
        os.startfile(path)  # noqa: S606
    elif sys.platform == "darwin":
        subprocess.Popen(["open", path])
    else:
        subprocess.Popen(["xdg-open", path])


def reveal(path: str) -> None:
    if os.name == "nt":
        subprocess.Popen(["explorer", "/select,", path])
    else:
        open_path(os.path.dirname(path))


class App:
    def __init__(self, roots=None):
        self.root = tk.Tk()
        self.root.title("REA Search")
        self.root.geometry("1000x620")
        self.results: list = []
        self.shown = 0
        self._pending = None
        self._dirty = threading.Event()
        self._status_msg = "색인 준비 중..."

        self.var = tk.StringVar()
        entry = ttk.Entry(self.root, textvariable=self.var, font=("Segoe UI", 12))
        entry.pack(fill="x", padx=6, pady=6)
        entry.focus_set()
        self.var.trace_add("write", lambda *_: self._schedule())

        cols = ("name", "folder", "size", "modified")
        frame = ttk.Frame(self.root)
        frame.pack(fill="both", expand=True, padx=6)
        self.tree = ttk.Treeview(frame, columns=cols, show="headings", selectmode="extended")
        for c, title, w in (("name", "이름", 280), ("folder", "경로", 460),
                            ("size", "크기", 100), ("modified", "수정한 날짜", 140)):
            self.tree.heading(c, text=title)
            self.tree.column(c, width=w, anchor="e" if c == "size" else "w")
        sb = ttk.Scrollbar(frame, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=lambda a, b: (sb.set(a, b), self._maybe_more(b)))
        self.tree.pack(side="left", fill="both", expand=True)
        sb.pack(side="right", fill="y")
        self.tree.bind("<Double-1>", lambda e: self._open())
        self.tree.bind("<Return>", lambda e: self._open())
        self.tree.bind("<Button-3>", self._menu)
        entry.bind("<Down>", lambda e: (self.tree.focus_set(), self._select_first()))

        self.status = ttk.Label(self.root, anchor="w")
        self.status.pack(fill="x", padx=6, pady=3)

        self.engine = Engine(roots=roots, progress=self._progress, log=self._log)
        self.engine.on_change = self._dirty.set
        self.root.protocol("WM_DELETE_WINDOW", self._close)
        threading.Thread(target=self._load, daemon=True).start()
        self.root.after(200, self._tick)

    # ---- background -----------------------------------------------------
    def _load(self):
        self.engine.load_or_build()
        self.engine.start_watching()
        self._dirty.set()

    def _progress(self, n, where):
        self._status_msg = f"색인 중... {n:,}개 ({where})"

    def _log(self, msg):
        self._status_msg = msg

    def _tick(self):
        # Runs on the UI thread: pick up changes from the watcher thread.
        if self._dirty.is_set():
            self._dirty.clear()
            self._run_search()
        elif not self.results:
            self.status.config(text=self._status_msg)
        self.root.after(500, self._tick)

    # ---- search -----------------------------------------------------------
    def _schedule(self):
        if self._pending:
            self.root.after_cancel(self._pending)
        self._pending = self.root.after(60, self._run_search)  # debounce keystrokes

    def _run_search(self):
        self._pending = None
        t = time.perf_counter()
        self.results = self.engine.search(self.var.get())
        ms = (time.perf_counter() - t) * 1000
        self.tree.delete(*self.tree.get_children())
        self.shown = 0
        self._add_rows()
        self.status.config(text=f"{len(self.results):,}개 개체  ·  {ms:.0f} ms  ·  "
                                f"전체 {len(self.engine.index):,}개 ({self.engine.mode})")

    def _add_rows(self):
        idx = self.engine.index
        end = min(self.shown + PAGE, len(self.results))
        for k in self.results[self.shown:end]:
            n = idx.node(k)
            if n is None:
                continue
            name, _, is_dir = n
            folder = idx.folder(k)
            size, mod = "", ""
            try:
                st = os.stat(os.path.join(folder, name) if folder else name)
                mod = time.strftime("%Y-%m-%d %H:%M", time.localtime(st.st_mtime))
                if not is_dir:
                    size = human_size(st.st_size)
            except OSError:
                pass
            self.tree.insert("", "end", iid=str(self.shown), values=(name, folder, size, mod))
            self.shown += 1
        self.shown = end

    def _maybe_more(self, last_fraction):
        if float(last_fraction) > 0.95 and self.shown < len(self.results):
            self._add_rows()

    # ---- actions ----------------------------------------------------------
    def _selected_paths(self):
        out = []
        for iid in self.tree.selection():
            name, folder = self.tree.item(iid, "values")[:2]
            out.append(os.path.join(folder, name) if folder else name)
        return out

    def _select_first(self):
        kids = self.tree.get_children()
        if kids:
            self.tree.selection_set(kids[0])
            self.tree.focus(kids[0])

    def _open(self):
        for p in self._selected_paths():
            open_path(p)

    def _menu(self, ev):
        iid = self.tree.identify_row(ev.y)
        if iid:
            self.tree.selection_set(iid)
        m = tk.Menu(self.root, tearoff=0)
        m.add_command(label="열기", command=self._open)
        m.add_command(label="폴더 열기", command=lambda: [reveal(p) for p in self._selected_paths()])
        m.add_command(label="전체 경로 복사", command=self._copy)
        m.tk_popup(ev.x_root, ev.y_root)

    def _copy(self):
        self.root.clipboard_clear()
        self.root.clipboard_append("\n".join(self._selected_paths()))

    def _close(self):
        try:
            self.engine.stop()
        finally:
            self.root.destroy()

    def run(self):
        self.root.mainloop()


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    roots = [a for a in argv if not a.startswith("-")] or None
    App(roots).run()


if __name__ == "__main__":
    main()
