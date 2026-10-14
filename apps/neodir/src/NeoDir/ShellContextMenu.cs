using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;

namespace NeoDir;

/// <summary>
/// The real Windows right-click menu (Open with, Send to, 7-Zip, New ▸ …) for files or for a
/// folder's empty space. Submenus that fill themselves in need the window's messages, so
/// <see cref="HandleWindowMessage"/> is hooked into the main window.
/// </summary>
public static class ShellContextMenu
{
    private const uint CmfNormal = 0x0;
    private const uint CmfExplore = 0x4;
    private const uint CmfCanRename = 0x10;
    private const uint CmfExtendedVerbs = 0x100;
    private const uint TpmReturnCmd = 0x100;
    private const uint TpmRightButton = 0x2;
    private const uint CmicMaskUnicode = 0x4000;
    private const uint CmicMaskPtInvoke = 0x20000000;
    private const uint GcsVerbW = 0x4;
    private const int FirstCommand = 1;
    private const int LastCommand = 0x7FFF;

    private const int WmInitMenuPopup = 0x117;
    private const int WmDrawItem = 0x2B;
    private const int WmMeasureItem = 0x2C;
    private const int WmMenuChar = 0x120;

    private static IContextMenu2? _menu2;
    private static IContextMenu3? _menu3;

    private static Guid IidShellFolder = new("000214E6-0000-0000-C000-000000000046");
    private static Guid IidContextMenu = new("000214e4-0000-0000-c000-000000000046");

    /// <summary>Menu for files that all sit in the same folder. Returns the verb the user picked if we should handle it ourselves.</summary>
    public static string? ShowForItems(Window owner, IReadOnlyList<string> paths, bool extended, Func<string, bool> handleVerb)
    {
        if (paths.Count == 0) return null;
        var pidls = new List<IntPtr>();
        try
        {
            foreach (var path in paths)
            {
                if (SHParseDisplayName(path, IntPtr.Zero, out var pidl, 0, out _) != 0) return null;
                pidls.Add(pidl);
            }
            if (SHBindToParent(pidls[0], ref IidShellFolder, out var parent, out _) != 0) return null;
            var children = pidls.Select(ILFindLastID).ToArray();
            var hwnd = new WindowInteropHelper(owner).Handle;
            if (parent.GetUIObjectOf(hwnd, (uint)children.Length, children, ref IidContextMenu, IntPtr.Zero, out var obj) != 0) return null;
            var flags = CmfNormal | CmfExplore | CmfCanRename | (extended ? CmfExtendedVerbs : 0);
            return Run(owner, (IContextMenu)obj, flags, null, handleVerb);
        }
        finally
        {
            foreach (var pidl in pidls) Marshal.FreeCoTaskMem(pidl);
        }
    }

    /// <summary>Menu for a folder's empty space: View, Paste, New ▸, Properties.</summary>
    public static void ShowForFolder(Window owner, string folder, bool extended)
    {
        if (SHParseDisplayName(folder, IntPtr.Zero, out var pidl, 0, out _) != 0) return;
        try
        {
            if (SHGetDesktopFolder(out var desktop) != 0) return;
            if (desktop.BindToObject(pidl, IntPtr.Zero, ref IidShellFolder, out var folderObj) != 0) return;
            var shellFolder = (IShellFolder)folderObj;
            var hwnd = new WindowInteropHelper(owner).Handle;
            if (shellFolder.CreateViewObject(hwnd, ref IidContextMenu, out var obj) != 0) return;
            Run(owner, (IContextMenu)obj, CmfNormal | (extended ? CmfExtendedVerbs : 0), folder, _ => false);
        }
        finally
        {
            Marshal.FreeCoTaskMem(pidl);
        }
    }

