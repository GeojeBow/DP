// REA Search: instant file name search for Windows.
//
// Run the exe: it indexes your drives, starts a small web server on
// 127.0.0.1 and opens the search page in your browser. Close the console
// window to quit.
package main

import (
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"time"
)

func main() {
	noElevate := flag.Bool("no-admin", false, "관리자 권한 요청 없이 실행 (느린 폴더 탐색 방식)")
	elevated := flag.Bool("elevated", false, "내부용")
	noBrowser := flag.Bool("no-browser", false, "브라우저를 자동으로 열지 않음")
	port := flag.Int("port", 0, "포트 (0이면 자동)")
	test := flag.Bool("selftest", false, "색인과 검색을 점검하고 결과를 출력한 뒤 종료")
	flag.Parse()
	roots := flag.Args() // optional: only index these folders

	if *test {
		initLog()
		os.Exit(selfTest(roots))
	}
	if !*noElevate && !*elevated && len(roots) == 0 && relaunchElevated() {
		return // the administrator copy takes over in its own window
	}
	initLog()
	defer recoverLog("main")
	exe, _ := os.Executable()
	logf("REA Search 시작: %s (관리자: %v)", exe, isAdminUser())

	eng := NewEngine(roots)
	go func() {
		defer recoverLog("index")
		eng.Build()
		go eng.Watch()
	}()

	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil {
		logf("서버를 시작하지 못했습니다: %v", err)
		pause()
		return
	}
	s := &server{eng: eng, token: newToken(), host: ln.Addr().String()}
	url := "http://" + s.host + "/"
	logf("검색 화면: %s", url)
	fmt.Println("브라우저가 열리지 않으면 위 주소를 브라우저에 붙여 넣으세요.")
	fmt.Println("이 창을 닫으면 프로그램이 종료됩니다.")
	if !*noBrowser {
		go func() {
			time.Sleep(300 * time.Millisecond)
			if err := openBrowser(url); err != nil {
				logf("브라우저를 열지 못했습니다: %v", err)
			}
		}()
	}
	if err := http.Serve(ln, s.routes()); err != nil {
		logf("%v", err)
		pause()
	}
}

func pause() {
	fmt.Println("Enter를 누르면 닫힙니다.")
	var b [1]byte
	os.Stdin.Read(b[:])
}
