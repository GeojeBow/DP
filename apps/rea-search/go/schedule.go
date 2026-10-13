package main

// Index schedules: "every N hours" and/or "every day at these times".
// The name index (when drives are walked), each extra folder and the
// content index each have one, changeable at any time in settings.

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

type Schedule struct {
	Hours float64  `json:"hours"`        // 0 = no interval
	At    []string `json:"at,omitempty"` // "HH:MM", every day
}

var (
	defaultMainSchedule    = Schedule{Hours: 1}
	defaultContentSchedule = Schedule{Hours: 0.5}
)

// Normalize checks the times, sorts them and drops duplicates.
func (s Schedule) Normalize() (Schedule, error) {
	if s.Hours < 0 || s.Hours > 24*30 {
		return s, fmt.Errorf("주기가 올바르지 않습니다")
	}
	seen := map[string]bool{}
	var at []string
	for _, a := range s.At {
		t, err := time.Parse("15:04", strings.TrimSpace(a))
		if err != nil {
			return s, fmt.Errorf("시각은 09:30처럼 적어 주세요: %q", a)
		}
		k := t.Format("15:04")
		if !seen[k] {
			seen[k] = true
			at = append(at, k)
		}
	}
	if len(at) > 24 {
		return s, fmt.Errorf("시각은 24개까지 정할 수 있습니다")
	}
	sort.Strings(at)
	s.At = at
	return s, nil
}

// Due reports whether a run that last started at last should run again now.
func (s Schedule) Due(last, now time.Time) bool {
	if s.Hours > 0 && now.Sub(last) > time.Duration(s.Hours*float64(time.Hour)) {
		return true
	}
	for _, a := range s.At {
		t, err := time.Parse("15:04", a)
		if err != nil {
			continue
		}
		at := time.Date(now.Year(), now.Month(), now.Day(), t.Hour(), t.Minute(), 0, 0, now.Location())
		if !at.After(now) && last.Before(at) {
			return true
		}
	}
	return false
}

// Next is when the schedule runs next (zero if never).
func (s Schedule) Next(last, now time.Time) time.Time {
	var next time.Time
	if s.Hours > 0 {
		next = last.Add(time.Duration(s.Hours * float64(time.Hour)))
		if next.Before(now) {
			next = now
		}
	}
	for _, a := range s.At {
		t, err := time.Parse("15:04", a)
		if err != nil {
			continue
		}
		at := time.Date(now.Year(), now.Month(), now.Day(), t.Hour(), t.Minute(), 0, 0, now.Location())
		if !at.After(now) {
			at = at.AddDate(0, 0, 1)
		}
		if next.IsZero() || at.Before(next) {
			next = at
		}
	}
	return next
}