    private static string? Run(Window owner, IContextMenu menu, uint flags, string? directory, Func<string, bool> handleVerb)
    {
        var hmenu = CreatePopupMenu();
        try
        {
            if (menu.QueryContextMenu(hmenu, 0, FirstCommand, LastCommand, flags) < 0) return null;
            _menu2 = menu as IContextMenu2;
            _menu3 = menu as IContextMenu3;
            GetCursorPos(out var pt);
            var hwnd = new WindowInteropHelper(owner).Handle;
            var command = TrackPopupMenuEx(hmenu, TpmReturnCmd | TpmRightButton, pt.X, pt.Y, hwnd, IntPtr.Zero);
            _menu2 = null;
            _menu3 = null;
            if (command < FirstCommand) return null;

            var verb = GetVerb(menu, command - FirstCommand);
            // "Rename" needs Explorer's own view to edit in place; do it our way instead.
            if (verb != null && handleVerb(verb)) return verb;

            var directoryPtr = directory == null ? IntPtr.Zero : Marshal.StringToHGlobalUni(directory);
            try
            {
                var info = new CmInvokeCommandInfoEx
                {
                    cbSize = Marshal.SizeOf<CmInvokeCommandInfoEx>(),
                    fMask = CmicMaskUnicode | CmicMaskPtInvoke,
                    hwnd = hwnd,
                    lpVerb = (IntPtr)(command - FirstCommand),
                    lpVerbW = (IntPtr)(command - FirstCommand),
                    lpDirectoryW = directoryPtr,
                    nShow = 1,
                    ptInvoke = pt,
                };
                menu.InvokeCommand(ref info);
            }
            finally
            {
                if (directoryPtr != IntPtr.Zero) Marshal.FreeHGlobal(directoryPtr);
            }
            return verb;
        }
        finally
        {
            DestroyMenu(hmenu);
            Marshal.FinalReleaseComObject(menu);
        }
    }

