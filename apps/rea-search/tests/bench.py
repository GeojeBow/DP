"""Benchmark: build a synthetic 1,000,000-entry index and time some queries."""
import os
import random
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from rea_search.index import IndexBuilder  # noqa: E402

N = int(sys.argv[1]) if len(sys.argv) > 1 else 1_000_000
random.seed(1)
words = ["report", "photo", "invoice", "project", "backup", "music", "video", "setup", "readme",
         "회의록", "보고서", "사진", "data", "config", "log", "test", "final", "draft", "2024", "2026"]
exts = ["txt", "jpg", "png", "pdf", "docx", "mp3", "mp4", "exe", "dll", "py", "json", "log"]
t = time.perf_counter()
b = IndexBuilder()
b.add_root(0, "C:")
dirs = [0]
for i in range(1, N):
    parent = random.choice(dirs[-2000:])
    if random.random() < 0.08:
        b.add(i, parent, f"{random.choice(words)}_{i}", True)
        dirs.append(i)
    else:
        b.add(i, parent, f"{random.choice(words)}-{random.choice(words)}_{i}.{random.choice(exts)}", False)
t1 = time.perf_counter()
idx = b.build()
t2 = time.perf_counter()
print(f"records {t1 - t:.1f}s, build+sort {t2 - t1:.1f}s, entries {len(idx):,}")
for q in ["보고서", "invoice final", "*.mp4", "ext:pdf;docx report", "12345", "zzz", "a", "photo | video !2026", "data\\ log"]:
    t = time.perf_counter()
    r = idx.search(q)
    print(f"{q!r:28} {len(r):>9,} hits {1000 * (time.perf_counter() - t):8.1f} ms")
