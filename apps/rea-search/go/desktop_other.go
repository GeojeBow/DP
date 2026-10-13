//go:build !windows

package main

import "errors"

var hotkeyKeys = map[string][2]uint32{}

func startHotkey(spec string, onPress func()) (func(string) error, error) {
	return func(string) error { return nil }, nil
}

func bringWindow() bool { return false }

func autostart() (bool, string) { return false, "" }

func setAutostart(on bool) error { return errors.New("Windows에서만 쓸 수 있습니다") }
