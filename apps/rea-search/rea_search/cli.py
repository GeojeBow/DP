"""Command line: interactive search prompt, or one-shot query + benchmark."""

from __future__ import annotations

import argparse
import sys
import time

from .engine import Engine


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="rea-search", description="Everything 스타일 파일 이름 검색")
    ap.add_argument("query", nargs="*", help="검색어 (없으면 대화형 모드)")
    ap.add_argument("--root", action="append", help="이 폴더만 색인 (여러 번 지정 가능)")
    ap.add_argument("--rebuild", action="store_true", help="캐시를 무시하고 다시 색인")
    ap.add_argument("-n", "--limit", type=int, default=30, help="출력할 최대 결과 수")
    args = ap.parse_args(argv)

    def progress(n, where):
        print(f"\r색인 중... {n:,}개 ({where})"[:100].ljust(100), end="", file=sys.stderr, flush=True)

    eng = Engine(roots=args.root, progress=progress, log=lambda m: print("\n" + m, file=sys.stderr))
    if args.rebuild:
        eng.build()
        eng.save()
    else:
        eng.load_or_build()

    def run(q: str) -> None:
        t = time.perf_counter()
        keys = eng.search(q)
        ms = (time.perf_counter() - t) * 1000
        for k in keys[: args.limit]:
            print(eng.index.path(k))
        more = f" (상위 {args.limit}개 표시)" if len(keys) > args.limit else ""
        print(f"-- {len(keys):,}개 일치, {ms:.1f} ms{more}", file=sys.stderr)

    if args.query:
        run(" ".join(args.query))
        return 0
    eng.start_watching()
    print("검색어를 입력하세요 (빈 줄이면 종료).", file=sys.stderr)
    try:
        while True:
            q = input("> ")
            if not q:
                break
            run(q)
    except (EOFError, KeyboardInterrupt):
        pass
    eng.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
