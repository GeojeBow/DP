"""Windows NTFS fast path: read the MFT through the USN journal API.

This is how Everything gets a whole drive indexed in seconds:
  1. FSCTL_ENUM_USN_DATA walks every record of the Master File Table and
     returns (file id, parent id, name, attributes) without touching folders
     one by one.
  2. FSCTL_READ_USN_JOURNAL then streams every create / delete / rename on
     the volume, so the index stays current without rescanning.

Both need a volume handle (\\\\.\\C:), which needs administrator rights.
Only standard ctypes is used, no extra packages.
"""

from __future__ import annotations

import ctypes
import os
import struct
from ctypes import wintypes

if os.name != "nt":  # pragma: no cover - imported only on Windows
    raise ImportError("ntfs module is Windows only")

k32 = ctypes.WinDLL("kernel32", use_last_error=True)

GENERIC_READ = 0x80000000
FILE_SHARE_ALL = 0x1 | 0x2 | 0x4
OPEN_EXISTING = 3
FILE_FLAG_BACKUP_SEMANTICS = 0x02000000
INVALID_HANDLE = ctypes.c_void_p(-1).value

FSCTL_ENUM_USN_DATA = 0x000900B3
FSCTL_READ_USN_JOURNAL = 0x000900BB
FSCTL_CREATE_USN_JOURNAL = 0x000900E7
FSCTL_QUERY_USN_JOURNAL = 0x000900F4

ERROR_HANDLE_EOF = 38
ERROR_JOURNAL_NOT_ACTIVE = 1179
ERROR_JOURNAL_ENTRY_DELETED = 1181

FILE_ATTRIBUTE_DIRECTORY = 0x10

USN_REASON_FILE_CREATE = 0x00000100
USN_REASON_FILE_DELETE = 0x00000200
USN_REASON_RENAME_OLD_NAME = 0x00001000
USN_REASON_RENAME_NEW_NAME = 0x00002000
WATCH_MASK = (USN_REASON_FILE_CREATE | USN_REASON_FILE_DELETE
              | USN_REASON_RENAME_OLD_NAME | USN_REASON_RENAME_NEW_NAME)

k32.CreateFileW.restype = wintypes.HANDLE
k32.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID,
                            wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
k32.DeviceIoControl.restype = wintypes.BOOL
k32.DeviceIoControl.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPVOID, wintypes.DWORD,
                                wintypes.LPVOID, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD),
                                wintypes.LPVOID]
k32.CloseHandle.argtypes = [wintypes.HANDLE]
k32.GetFileInformationByHandle.argtypes = [wintypes.HANDLE, wintypes.LPVOID]
k32.GetVolumeInformationW.argtypes = [wintypes.LPCWSTR, wintypes.LPWSTR, wintypes.DWORD,
                                      ctypes.POINTER(wintypes.DWORD), ctypes.POINTER(wintypes.DWORD),
                                      ctypes.POINTER(wintypes.DWORD), wintypes.LPWSTR, wintypes.DWORD]
k32.GetDriveTypeW.argtypes = [wintypes.LPCWSTR]

BUF_SIZE = 1 << 20


def is_admin() -> bool:
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def ntfs_drives() -> list[str]:
    """Fixed drives formatted NTFS, e.g. ["C", "D"]."""
    out = []
    mask = k32.GetLogicalDrives()
    for n in range(26):
        if not mask & (1 << n):
            continue
        letter = chr(65 + n)
        root = f"{letter}:\\"
        if k32.GetDriveTypeW(root) != 3:  # DRIVE_FIXED
            continue
        fs = ctypes.create_unicode_buffer(32)
        if k32.GetVolumeInformationW(root, None, 0, None, None, None, fs, 32) and fs.value == "NTFS":
            out.append(letter)
    return out


def _err(what: str) -> OSError:
    code = ctypes.get_last_error()
    e = OSError(code, f"{what}: {ctypes.FormatError(code)}")
    e.winerror_code = code
    return e


def _ioctl(h, code, inbuf: bytes, outbuf) -> int:
    n = wintypes.DWORD(0)
    ok = k32.DeviceIoControl(h, code, inbuf, len(inbuf), outbuf, len(outbuf), ctypes.byref(n), None)
    if not ok:
        raise _err(f"DeviceIoControl {code:#x}")
    return n.value


def _records(data: bytes, off: int):
    """Parse USN_RECORD_V2 entries -> (frn, parent_frn, reason, attrs, name)."""
    end = len(data)
    unpack = struct.unpack_from
    while off + 60 <= end:
        reclen, major = unpack("<IH", data, off)
        if reclen == 0:
            break
        if major == 2:
            frn, pfrn = unpack("<QQ", data, off + 8)
            reason, = unpack("<I", data, off + 40)
            attrs, nlen, noff = unpack("<IHH", data, off + 52)
            name = data[off + noff: off + noff + nlen].decode("utf-16-le", "replace")
            yield frn, pfrn, reason, attrs, name
        off += reclen


