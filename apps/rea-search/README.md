# REA Search

voidtools **Everything**처럼 파일 이름을 입력하는 즉시 찾아 주는 검색 프로그램의 프로토타입입니다.
순수 Python 표준 라이브러리만 사용하므로 별도 설치 없이 실행됩니다 (Python 3.10 이상).

## 가장 쉬운 실행 (Python 필요 없음)

1. `REASearch.exe`를 내려받아 더블클릭합니다.
2. "이 앱이 디바이스를 변경하도록 허용하시겠어요?" 창이 뜨면 **예**를 누릅니다. 관리자 권한이 있어야 드라이브 전체를 몇 초 만에 색인할 수 있습니다. **아니요**를 누르면 폴더를 하나씩 훑는 느린 방식으로 동작합니다.
3. 브라우저에 검색 화면이 열립니다. 입력하는 즉시 결과가 나옵니다. 더블클릭이나 Enter는 열기, Ctrl+Enter는 폴더에서 보기, 우클릭은 메뉴입니다.
4. 함께 뜬 검은 콘솔 창을 닫으면 프로그램이 종료됩니다.

서명되지 않은 새 프로그램이라 Windows SmartScreen이 "Windows의 PC 보호" 경고를 띄울 수 있습니다. **추가 정보 > 실행**을 누르면 됩니다.

옵션: `REASearch.exe D:\Projects` (이 폴더만 색인), `REASearch.exe -no-admin` (관리자 권한 요청 안 함).

이 exe는 `go/` 폴더의 Go 코드로 만든 것이며, 아래 Python 버전과 같은 방식으로 동작합니다. 다시 빌드하려면 `cd go && GOOS=windows go build -o ../REASearch.exe .`

## Python 버전 실행


```bat
:: Windows: GUI (관리자 권한으로 실행하면 NTFS MFT를 직접 읽어 수 초 안에 색인)
python -m rea_search
run_gui.bat            :: 같은 동작, 우클릭 > 관리자 권한으로 실행

:: CLI
python -m rea_search cli                       :: 대화형 검색
python -m rea_search cli 보고서 ext:pdf;docx   :: 한 번만 검색
python -m rea_search cli --root D:\Projects    :: 특정 폴더만 색인
python -m rea_search cli --rebuild             :: 캐시 무시하고 다시 색인
```

GUI에서 더블클릭/Enter는 열기, 우클릭은 열기·폴더 열기·전체 경로 복사입니다.

## 검색 문법 (Everything의 기본 문법 일부)

| 입력 | 의미 |
|---|---|
| `foo bar` | 이름에 foo **와** bar가 모두 포함 (대소문자 무시) |
| `foo \| bar` | foo **또는** bar |
| `!foo` | foo 제외 |
| `*.mp4`, `d?g.*` | 와일드카드 (이름 전체와 일치) |
| `json\ decoder` | `\`나 `/`가 들어간 단어는 전체 경로에서 찾기 |
| `ext:jpg;png` | 확장자 필터 |
| `file:` / `folder:` | 파일만 / 폴더만 |
| `"two words"` | 공백 포함 단어 |

## 동작 원리

Everything이 빠른 이유로 공개적으로 알려진 방식을 그대로 따랐습니다.

1. **MFT 직접 읽기** (`ntfs.py`): `FSCTL_ENUM_USN_DATA`로 NTFS 드라이브의 모든 파일 레코드(파일 ID, 부모 ID, 이름)를 폴더를 하나씩 열지 않고 한 번에 읽습니다. 관리자 권한이 필요합니다. 권한이 없거나 NTFS가 아니면 `walker.py`의 폴더 탐색 방식으로 자동 전환합니다.
2. **이름만 메모리에 보관** (`index.py`): 항목마다 이름과 부모 포인터만 저장하고 전체 경로는 필요할 때 조립합니다. 항목을 이름순으로 정렬해 두어 검색 결과는 따로 정렬할 필요가 없습니다.
3. **한 덩어리 문자열 검색**: 모든 이름(소문자)을 하나의 큰 문자열로 이어 붙이고 `str.find`(C 코드)를 반복해 후보를 찾은 뒤 나머지 조건을 검사합니다.
4. **USN 저널로 실시간 반영** (`engine.py`): `FSCTL_READ_USN_JOURNAL`로 생성·삭제·이름 변경을 1초마다 읽어 작은 오버레이에 반영하고, 변경이 쌓이면 인덱스를 다시 합칩니다.
5. **캐시**: 종료 시 `%LOCALAPPDATA%\rea-search\index.pkl`에 저장하고, 다음 실행 때 불러온 뒤 그 사이의 USN 저널 변경만 따라잡습니다.

### 측정치 (Linux 컨테이너, 합성 100만 항목, `tests/bench.py`)

| 검색어 | 결과 수 | 시간 |
|---|---|---|
| `보고서` | 93,753 | 46 ms |
| `invoice final` | 4,652 | 106 ms |
| `*.mp4` | 76,813 | 116 ms |
| `12345` | 20 | 19 ms |
| 100만 항목 정렬·색인 구성 | | 약 5초 |

## 상태와 한계

- 검색 엔진, 폴더 탐색 색인, 캐시, CLI는 Linux에서 테스트했습니다 (`python -m unittest tests/test_index.py`).
- **Windows 전용 부분(`ntfs.py`의 MFT 읽기와 USN 감시)과 tkinter GUI는 아직 실제 Windows에서 실행해 보지 않았습니다.** 첫 실행에서 오류가 나면 메시지를 알려 주세요.
- Python이라 메모리 사용량이 Everything(100만 개당 수십 MB)보다 몇 배 큽니다. 속도·메모리를 더 줄이려면 핵심 인덱스를 C#/Rust로 옮기는 것이 다음 단계입니다.
- 크기·수정 날짜는 화면에 보이는 행만 그때그때 읽습니다 (Everything은 이것도 색인).

## REA는 어디에 쓰나

영상에서 소개된 REA(**Reverse-Engineer Anything**, https://github.com/morluto/rea)는 Claude Code 같은 코딩 에이전트에 붙이는 리버스 엔지니어링 MCP 서버입니다. 에이전트가 Ghidra/IDA/Hopper 등을 통해 프로그램을 분석하고, 근거와 함께 동작을 설명해 주면 그걸 바탕으로 비슷한 기능을 구현하는 흐름입니다.

이 프로젝트는 다른 제품의 코드, 리소스, UI, 상표를 복사하지 않고 처음부터 직접 작성한 구현입니다. 사용한 것은 Microsoft가 공개 문서로 제공하는 Windows API(`FSCTL_ENUM_USN_DATA`, `FSCTL_READ_USN_JOURNAL`)와 일반적인 검색 기법뿐입니다. 다른 상용 프로그램의 바이너리를 REA로 분석하는 작업은 하지 않습니다.

REA는 이 프로젝트 자신의 코드를 분석·개선할 때 쓸 수 있습니다:

```bat
npx rea-agents setup          :: Claude Code 등에 REA MCP 등록 (Node.js 22+ 필요)
```
