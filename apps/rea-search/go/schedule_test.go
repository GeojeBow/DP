package main

import (
	"testing"
	"time"
)

func TestSchedule(t *testing.T) {
	loc := time.Local
	day := func(h, m int) time.Time { return time.Date(2026, 3, 5, h, m, 0, 0, loc) }
	s, err := Schedule{At: []string{"18:00", "9:05", "18:00"}}.Normalize()
	if err != nil || len(s.At) != 2 || s.At[0] != "09:05" {
		t.Fatalf("normalize %+v %v", s, err)
	}
	if _, err := (Schedule{At: []string{"25:00"}}).Normalize(); err == nil {
		t.Fatal("25:00 accepted")
	}
	if s.Due(day(8, 0), day(9, 0)) {
		t.Fatal("due before 09:05")
	}
	if !s.Due(day(8, 0), day(9, 6)) {
		t.Fatal("not due after 09:05")
	}
	if s.Due(day(9, 6), day(12, 0)) {
		t.Fatal("ran at 09:06 but due again at noon")
	}
	if !s.Next(day(9, 6), day(12, 0)).Equal(day(18, 0)) {
		t.Fatal("next")
	}
	if !s.Next(day(18, 1), day(19, 0)).Equal(day(9, 5).AddDate(0, 0, 1)) {
		t.Fatal("next day")
	}
	h := Schedule{Hours: 2}
	if h.Due(day(9, 0), day(10, 0)) || !h.Due(day(9, 0), day(11, 1)) {
		t.Fatal("hours")
	}
	if (Schedule{}).Due(time.Time{}, day(12, 0)) {
		t.Fatal("empty schedule ran")
	}
}
