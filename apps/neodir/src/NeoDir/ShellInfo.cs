using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace NeoDir;

/// <summary>Icons, type names and shell verbs straight from Windows.</summary>
public static class ShellInfo
{
    private const uint ShgfiIcon = 0x100;
    private const uint ShgfiSmallIcon = 0x1;
    private const uint ShgfiTypeName = 0x400;
    private const uint ShgfiUseFileAttributes = 0x10;
    private const uint FileAttributeDirectory = 0x10;
    private const uint FileAttributeNormal = 0x80;
    private const uint SeeMaskInvokeIdList = 0xC;

    // These carry their own icon, so they can't share one per extension.
    private static readonly HashSet<string> PerFileIcons = new(StringComparer.OrdinalIgnoreCase)
    {
        ".exe", ".lnk", ".ico", ".url", ".msc", ".cpl", ".scr", ".appref-ms",
    };

    private static readonly Dictionary<string, ImageSource?> IconCache = new(StringComparer.OrdinalIgnoreCase);
    private static readonly Dictionary<string, string> TypeCache = new(StringComparer.OrdinalIgnoreCase);

    public static ImageSource? GetIcon(string path, bool isDirectory, bool isDrive = false)
    {
        string key;
        bool useAttributes;
        if (isDrive)
        {
            key = path;
            useAttributes = false;
        }
        else if (isDirectory)
        {
            key = "<dir>";
            useAttributes = true;
        }
        else
        {
            var ext = Path.GetExtension(path);
            useAttributes = !PerFileIcons.Contains(ext);
            key = useAttributes ? (ext.Length == 0 ? "<noext>" : ext) : path;
        }

        if (IconCache.TryGetValue(key, out var cached)) return cached;
        var icon = LoadIcon(useAttributes && !isDirectory && !isDrive ? "x" + Path.GetExtension(path) : path,
            isDirectory ? FileAttributeDirectory : FileAttributeNormal, useAttributes);
        IconCache[key] = icon;
        return icon;
    }

    public static string GetTypeName(string name, bool isDirectory)
    {
        if (isDirectory) return "파일 폴더";
        var ext = Path.GetExtension(name);
        if (TypeCache.TryGetValue(ext, out var cached)) return cached;
        var info = new ShFileInfo();
        SHGetFileInfo("x" + ext, FileAttributeNormal, ref info, (uint)Marshal.SizeOf<ShFileInfo>(),
            ShgfiTypeName | ShgfiUseFileAttributes);
        var type = string.IsNullOrEmpty(info.szTypeName) ? (ext.Length > 1 ? ext[1..].ToUpperInvariant() + " 파일" : "파일") : info.szTypeName;
        TypeCache[ext] = type;
        return type;
    }

    private static ImageSource? LoadIcon(string path, uint attributes, bool useAttributes)
    {
        var info = new ShFileInfo();
        var flags = ShgfiIcon | ShgfiSmallIcon | (useAttributes ? ShgfiUseFileAttributes : 0);
        var result = SHGetFileInfo(path, attributes, ref info, (uint)Marshal.SizeOf<ShFileInfo>(), flags);
        if (result == IntPtr.Zero || info.hIcon == IntPtr.Zero) return null;
        try
        {
            var source = Imaging.CreateBitmapSourceFromHIcon(info.hIcon, Int32Rect.Empty, BitmapSizeOptions.FromEmptyOptions());
            source.Freeze();
            return source;
        }
        catch (Exception)
        {
            return null;
        }
        finally
        {
            DestroyIcon(info.hIcon);
        }
    }

    /// <summary>Explorer's "natural" order: file2 before file10.</summary>
    public static int CompareNatural(string a, string b) => StrCmpLogicalW(a, b);

    public static void Open(string path, string? arguments = null, string? workingDirectory = null)
    {
        var start = new ProcessStartInfo(path) { UseShellExecute = true };
        if (arguments != null) start.Arguments = arguments;
        if (workingDirectory != null) start.WorkingDirectory = workingDirectory;
        Process.Start(start);
    }

    public static void ShowProperties(string path)
    {
        var info = new ShellExecuteInfo
        {
            cbSize = Marshal.SizeOf<ShellExecuteInfo>(),
            lpVerb = "properties",
            lpFile = path,
            nShow = 5,
            fMask = SeeMaskInvokeIdList,
        };
        ShellExecuteEx(ref info);
    }

    public static void RevealInExplorer(string path)
    {
        if (Directory.Exists(path) && !File.Exists(path))
            Process.Start("explorer.exe", $"\"{path}\"");
        else
            Process.Start("explorer.exe", $"/select,\"{path}\"");
    }

    /// <summary>Windows Terminal when it's there, otherwise the classic console.</summary>
    public static void OpenTerminal(string folder)
    {
        try
        {
            Open("wt.exe", $"-d \"{folder.TrimEnd('\\')}\\.\"");
        }
        catch (Win32Exception)
        {
            Open("cmd.exe", null, folder);
        }
    }

    [StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ShFileInfo
    {
        public IntPtr hIcon;
        public int iIcon;
        public uint dwAttributes;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szDisplayName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)]
        public string szTypeName;
    }

    [StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ShellExecuteInfo
    {
        public int cbSize;
        public uint fMask;
        public IntPtr hwnd;
        public string? lpVerb;
        public string? lpFile;
        public string? lpParameters;
        public string? lpDirectory;
        public int nShow;
        public IntPtr hInstApp;
        public IntPtr lpIDList;
        public string? lpClass;
        public IntPtr hkeyClass;
        public uint dwHotKey;
        public IntPtr hIcon;
        public IntPtr hProcess;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr SHGetFileInfo(string pszPath, uint dwFileAttributes, ref ShFileInfo psfi, uint cbFileInfo, uint uFlags);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool ShellExecuteEx(ref ShellExecuteInfo lpExecInfo);

    [DllImport("user32.dll")]
    private static extern bool DestroyIcon(IntPtr hIcon);

    [DllImport("shlwapi.dll", CharSet = CharSet.Unicode)]
    private static extern int StrCmpLogicalW(string a, string b);
}
