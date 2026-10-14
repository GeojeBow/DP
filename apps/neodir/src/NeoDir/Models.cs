using System.Collections.Concurrent;
using System.ComponentModel;
using System.IO;
using System.Runtime.CompilerServices;
using System.Windows;
using System.Windows.Media;
using NeoDir.Core;

namespace NeoDir;

public abstract class Observable : INotifyPropertyChanged
{
    public event PropertyChangedEventHandler? PropertyChanged;

    protected bool Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value)) return false;
        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
        return true;
    }

    protected void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}

/// <summary>One row in a pane's file list.</summary>
public sealed class FileEntry
{
    private static readonly ConcurrentDictionary<string, Brush> BrushCache = new();

    private ImageSource? _icon;
    private bool _iconLoaded;
    private string? _typeName;

    public required string FullPath { get; init; }
    public required string Name { get; init; }
    public bool IsDirectory { get; init; }
    public bool IsDrive { get; init; }
    public bool IsHidden { get; init; }
    public long Size { get; init; } = -1;
    public DateTime Modified { get; init; }
    public string? Detail { get; init; }
    public Brush? Foreground { get; init; }
    /// <summary>OneDrive "online-only" file: reading it would download it.</summary>
    public bool IsCloudOnly { get; init; }
    /// <summary>Folder relative to the search root, shown only in search results.</summary>
    public string? Location { get; init; }

    public Visibility CloudVisibility => IsCloudOnly ? Visibility.Visible : Visibility.Collapsed;

    public double Opacity => IsHidden ? 0.55 : 1;

    public ImageSource? Icon
    {
        get
        {
            if (!_iconLoaded)
            {
                _icon = ShellInfo.GetIcon(FullPath, IsDirectory, IsDrive, IsCloudOnly);
                _iconLoaded = true;
            }
            return _icon;
        }
    }

    public string TypeName => _typeName ??= IsDrive ? Detail ?? "드라이브" : ShellInfo.GetTypeName(Name, IsDirectory);

    public string SizeText => IsDrive ? "" : IsDirectory ? "" : SizeFormatter.Format(Size);

    public string ModifiedText => Modified == default ? "" : Modified.ToString("yyyy-MM-dd  HH:mm");

    /// <summary>Reads a folder off the UI thread. Throws when the folder can't be opened.</summary>
    public static List<FileEntry> ReadFolder(string path, bool showHidden, ColorRules colors, CancellationToken token)
    {
        if (path == PathCrumbs.ThisPc) return ReadDrives();

        var dir = new DirectoryInfo(path);
        if (!dir.Exists) throw new DirectoryNotFoundException($"폴더를 찾을 수 없어요: {path}");
        var options = new EnumerationOptions
        {
            IgnoreInaccessible = true,
            AttributesToSkip = showHidden ? 0 : FileAttributes.Hidden | FileAttributes.System,
            ReturnSpecialDirectories = false,
        };

        var entries = new List<FileEntry>();
        foreach (var info in dir.EnumerateFileSystemInfos("*", options))
        {
            token.ThrowIfCancellationRequested();
            entries.Add(From(info, colors, null));
        }
        return entries;
    }

    private const FileAttributes RecallOnOpen = (FileAttributes)0x40000;
    private const FileAttributes RecallOnDataAccess = (FileAttributes)0x400000;

    public static FileEntry From(FileSystemInfo info, ColorRules colors, string? location)
    {
        var attributes = info.Attributes;
        var isDir = (attributes & FileAttributes.Directory) != 0;
        var color = isDir ? null : colors.ColorFor(info.Name);
        return new FileEntry
        {
            FullPath = info.FullName,
            Name = info.Name,
            IsDirectory = isDir,
            IsHidden = (attributes & FileAttributes.Hidden) != 0,
            IsCloudOnly = !isDir && (attributes & (FileAttributes.Offline | RecallOnOpen | RecallOnDataAccess)) != 0,
            Size = info is FileInfo file ? file.Length : -1,
            Modified = info.LastWriteTime,
            Foreground = color == null ? null : BrushFor(color),
            Location = location,
        };
    }

    /// <summary>
    /// Walks every subfolder for names matching <paramref name="filter"/>, handing results
    /// over in batches so the list fills while it searches.
    /// </summary>
    public static int Search(string root, NameFilter filter, bool showHidden, ColorRules colors,
        Action<List<FileEntry>> onBatch, int limit, CancellationToken token)
    {
        var options = new EnumerationOptions
        {
            IgnoreInaccessible = true,
            RecurseSubdirectories = true,
            AttributesToSkip = showHidden ? 0 : FileAttributes.Hidden | FileAttributes.System,
            ReturnSpecialDirectories = false,
        };
        var batch = new List<FileEntry>();
        var found = 0;
        var lastFlush = Environment.TickCount64;
        foreach (var info in new DirectoryInfo(root).EnumerateFileSystemInfos("*", options))
        {
            token.ThrowIfCancellationRequested();
            if (!filter.Matches(info.Name)) continue;
            var folder = System.IO.Path.GetDirectoryName(info.FullName) ?? "";
            var location = folder.Length > root.TrimEnd('\\').Length ? folder[(root.TrimEnd('\\').Length + 1)..] : "";
            batch.Add(From(info, colors, location));
            if (++found >= limit) break;
            if (batch.Count >= 200 || Environment.TickCount64 - lastFlush > 250)
            {
                onBatch(batch);
                batch = [];
                lastFlush = Environment.TickCount64;
            }
        }
        if (batch.Count > 0) onBatch(batch);
        return found;
    }

