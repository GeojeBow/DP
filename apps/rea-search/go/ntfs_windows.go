//go:build windows

package main

// Fast NTFS indexing through documented Windows APIs:
//   FSCTL_ENUM_USN_DATA   lists every file record of the volume (file id,
//                         parent id, name) without opening folders one by one.
//   FSCTL_READ_USN_JOURNAL streams create / delete / rename events afterwards.
// Both need a volume handle (\\.\C:), which needs administrator rights.

import (
	"encoding/binary"
	"fmt"
	"syscall"
	"time"
	"unicode/utf16"
	"unsafe"
)

var (
	kernel32                  = syscall.NewLazyDLL("kernel32.dll")
	procGetLogicalDrives      = kernel32.NewProc("GetLogicalDrives")
	procGetDriveTypeW         = kernel32.NewProc("GetDriveTypeW")
	procGetVolumeInformationW = kernel32.NewProc("GetVolumeInformationW")
	shell32                   = syscall.NewLazyDLL("shell32.dll")
	procIsUserAnAdmin         = shell32.NewProc("IsUserAnAdmin")
	procShellExecuteW         = shell32.NewProc("ShellExecuteW")
)

const (
	fsctlEnumUsnData      = 0x000900B3
	fsctlReadUsnJournal   = 0x000900BB
	fsctlCreateUsnJournal = 0x000900E7
	fsctlQueryUsnJournal  = 0x000900F4

	errHandleEOF        = syscall.Errno(38)
	errJournalNotActive = syscall.Errno(1179)

	fileShareAll            = 0x1 | 0x2 | 0x4
	fileFlagBackupSemantics = 0x02000000
	fileAttributeDirectory  = 0x10

	reasonDataOverwrite = 0x00000001
	reasonDataExtend    = 0x00000002
	reasonDataTruncate  = 0x00000004
	reasonCreate        = 0x00000100
	reasonDelete        = 0x00000200
	reasonOldName       = 0x00001000
	reasonNewName       = 0x00002000
	reasonClose         = 0x80000000
	reasonData          = reasonDataOverwrite | reasonDataExtend | reasonDataTruncate
	watchMask           = reasonCreate | reasonDelete | reasonOldName | reasonNewName | reasonData | reasonClose

	frnMask = 1<<48 - 1 // record number; the sequence bits are dropped
	bufSize = 1 << 20
)

func isAdmin() bool {
	r, _, _ := procIsUserAnAdmin.Call()
	return r != 0
}

