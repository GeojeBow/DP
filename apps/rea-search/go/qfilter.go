package main

// Size and date conditions typed into the name search box:
//
//	size:>10mb   size:<500kb   size:1mb..20mb   size:0 (empty files)
//	dm:today  dm:yesterday  dm:7d  dm:30d  dm:2024  dm:2024-03
//	dm:>2024-01-01  dm:<2023-06-30  dm:2024-01-01..2024-03-31
//
// They are taken out of the query and combined with the side-panel filters.

import (
	"strconv"
	"strings"
	"time"
)

func parseSizeVal(s string) (int64, bool) {
	s = strings.ToLower(strings.TrimSpace(s))
	mult := int64(1)
	for _, u := range []struct {
		suf string
		m   int64
	}{{"tb", 1 << 40}, {"gb", 1 << 30}, {"mb", 1 << 20}, {"kb", 1 << 10}, {"t", 1 << 40}, {"g", 1 << 30}, {"m", 1 << 20}, {"k", 1 << 10}, {"b", 1}} {
		if strings.HasSuffix(s, u.suf) {
			s, mult = strings.TrimSuffix(s, u.suf), u.m
			break
		}
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil || f < 0 {
		return 0, false
	}
	return int64(f * float64(mult)), true
}

// parseDay returns the start and end (exclusive) of a day, month or year.
func parseDay(s string, now time.Time) (time.Time, time.Time, bool) {
	loc := now.Location()
	day := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	switch s {
	case "today", "오늘":
		return day, day.AddDate(0, 0, 1), true
	case "yesterday", "어제":
		return day.AddDate(0, 0, -1), day, true
	case "thisweek", "이번주":
		wd := (int(day.Weekday()) + 6) % 7 // Monday first
		start := day.AddDate(0, 0, -wd)
		return start, start.AddDate(0, 0, 7), true
	case "thismonth", "이번달":
		start := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, loc)
		return start, start.AddDate(0, 1, 0), true
	case "thisyear", "올해":
		start := time.Date(now.Year(), 1, 1, 0, 0, 0, 0, loc)
		return start, start.AddDate(1, 0, 0), true
	}
	if n := len(s); n > 1 && (s[n-1] == 'd' || s[n-1] == 'w' || s[n-1] == 'm' || s[n-1] == 'y') {
		if k, err := strconv.Atoi(s[:n-1]); err == nil && k > 0 {
			var start time.Time
			switch s[n-1] {
			case 'd':
				start = day.AddDate(0, 0, -k+1)
			case 'w':
				start = day.AddDate(0, 0, -7*k+1)
			case 'm':
				start = day.AddDate(0, -k, 1)
			case 'y':
				start = day.AddDate(-k, 0, 1)
			}
			return start, day.AddDate(0, 0, 1), true
		}
	}
	for _, l := range []struct {
		layout string
		add    func(time.Time) time.Time
	}{
		{"2006-01-02", func(t time.Time) time.Time { return t.AddDate(0, 0, 1) }},
		{"2006.01.02", func(t time.Time) time.Time { return t.AddDate(0, 0, 1) }},
		{"20060102", func(t time.Time) time.Time { return t.AddDate(0, 0, 1) }},
		{"2006-01", func(t time.Time) time.Time { return t.AddDate(0, 1, 0) }},
		{"2006.01", func(t time.Time) time.Time { return t.AddDate(0, 1, 0) }},
		{"2006", func(t time.Time) time.Time { return t.AddDate(1, 0, 0) }},
	} {
		if t, err := time.ParseInLocation(l.layout, s, loc); err == nil {
			return t, l.add(t), true
		}
	}
	return time.Time{}, time.Time{}, false
}

// extractFilterTokens removes size:/dm: words from the query and narrows f.
func extractFilterTokens(q string, f *Filter, now time.Time) string {
	if !strings.Contains(q, "size:") && !strings.Contains(q, "dm:") && !strings.Contains(q, "크기:") && !strings.Contains(q, "날짜:") {
		return q
	}
	setMin := func(v int64) {
		if f.MinSize < 0 || v > f.MinSize {
			f.MinSize = v
		}
	}
	setMax := func(v int64) {
		if f.MaxSize < 0 || v < f.MaxSize {
			f.MaxSize = v
		}
	}
	setAfter := func(t time.Time) {
		if u := t.Unix(); f.After == 0 || u > f.After {
			f.After = u
		}
	}
	setBefore := func(t time.Time) {
		if u := t.Unix(); f.Before == 0 || u < f.Before {
			f.Before = u
		}
	}
	var keep []string
	for _, w := range strings.Fields(q) {
		lw := strings.ToLower(w)
		var key, val string
		for _, p := range []string{"size:", "크기:", "dm:", "날짜:"} {
			if strings.HasPrefix(lw, p) {
				key, val = p, lw[len(p):]
			}
		}
		ok := false
		switch key {
		case "size:", "크기:":
			ok = sizeCond(val, setMin, setMax)
		case "dm:", "날짜:":
			ok = dateCond(val, now, setAfter, setBefore)
		}
		if !ok {
			keep = append(keep, w)
		}
	}
	return strings.Join(keep, " ")
}

func sizeCond(val string, setMin, setMax func(int64)) bool {
	switch {
	case strings.Contains(val, ".."):
		a, b, _ := strings.Cut(val, "..")
		lo, ok1 := parseSizeVal(a)
		hi, ok2 := parseSizeVal(b)
		if !ok1 || !ok2 {
			return false
		}
		setMin(lo)
		setMax(hi)
	case strings.HasPrefix(val, ">="):
		v, ok := parseSizeVal(val[2:])
		if !ok {
			return false
		}
		setMin(v)
	case strings.HasPrefix(val, ">"):
		v, ok := parseSizeVal(val[1:])
		if !ok {
			return false
		}
		setMin(v + 1)
	case strings.HasPrefix(val, "<="):
		v, ok := parseSizeVal(val[2:])
		if !ok {
			return false
		}
		setMax(v)
	case strings.HasPrefix(val, "<"):
		v, ok := parseSizeVal(val[1:])
		if !ok || v == 0 {
			return false
		}
		setMax(v - 1)
	default:
		v, ok := parseSizeVal(val)
		if !ok {
			return false
		}
		setMin(v)
		setMax(v)
	}
	return true
}

func dateCond(val string, now time.Time, setAfter, setBefore func(time.Time)) bool {
	switch {
	case strings.Contains(val, ".."):
		a, b, _ := strings.Cut(val, "..")
		s1, _, ok1 := parseDay(a, now)
		_, e2, ok2 := parseDay(b, now)
		if !ok1 || !ok2 {
			return false
		}
		setAfter(s1)
		setBefore(e2)
	case strings.HasPrefix(val, ">="):
		s, _, ok := parseDay(val[2:], now)
		if !ok {
			return false
		}
		setAfter(s)
	case strings.HasPrefix(val, ">"):
		_, e, ok := parseDay(val[1:], now)
		if !ok {
			return false
		}
		setAfter(e)
	case strings.HasPrefix(val, "<="):
		_, e, ok := parseDay(val[2:], now)
		if !ok {
			return false
		}
		setBefore(e)
	case strings.HasPrefix(val, "<"):
		s, _, ok := parseDay(val[1:], now)
		if !ok {
			return false
		}
		setBefore(s)
	default:
		s, e, ok := parseDay(val, now)
		if !ok {
			return false
		}
		setAfter(s)
		setBefore(e)
	}
	return true
}
