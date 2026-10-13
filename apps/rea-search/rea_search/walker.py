"""Portable indexer: walks directories with os.scandir.

Used on non-Windows systems, on non-NTFS drives, and when the program is not
run as administrator (reading the NTFS MFT directly needs admin rights).
It is much slower than the MFT reader but works everywhere.
"""

from __future__ import annotations

import os
import time

from .index import IndexBuilder


def walk_into(builder: IndexBuilder, roots: list[str], progress=None, skip=()) -> None:
    next_key = [len(builder)]

    def new_key():
        next_key[0] += 1
        return ("w", next_key[0])

    last = [0.0]
    skip = {os.path.normcase(os.path.abspath(s)) for s in skip}
    for root in roots:
        root = os.path.abspath(root)
        rk = new_key()
        builder.add_root(rk, root.rstrip("\\/") or root)  # "C:\" -> "C:"
        stack = [(root, rk)]
        while stack:
            path, pk = stack.pop()
            try:
                it = os.scandir(path)
            except OSError:
                continue
            with it:
                for e in it:
                    try:
                        is_dir = e.is_dir(follow_symlinks=False)
                    except OSError:
                        is_dir = False
                    k = new_key()
                    builder.add(k, pk, e.name, is_dir)
                    if is_dir and os.path.normcase(e.path) not in skip:
                        stack.append((e.path, k))
            if progress and time.monotonic() - last[0] > 0.25:  # throttle UI updates
                last[0] = time.monotonic()
                progress(len(builder), path)


def default_roots() -> list[str]:
    if os.name == "nt":
        import string
        return [f"{d}:\\" for d in string.ascii_uppercase if os.path.exists(f"{d}:\\")]
    return [os.path.expanduser("~")]