class Volume:
    def __init__(self, letter: str, vol_no: int):
        self.letter = letter
        self.base = vol_no << 64  # keys are base | frn, unique across drives
        self.h = k32.CreateFileW(f"\\\\.\\{letter}:", GENERIC_READ, FILE_SHARE_ALL, None,
                                 OPEN_EXISTING, 0, None)
        if self.h in (None, INVALID_HANDLE):
            raise _err(f"open volume {letter}:")
        self.journal_id, self.next_usn, self.first_usn = self._query_journal()
        self.root_key = self.base | self._root_frn()

    def close(self):
        if self.h:
            k32.CloseHandle(self.h)
            self.h = None

    def _query_journal(self):
        out = ctypes.create_string_buffer(64)
        try:
            _ioctl(self.h, FSCTL_QUERY_USN_JOURNAL, b"", out)
        except OSError as e:
            if getattr(e, "winerror_code", None) != ERROR_JOURNAL_NOT_ACTIVE:
                raise
            # Same as Everything: turn the change journal on (32 MB, 4 MB delta).
            _ioctl(self.h, FSCTL_CREATE_USN_JOURNAL, struct.pack("<QQ", 32 << 20, 4 << 20),
                   ctypes.create_string_buffer(1))
            _ioctl(self.h, FSCTL_QUERY_USN_JOURNAL, b"", out)
        jid, first, nxt = struct.unpack_from("<Qqq", out.raw, 0)
        return jid, nxt, first

    def _root_frn(self) -> int:
        h = k32.CreateFileW(f"{self.letter}:\\", 0, FILE_SHARE_ALL, None, OPEN_EXISTING,
                            FILE_FLAG_BACKUP_SEMANTICS, None)
        if h in (None, INVALID_HANDLE):
            raise _err("open root")
        try:
            info = ctypes.create_string_buffer(52)
            if not k32.GetFileInformationByHandle(h, info):
                raise _err("GetFileInformationByHandle")
            hi, lo = struct.unpack_from("<II", info.raw, 44)
            return (hi << 32) | lo
        finally:
            k32.CloseHandle(h)

    def enumerate_into(self, builder, progress=None) -> None:
        """Read every MFT record of the volume into the builder."""
        builder.add_root(self.root_key, f"{self.letter}:")
        buf = ctypes.create_string_buffer(BUF_SIZE)
        start = 0
        base = self.base
        while True:
            med = struct.pack("<Qqq", start, 0, self.next_usn)  # MFT_ENUM_DATA_V0
            try:
                n = _ioctl(self.h, FSCTL_ENUM_USN_DATA, med, buf)
            except OSError as e:
                if getattr(e, "winerror_code", None) == ERROR_HANDLE_EOF:
                    break
                raise
            data = ctypes.string_at(buf, n)
            start, = struct.unpack_from("<Q", data, 0)
            for frn, pfrn, _reason, attrs, name in _records(data, 8):
                builder.add(base | frn, base | pfrn, name, bool(attrs & FILE_ATTRIBUTE_DIRECTORY))
            if progress:
                progress(len(builder), f"{self.letter}:")
            if n <= 8:
                break

    def read_changes(self):
        """Yield new journal records since the last call (non-blocking)."""
        buf = ctypes.create_string_buffer(BUF_SIZE)
        while True:
            # READ_USN_JOURNAL_DATA_V0
            req = struct.pack("<qIIQQQ", self.next_usn, WATCH_MASK, 0, 0, 0, self.journal_id)
            n = _ioctl(self.h, FSCTL_READ_USN_JOURNAL, req, buf)
            data = ctypes.string_at(buf, n)
            nxt, = struct.unpack_from("<q", data, 0)
            got = False
            for frn, pfrn, reason, attrs, name in _records(data, 8):
                got = True
                yield self.base | frn, self.base | pfrn, reason, bool(attrs & FILE_ATTRIBUTE_DIRECTORY), name
            self.next_usn = nxt
            if not got:
                return


def apply_change(index, vol: Volume, key, pkey, reason, is_dir, name) -> None:
    # Reason bits accumulate until the file is closed, so a rename's second
    # record carries both OLD_NAME and NEW_NAME: check NEW_NAME before OLD_NAME.
    if reason & USN_REASON_FILE_DELETE:
        index.remove(key)
    elif reason & USN_REASON_RENAME_NEW_NAME or reason & USN_REASON_FILE_CREATE:
        if index.node(pkey) is None:
            pkey = vol.root_key
        index.upsert(key, pkey, name, is_dir)
    elif reason & USN_REASON_RENAME_OLD_NAME:
        index.remove(key)