    private static List<FileEntry> ReadDrives()
    {
        var entries = new List<FileEntry>();
        foreach (var drive in DriveInfo.GetDrives())
        {
            string label = drive.DriveType switch
            {
                DriveType.Network => "네트워크 드라이브",
                DriveType.Removable => "이동식 디스크",
                DriveType.CDRom => "CD 드라이브",
                _ => "로컬 디스크",
            };
            string? detail = null;
            try
            {
                if (drive.IsReady)
                {
                    if (!string.IsNullOrWhiteSpace(drive.VolumeLabel)) label = drive.VolumeLabel;
                    detail = $"{SizeFormatter.Format(drive.AvailableFreeSpace)} 남음 / {SizeFormatter.Format(drive.TotalSize)}";
                }
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }

            entries.Add(new FileEntry
            {
                FullPath = drive.RootDirectory.FullName,
                Name = $"{label} ({drive.Name.TrimEnd('\\')})",
                IsDirectory = true,
                IsDrive = true,
                Detail = detail,
            });
        }
        return entries;
    }

    public static Brush BrushFor(string hex) => BrushCache.GetOrAdd(hex, h =>
    {
        try
        {
            var brush = new SolidColorBrush((Color)ColorConverter.ConvertFromString(h));
            brush.Freeze();
            return brush;
        }
        catch (FormatException)
        {
            return System.Windows.Media.Brushes.White;
        }
    });
}

/// <summary>Folders first, then the chosen column, names compared like Explorer.</summary>
public sealed class FileEntrySorter : System.Collections.IComparer
{
    public FileEntrySorter(string key, bool descending)
    {
        Key = key;
        Descending = descending;
    }

    public string Key { get; }
    public bool Descending { get; }

    public int Compare(object? x, object? y)
    {
        if (x is not FileEntry a || y is not FileEntry b) return 0;
        if (a.IsDirectory != b.IsDirectory) return a.IsDirectory ? -1 : 1;
        var result = Key switch
        {
            "Modified" => a.Modified.CompareTo(b.Modified),
            "Type" => string.Compare(a.TypeName, b.TypeName, StringComparison.CurrentCultureIgnoreCase),
            "Size" => a.Size.CompareTo(b.Size),
            "Location" => string.Compare(a.Location, b.Location, StringComparison.CurrentCultureIgnoreCase),
            _ => 0,
        };
        if (result == 0) result = ShellInfo.CompareNatural(a.Name, b.Name);
        return Descending ? -result : result;
    }
}

/// <summary>A tab inside a pane: a folder plus its own back/forward history.</summary>
public sealed class FolderTab : Observable
{
    private string _path;

    public FolderTab(string path)
    {
        _path = path;
        History = new NavigationHistory(path);
    }

    public NavigationHistory History { get; }

    public string Path
    {
        get => _path;
        set
        {
            if (Set(ref _path, value))
            {
                Raise(nameof(Title));
            }
        }
    }

    public string Title => PathCrumbs.DisplayName(Path);
}

/// <summary>Address-bar segment. The chevron before it lists the previous folder's subfolders.</summary>
public sealed record CrumbView(string Path, string Label, string? ParentPath)
{
    public Visibility ChevronVisibility => ParentPath == null ? Visibility.Collapsed : Visibility.Visible;
}

public sealed class SidebarItem : Observable
{
    private string _name = "";
    private string? _detail;
    private double _usage;

    public string Name { get => _name; set => Set(ref _name, value); }
    public required string Path { get; init; }
    public string Glyph { get; init; } = "";
    public string? Detail { get => _detail; set { Set(ref _detail, value); Raise(nameof(DetailVisibility)); } }
    /// <summary>0–1 used space for drives; negative hides the bar.</summary>
    public double Usage { get => _usage; set { Set(ref _usage, value); Raise(nameof(UsageVisibility)); } }

    public Visibility DetailVisibility => string.IsNullOrEmpty(Detail) ? Visibility.Collapsed : Visibility.Visible;
    public Visibility UsageVisibility => Usage >= 0 ? Visibility.Visible : Visibility.Collapsed;
}
