using System.Collections.Specialized;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using Microsoft.VisualBasic.FileIO;
using NeoDir.Core;

namespace NeoDir;

/// <summary>
/// Copy, move and delete through the Windows shell, so the user gets the familiar
/// progress window, overwrite prompts and Recycle Bin.
/// </summary>
public static class FileOps
{
    private const int DropEffectCopy = 5;
    private const int DropEffectMove = 2;

    public static void SetClipboard(IReadOnlyCollection<string> paths, bool cut)
    {
        var files = new StringCollection();
        files.AddRange(paths.ToArray());
        var data = new DataObject();
        data.SetFileDropList(files);
        // Explorer reads this to know whether Paste should move or copy.
        data.SetData("Preferred DropEffect", new MemoryStream(BitConverter.GetBytes(cut ? DropEffectMove : DropEffectCopy)));
        Retry(() => Clipboard.SetDataObject(data, true));
    }

    public static void SetClipboardText(string text) => Retry(() => Clipboard.SetText(text));

    /// <summary>Files on the clipboard (from NeoDir or Explorer) and whether they were cut.</summary>
    public static (List<string> Paths, bool Cut) GetClipboard()
    {
        try
        {
            if (!Clipboard.ContainsFileDropList()) return ([], false);
            var paths = Clipboard.GetFileDropList().Cast<string>().ToList();
            var cut = false;
            if (Clipboard.GetData("Preferred DropEffect") is MemoryStream stream && stream.Length >= 4)
            {
                var bytes = new byte[4];
                stream.Position = 0;
                stream.ReadExactly(bytes);
                cut = (BitConverter.ToInt32(bytes, 0) & DropEffectMove) != 0;
            }
            return (paths, cut);
        }
        catch (ExternalException)
        {
            return ([], false);
        }
    }

    /// <summary>
    /// Copies or moves into <paramref name="destination"/>. Copying into the same folder makes
    /// "name (2)" instead of asking to overwrite. Returns the names created there.
    /// </summary>
    public static Task<List<string>> TransferAsync(IReadOnlyList<string> sources, string destination, bool move)
    {
        return RunSta(() =>
        {
            var created = new List<string>();
            foreach (var raw in sources)
            {
                var source = raw.TrimEnd('\\');
                var isDir = Directory.Exists(source);
                if (!isDir && !File.Exists(source)) continue;
                var name = Path.GetFileName(source);
                if (string.IsNullOrEmpty(name)) continue; // a drive root

                var sameFolder = string.Equals(Path.GetDirectoryName(source), destination.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
                if (sameFolder && move) continue;
                if (isDir && (destination + "\\").StartsWith(source + "\\", StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException($"'{name}' 폴더를 자기 안으로 옮길 수는 없어요.");
                if (sameFolder)
                    name = UniqueName.Next(name, isDir, n => Path.Exists(Path.Combine(destination, n)));

                var target = Path.Combine(destination, name);
                try
                {
                    if (isDir && move) FileSystem.MoveDirectory(source, target, UIOption.AllDialogs, UICancelOption.ThrowException);
                    else if (isDir) FileSystem.CopyDirectory(source, target, UIOption.AllDialogs, UICancelOption.ThrowException);
                    else if (move) FileSystem.MoveFile(source, target, UIOption.AllDialogs, UICancelOption.ThrowException);
                    else FileSystem.CopyFile(source, target, UIOption.AllDialogs, UICancelOption.ThrowException);
                    created.Add(name);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
            }
            return created;
        });
    }

    public static Task DeleteAsync(IReadOnlyList<string> paths, bool permanently)
    {
        var recycle = permanently ? RecycleOption.DeletePermanently : RecycleOption.SendToRecycleBin;
        return RunSta(() =>
        {
            foreach (var path in paths)
            {
                try
                {
                    if (Directory.Exists(path))
                        FileSystem.DeleteDirectory(path, UIOption.OnlyErrorDialogs, recycle, UICancelOption.ThrowException);
                    else if (File.Exists(path))
                        FileSystem.DeleteFile(path, UIOption.OnlyErrorDialogs, recycle, UICancelOption.ThrowException);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
            }
            return true;
        });
    }

    public static void Rename(string path, string newName)
    {
        var target = Path.Combine(Path.GetDirectoryName(path)!, newName);
        if (Directory.Exists(path)) Directory.Move(path, target);
        else File.Move(path, target);
    }

    /// <summary>The shell dialogs need a single-threaded apartment; keep them off the UI thread.</summary>
    private static Task<T> RunSta<T>(Func<T> work)
    {
        var tcs = new TaskCompletionSource<T>();
        var thread = new Thread(() =>
        {
            try { tcs.SetResult(work()); }
            catch (Exception ex) { tcs.SetException(ex); }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.IsBackground = true;
        thread.Start();
        return tcs.Task;
    }

    private static void Retry(Action action)
    {
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                action();
                return;
            }
            catch (ExternalException) when (attempt < 4)
            {
                Thread.Sleep(50);
            }
        }
    }
}