func ntfsDrives() []string {
	var out []string
	mask, _, _ := procGetLogicalDrives.Call()
	for i := 0; i < 26; i++ {
		if mask&(1<<i) == 0 {
			continue
		}
		letter := string(rune('A' + i))
		root, _ := syscall.UTF16PtrFromString(letter + `:\`)
		if t, _, _ := procGetDriveTypeW.Call(uintptr(unsafe.Pointer(root))); t != 3 { // DRIVE_FIXED
			continue
		}
		fs := make([]uint16, 32)
		r, _, _ := procGetVolumeInformationW.Call(uintptr(unsafe.Pointer(root)), 0, 0, 0, 0, 0,
			uintptr(unsafe.Pointer(&fs[0])), 32)
		if r != 0 && syscall.UTF16ToString(fs) == "NTFS" {
			out = append(out, letter)
		}
	}
	return out
}

func defaultRoots() []string {
	var out []string
	mask, _, _ := procGetLogicalDrives.Call()
	for i := 0; i < 26; i++ {
		if mask&(1<<i) != 0 {
			root := string(rune('A'+i)) + `:\`
			p, _ := syscall.UTF16PtrFromString(root)
			if t, _, _ := procGetDriveTypeW.Call(uintptr(unsafe.Pointer(p))); t == 3 {
				out = append(out, root)
			}
		}
	}
	return out
}

type volume struct {
	letter    string
	base      uint64
	h         syscall.Handle
	journalID uint64
	nextUSN   int64
	firstUSN  int64
	rootKey   uint64
}

func ioctl(h syscall.Handle, code uint32, in, out []byte) (uint32, error) {
	var n uint32
	var inp *byte
	if len(in) > 0 {
		inp = &in[0]
	}
	err := syscall.DeviceIoControl(h, code, inp, uint32(len(in)), &out[0], uint32(len(out)), &n, nil)
	return n, err
}

func openVolume(letter string, no int) (*volume, error) {
	p, _ := syscall.UTF16PtrFromString(`\\.\` + letter + ":")
	h, err := syscall.CreateFile(p, syscall.GENERIC_READ, fileShareAll, nil, syscall.OPEN_EXISTING, 0, 0)
	if err != nil {
		return nil, fmt.Errorf("%s: 볼륨 열기 실패: %w", letter, err)
	}
	v := &volume{letter: letter, base: uint64(no) << 48, h: h}
	out := make([]byte, 64)
	if _, err = ioctl(h, fsctlQueryUsnJournal, nil, out); err == errJournalNotActive {
		// Turn the change journal on (32 MB max, 4 MB delta), as file indexers do.
		in := make([]byte, 16)
		binary.LittleEndian.PutUint64(in[0:], 32<<20)
		binary.LittleEndian.PutUint64(in[8:], 4<<20)
		if _, err = ioctl(h, fsctlCreateUsnJournal, in, make([]byte, 8)); err == nil {
			_, err = ioctl(h, fsctlQueryUsnJournal, nil, out)
		}
	}
	if err != nil {
		syscall.CloseHandle(h)
		return nil, fmt.Errorf("%s: 변경 기록 조회 실패: %w", letter, err)
	}
	v.journalID = binary.LittleEndian.Uint64(out[0:])
	v.firstUSN = int64(binary.LittleEndian.Uint64(out[8:]))
	v.nextUSN = int64(binary.LittleEndian.Uint64(out[16:]))

	rp, _ := syscall.UTF16PtrFromString(letter + `:\`)
	rh, err := syscall.CreateFile(rp, 0, fileShareAll, nil, syscall.OPEN_EXISTING, fileFlagBackupSemantics, 0)
	if err != nil {
		syscall.CloseHandle(h)
		return nil, err
	}
	var info syscall.ByHandleFileInformation
	err = syscall.GetFileInformationByHandle(rh, &info)
	syscall.CloseHandle(rh)
	if err != nil {
		syscall.CloseHandle(h)
		return nil, err
	}
	v.rootKey = v.key(uint64(info.FileIndexHigh)<<32 | uint64(info.FileIndexLow))
	return v, nil
}

func (v *volume) key(frn uint64) uint64 { return v.base | frn&frnMask }

type usnRec struct {
	frn, parent uint64
	reason      uint32
	dir         bool
	name        string
}

// parseRecords decodes USN_RECORD_V2 entries.
func parseRecords(data []byte, fn func(usnRec)) {
	le := binary.LittleEndian
	for off := 0; off+60 <= len(data); {
		l := int(le.Uint32(data[off:]))
		if l == 0 || off+l > len(data) {
			return
		}
		if le.Uint16(data[off+4:]) == 2 {
			nlen := int(le.Uint16(data[off+56:]))
			noff := int(le.Uint16(data[off+58:]))
			u := make([]uint16, nlen/2)
			for i := range u {
				u[i] = le.Uint16(data[off+noff+2*i:])
			}
			fn(usnRec{
				frn:    le.Uint64(data[off+8:]),
				parent: le.Uint64(data[off+16:]),
				reason: le.Uint32(data[off+40:]),
				dir:    le.Uint32(data[off+52:])&fileAttributeDirectory != 0,
				name:   string(utf16.Decode(u)),
			})
		}
		off += l
	}
}

func (v *volume) enumerate(b *Builder, progress func(int, string)) error {
	b.AddRoot(v.rootKey, v.letter+":")
	buf := make([]byte, bufSize)
	in := make([]byte, 24) // MFT_ENUM_DATA_V0
	var start uint64
	for {
		binary.LittleEndian.PutUint64(in[0:], start)
		binary.LittleEndian.PutUint64(in[8:], 0)
		binary.LittleEndian.PutUint64(in[16:], uint64(v.nextUSN))
		n, err := ioctl(v.h, fsctlEnumUsnData, in, buf)
		if err == errHandleEOF {
			return nil
		}
		if err != nil {
			return fmt.Errorf("%s: MFT 읽기 실패: %w", v.letter, err)
		}
		if n <= 8 {
			return nil
		}
		start = binary.LittleEndian.Uint64(buf)
		parseRecords(buf[8:n], func(r usnRec) {
			if k := v.key(r.frn); k != v.rootKey {
				b.Add(k, v.key(r.parent), r.name, r.dir)
			}
		})
		if progress != nil {
			progress(b.Len(), v.letter+":")
		}
	}
}

type ntfsWatcher struct {
	vols   []*volume
	buf    []byte
	events []ChangeEvent
}

func (w *ntfsWatcher) Journals() map[string][2]int64 {
	out := map[string][2]int64{}
	for _, v := range w.vols {
		out[v.letter] = [2]int64{int64(v.journalID), v.nextUSN}
	}
	return out
}

func (w *ntfsWatcher) Drain() []ChangeEvent {
	ev := w.events
	w.events = nil
	return ev
}

// Poll reads the change journal. Only records written when a file handle is
// closed are requested: by then the reason bits of everything that happened
// to the file are combined, and the record carries its final name.
func (w *ntfsWatcher) Poll(ix *Index) (int, error) {
	total := 0
	in := make([]byte, 40) // READ_USN_JOURNAL_DATA_V0
	le := binary.LittleEndian
	for _, v := range w.vols {
		for {
			le.PutUint64(in[0:], uint64(v.nextUSN))
			le.PutUint32(in[8:], watchMask)
			le.PutUint32(in[12:], 1) // ReturnOnlyOnClose
			le.PutUint64(in[16:], 0) // Timeout
			le.PutUint64(in[24:], 0) // BytesToWaitFor: return at once
			le.PutUint64(in[32:], v.journalID)
			n, err := ioctl(v.h, fsctlReadUsnJournal, in, w.buf)
			if err != nil {
				return total, fmt.Errorf("%s: %w", v.letter, err)
			}
			got := 0
			parseRecords(w.buf[8:n], func(r usnRec) {
				got++
				if ev, ok := applyChange(ix, v, r); ok {
					w.events = append(w.events, ev)
				}
			})
			v.nextUSN = int64(le.Uint64(w.buf))
			total += got
			if got == 0 {
				break
			}
		}
	}
	return total, nil
}

func applyChange(ix *Index, v *volume, r usnRec) (ChangeEvent, bool) {
	k, pk := v.key(r.frn), v.key(r.parent)
	ev := ChangeEvent{Key: k, Name: r.name, Dir: r.dir, Time: time.Now().Unix()}
	switch {
	case r.reason&reasonDelete != 0:
		if r.reason&reasonCreate != 0 && !ix.Exists(k) {
			return ev, false // a temporary file created and deleted in between
		}
		ev.Path, ev.Kind = ix.Path(k), "삭제"
		ix.Remove(k)
	case r.reason&(reasonNewName|reasonCreate|reasonData) != 0:
		if !ix.Exists(pk) {
			pk = v.rootKey
		}
		ix.Upsert(k, pk, r.name, r.dir)
		ev.Path = ix.Path(k)
		switch {
		case r.reason&reasonCreate != 0:
			ev.Kind = "생성"
		case r.reason&reasonNewName != 0:
			ev.Kind = "이름 변경"
		default:
			ev.Kind = "수정"
		}
	default:
		return ev, false
	}
	return ev, true
}

func openAllVolumes(log func(string)) ([]*volume, bool) {
	var vols []*volume
	for i, d := range ntfsDrives() {
		v, err := openVolume(d, i+1)
		if err != nil {
			log(err.Error())
			for _, ov := range vols {
				syscall.CloseHandle(ov.h)
			}
			return nil, false
		}
		vols = append(vols, v)
	}
	return vols, len(vols) > 0
}

// resumeNTFS reopens the volumes and continues from journal positions saved
// with the cache. It fails if a drive changed or the journal was reset or
// has already discarded records we have not read.
func resumeNTFS(saved map[string][2]int64, log func(string)) (watcher, bool) {
	if !isAdmin() || len(saved) == 0 {
		return nil, false
	}
	vols, ok := openAllVolumes(log)
	if !ok {
		return nil, false
	}
	good := len(vols) == len(saved)
	for _, v := range vols {
		j, has := saved[v.letter]
		if !has || uint64(j[0]) != v.journalID || j[1] < v.firstUSN || j[1] > v.nextUSN {
			good = false
			break
		}
		v.nextUSN = j[1]
	}
	if !good {
		for _, v := range vols {
			syscall.CloseHandle(v.h)
		}
		return nil, false
	}
	return &ntfsWatcher{vols: vols, buf: make([]byte, bufSize)}, true
}

func buildNTFS(progress func(int, string), log func(string)) (*Index, watcher, bool) {
	if !isAdmin() {
		log("관리자 권한이 아니라서 폴더 탐색 방식으로 색인합니다 (더 느림).")
		return nil, nil, false
	}
	vols, ok := openAllVolumes(log)
	if !ok {
		return nil, nil, false
	}
	b := NewBuilder()
	w := &ntfsWatcher{vols: vols, buf: make([]byte, bufSize)}
	for _, v := range vols {
		if err := v.enumerate(b, progress); err != nil {
			log(err.Error())
			for _, ov := range vols {
				syscall.CloseHandle(ov.h)
			}
			return nil, nil, false
		}
	}
	roots := map[uint64]uint64{}
	for _, v := range w.vols {
		roots[v.base] = v.rootKey
	}
	ix := b.Build(func(k uint64) (uint64, bool) {
		r, ok := roots[k&^frnMask]
		return r, ok
	})
	return ix, w, true
}

func canNTFS() bool { return isAdmin() && len(ntfsDrives()) > 0 }
