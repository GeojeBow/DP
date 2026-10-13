// REA Search: instant file name and content search for Windows.
//
// Run the exe: it loads (or builds) the index, starts a small web server on
// 127.0.0.1 and opens the search window. Closing the window keeps the
// program running in the background so the index stays live and the next
// window opens instantly; "종료" in the window quits it. Starting the exe
// again just opens a new window on the running instance.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
)

const defaultPort = 39713 // fixed so the window keeps its saved searches between runs

type instance struct {
	Port  int    `json:"port"`
	Token string `json:"token"`
}

func main() {
	noElevate := flag.Bool("no-admin", false, "설정과 관계없이 관리자 권한을 요청하지 않음")
	elevated := flag.Bool("elevated", false, "내부용")
	noBrowser := flag.Bool("no-browser", false, "검색 창을 자동으로 열지 않음")
	port := flag.Int("port", defaultPort, "포트")
	test := flag.Bool("selftest", false, "색인과 검색을 점검하고 결과를 출력한 뒤 종료")
	startup := flag.Bool("startup", false, "로그인할 때 창 없이 시작 (Windows 시작 시 실행)")
	flag.Parse()
	roots := flag.Args() // optional: only index these folders

	if *test {
		initLog()
		os.Exit(selfTest(roots))
	}
	if *startup {
		*noBrowser = true
		if isRunning() {
			return
		}
	}
	if !*noBrowser && openRunning() {
		return // already running: a new window was opened on it
	}
	// Administrator rights (fast NTFS index) are asked for only when the
	// user turned them on in settings; otherwise folders are walked.
	if !*noElevate && !*elevated && len(roots) == 0 && wantAdmin() && relaunchElevated() {
		return // the administrator copy takes over
	}
	initLog()
	defer recoverLog("main")
	exe, _ := os.Executable()
	logf("REA Search 시작: %s (관리자: %v)", exe, isAdminUser())

	eng := NewEngine(roots)
	go func() {
		defer recoverLog("index")
		eng.Start()
	}()

	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
	for i := 0; err != nil && *elevated && i < 50; i++ {
		// restarted as administrator from the window: the old copy is
		// still letting go of the port
		time.Sleep(200 * time.Millisecond)
		ln, err = net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
	}
	if err != nil {
		ln, err = net.Listen("tcp", "127.0.0.1:0")
	}
	if err != nil {
		alert("서버를 시작하지 못했습니다: " + err.Error())
		return
	}
	s := &server{eng: eng, token: newToken(), host: ln.Addr().String(), elevated: *elevated}
	quitOnce := make(chan struct{})
	s.quit = func() {
		select {
		case <-quitOnce:
			return
		default:
			close(quitOnce)
		}
		logf("종료: 색인을 저장합니다")
		eng.Save()
		eng.Content.Close()
		os.Remove(instancePath())
		os.Exit(0)
	}
	s.restartAdmin = func() bool {
		eng.Save()
		eng.Content.Flush()
		os.Remove(instancePath()) // or the new copy would just open a window on this one
		if relaunchElevated() {
			logf("관리자 권한으로 다시 시작합니다")
			os.Exit(0)
		}
		logf("관리자 권한 요청이 취소되었습니다")
		writeInstance(instance{Port: ln.Addr().(*net.TCPAddr).Port, Token: s.token})
		return false
	}
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM) // console close / logoff / shutdown
	go func() { <-sig; s.quit() }()

	writeInstance(instance{Port: ln.Addr().(*net.TCPAddr).Port, Token: s.token})
	url := "http://" + s.host + "/"
	logf("검색 화면: %s", url)
	s.url = url
	var hkErr error
	s.setHotkey, hkErr = startHotkey(eng.Hotkey(), s.summon)
	if hkErr != nil {
		s.hotkeyErr = hkErr.Error()
	}
	if !*noBrowser {
		go func() {
			time.Sleep(200 * time.Millisecond)
			if err := openWindow(url); err != nil {
				logf("창을 열지 못했습니다: %v", err)
			}
		}()
	}
	go func() {
		if err := http.Serve(ln, s.routes()); err != nil {
			alert(err.Error())
			os.Exit(1)
		}
	}()
	uiLoop() // the window lives on the main thread; never returns
}

func instancePath() string { return filepath.Join(dataDir(), "instance.json") }

func writeInstance(in instance) {
	os.MkdirAll(dataDir(), 0o755)
	b, _ := json.Marshal(in)
	os.WriteFile(instancePath(), b, 0o600)
}

func isRunning() bool {
	_, ok := runningHost()
	return ok
}

// openRunning asks an already running instance to show its window, if any.
// The window belongs to that instance (this copy exits right away).
func openRunning() bool {
	host, token, ok := runningInstance()
	if ok {
		req, _ := http.NewRequest("POST", "http://"+host+"/api/summon", nil)
		req.Header.Set("X-Token", token)
		if resp, err := (&http.Client{Timeout: 3 * time.Second}).Do(req); err == nil {
			resp.Body.Close()
		}
	}
	return ok
}

func runningHost() (string, bool) {
	host, _, ok := runningInstance()
	return host, ok
}

func runningInstance() (string, string, bool) {
	b, err := os.ReadFile(instancePath())
	if err != nil {
		return "", "", false
	}
	var in instance
	if json.Unmarshal(b, &in) != nil || in.Port == 0 {
		return "", "", false
	}
	host := fmt.Sprintf("127.0.0.1:%d", in.Port)
	req, _ := http.NewRequest("GET", "http://"+host+"/api/ping", nil)
	req.Header.Set("X-Token", in.Token)
	resp, err := (&http.Client{Timeout: 2 * time.Second}).Do(req)
	if err != nil {
		return "", "", false
	}
	resp.Body.Close()
	return host, in.Token, resp.StatusCode == 200
}