    private static string? GetVerb(IContextMenu menu, int offset)
    {
        var buffer = Marshal.AllocHGlobal(520);
        try
        {
            return menu.GetCommandString((UIntPtr)offset, GcsVerbW, IntPtr.Zero, buffer, 260) == 0
                ? Marshal.PtrToStringUni(buffer)
                : null;
        }
        catch (Exception)
        {
            return null;
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    /// <summary>Lets "Send to", "Open with" and owner-drawn items draw while the menu is open.</summary>
    public static IntPtr HandleWindowMessage(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (_menu2 == null && _menu3 == null) return IntPtr.Zero;
        if (msg is not (WmInitMenuPopup or WmDrawItem or WmMeasureItem or WmMenuChar)) return IntPtr.Zero;
        try
        {
            if (_menu3 != null)
            {
                var result = Marshal.AllocHGlobal(IntPtr.Size);
                try
                {
                    if (_menu3.HandleMenuMsg2((uint)msg, wParam, lParam, result) == 0)
                    {
                        handled = true;
                        return Marshal.ReadIntPtr(result);
                    }
                }
                finally
                {
                    Marshal.FreeHGlobal(result);
                }
            }
            else if (_menu2 != null && _menu2.HandleMenuMsg((uint)msg, wParam, lParam) == 0)
            {
                handled = true;
            }
        }
        catch (Exception)
        {
            // A broken shell extension shouldn't take the window down.
        }
        return IntPtr.Zero;
    }

    [StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
    private struct NativePoint
    {
        public int X;
        public int Y;
    }

    [StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
    private struct CmInvokeCommandInfoEx
    {
        public int cbSize;
        public uint fMask;
        public IntPtr hwnd;
        public IntPtr lpVerb;
        public IntPtr lpParameters;
        public IntPtr lpDirectory;
        public int nShow;
        public uint dwHotKey;
        public IntPtr hIcon;
        public IntPtr lpTitle;
        public IntPtr lpVerbW;
        public IntPtr lpParametersW;
        public IntPtr lpDirectoryW;
        public IntPtr lpTitleW;
        public NativePoint ptInvoke;
    }

    [ComImport, Guid("000214E6-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellFolder
    {
        [PreserveSig] int ParseDisplayName(IntPtr hwnd, IntPtr pbc, [MarshalAs(UnmanagedType.LPWStr)] string name, IntPtr eaten, out IntPtr pidl, IntPtr attributes);
        [PreserveSig] int EnumObjects(IntPtr hwnd, int flags, out IntPtr enumIdList);
        [PreserveSig] int BindToObject(IntPtr pidl, IntPtr pbc, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out object ppv);
        [PreserveSig] int BindToStorage(IntPtr pidl, IntPtr pbc, ref Guid riid, out IntPtr ppv);
        [PreserveSig] int CompareIDs(IntPtr lParam, IntPtr pidl1, IntPtr pidl2);
        [PreserveSig] int CreateViewObject(IntPtr hwndOwner, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out object ppv);
        [PreserveSig] int GetAttributesOf(uint count, IntPtr pidls, ref uint attributes);
        [PreserveSig] int GetUIObjectOf(IntPtr hwndOwner, uint count, [MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 1)] IntPtr[] pidls,
            ref Guid riid, IntPtr reserved, [MarshalAs(UnmanagedType.Interface)] out object ppv);
        [PreserveSig] int GetDisplayNameOf(IntPtr pidl, uint flags, IntPtr name);
        [PreserveSig] int SetNameOf(IntPtr hwnd, IntPtr pidl, [MarshalAs(UnmanagedType.LPWStr)] string name, uint flags, out IntPtr pidlOut);
    }

    [ComImport, Guid("000214e4-0000-0000-c000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IContextMenu
    {
        [PreserveSig] int QueryContextMenu(IntPtr hmenu, uint indexMenu, uint idCmdFirst, uint idCmdLast, uint flags);
        [PreserveSig] int InvokeCommand(ref CmInvokeCommandInfoEx info);
        [PreserveSig] int GetCommandString(UIntPtr idCmd, uint type, IntPtr reserved, IntPtr name, uint cch);
    }

    [ComImport, Guid("000214f4-0000-0000-c000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IContextMenu2
    {
        [PreserveSig] int QueryContextMenu(IntPtr hmenu, uint indexMenu, uint idCmdFirst, uint idCmdLast, uint flags);
        [PreserveSig] int InvokeCommand(ref CmInvokeCommandInfoEx info);
        [PreserveSig] int GetCommandString(UIntPtr idCmd, uint type, IntPtr reserved, IntPtr name, uint cch);
        [PreserveSig] int HandleMenuMsg(uint msg, IntPtr wParam, IntPtr lParam);
    }

    [ComImport, Guid("bcfce0a0-ec17-11d0-8d10-00a0c90f2719"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IContextMenu3
    {
        [PreserveSig] int QueryContextMenu(IntPtr hmenu, uint indexMenu, uint idCmdFirst, uint idCmdLast, uint flags);
        [PreserveSig] int InvokeCommand(ref CmInvokeCommandInfoEx info);
        [PreserveSig] int GetCommandString(UIntPtr idCmd, uint type, IntPtr reserved, IntPtr name, uint cch);
        [PreserveSig] int HandleMenuMsg(uint msg, IntPtr wParam, IntPtr lParam);
        [PreserveSig] int HandleMenuMsg2(uint msg, IntPtr wParam, IntPtr lParam, IntPtr result);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SHParseDisplayName(string name, IntPtr bindingContext, out IntPtr pidl, uint sfgaoIn, out uint sfgaoOut);

    [DllImport("shell32.dll")]
    private static extern int SHBindToParent(IntPtr pidl, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellFolder ppv, out IntPtr pidlLast);

    [DllImport("shell32.dll")]
    private static extern int SHGetDesktopFolder([MarshalAs(UnmanagedType.Interface)] out IShellFolder ppshf);

    [DllImport("shell32.dll")]
    private static extern IntPtr ILFindLastID(IntPtr pidl);

    [DllImport("user32.dll")]
    private static extern IntPtr CreatePopupMenu();

    [DllImport("user32.dll")]
    private static extern bool DestroyMenu(IntPtr hmenu);

    [DllImport("user32.dll")]
    private static extern int TrackPopupMenuEx(IntPtr hmenu, uint flags, int x, int y, IntPtr hwnd, IntPtr tpm);

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out NativePoint point);
}
