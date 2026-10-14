using System.Collections.ObjectModel;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Data;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using NeoDir.Core;

namespace NeoDir;

/// <summary>What a pane needs from the window around it.</summary>
public interface IPaneHost
{
    bool ShowHidden { get; }
    ColorRules ColorRules { get; }
    Window Owner { get; }
    void ShowToast(string message, bool isError = false);
    void OnPaneActivated(FolderPane pane);
    void OnPaneStatusChanged(FolderPane pane);
    void OnPaneSelectionChanged(FolderPane pane);
    void OpenInNextPane(FolderPane from, string path);
    bool IsFavorite(string path);
    void ToggleFavorite(string path);
}

public partial class FolderPane : UserControl
{
    private readonly ObservableCollection<FolderTab> _tabs = [];
    private readonly DispatcherTimer _refreshTimer;
    private IPaneHost _host = null!;
    private CancellationTokenSource? _loadCts;
    private FileSystemWatcher? _watcher;
    private ListCollectionView? _view;
    private NameFilter _filter = new(null);
    private FileEntrySorter _sorter = new("Name", false);
    private bool _isActive;

    // Subfolder search: while set, the list shows results under this folder instead of its contents.
    private string? _searchRoot;
    private GridViewColumn? _locationColumn;

    // Drag state: a press on an already-selected row keeps the multi-selection until we know it's not a drag.
    private Point _dragStart;
    private FileEntry? _pressedEntry;
    private bool _deferSelect;

    public FolderPane()
    {
        InitializeComponent();
        TabStrip.ItemsSource = _tabs;
        _refreshTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(350) };
        _refreshTimer.Tick += (_, _) =>
        {
            _refreshTimer.Stop();
            _ = ReloadAsync(keepView: true);
        };
        PreviewMouseDown += (_, _) => _host?.OnPaneActivated(this);
        IsKeyboardFocusWithinChanged += (_, e) =>
        {
            if ((bool)e.NewValue) _host?.OnPaneActivated(this);
        };
    }

    public int Index { get; private set; }

    public FolderTab? CurrentTab => TabStrip.SelectedItem as FolderTab;

    public string CurrentPath => CurrentTab?.Path ?? PathCrumbs.ThisPc;

    public string StatusText { get; private set; } = "";

    public IReadOnlyList<FileEntry> SelectedEntries => List.SelectedItems.Cast<FileEntry>().ToList();

    public bool IsActive
    {
        get => _isActive;
        set
        {
            _isActive = value;
            ActiveGlow.Visibility = value ? Visibility.Visible : Visibility.Hidden;
            Frame.BorderBrush = (Brush)FindResource(value ? "AccentSoftBrush" : "BorderBrush");
        }
    }

    public void Initialize(IPaneHost host, int index, PaneState? state, string fallbackPath)
    {
        _host = host;
        Index = index;
        var paths = state?.Tabs.Where(p => p == PathCrumbs.ThisPc || Directory.Exists(p)).ToList() ?? [];
        if (paths.Count == 0) paths.Add(fallbackPath);
        foreach (var path in paths) _tabs.Add(new FolderTab(path));
        TabStrip.SelectedIndex = Math.Clamp(state?.SelectedTab ?? 0, 0, _tabs.Count - 1);
    }

    public PaneState GetState() => new()
    {
        Tabs = _tabs.Select(t => t.Path).ToList(),
        SelectedTab = Math.Max(0, TabStrip.SelectedIndex),
    };

    public void FocusList()
    {
        if (List.SelectedIndex < 0 && List.Items.Count > 0) List.SelectedIndex = 0;
        if (List.ItemContainerGenerator.ContainerFromIndex(Math.Max(0, List.SelectedIndex)) is ListViewItem item)
            item.Focus();
        else
            List.Focus();
    }

    // ───────────── Navigation ─────────────

    public void Navigate(string path)
    {
        var target = Resolve(path);
        if (target == null) return;
        var tab = CurrentTab;
        if (tab == null)
        {
            OpenTab(target);
            return;
        }
        tab.History.Visit(target);
        tab.Path = target;
        ClearFilter();
        _ = ReloadAsync(keepView: false);
    }

    public void OpenTab(string path, bool activate = true)
    {
        var target = Resolve(path);
        if (target == null) return;
        var tab = new FolderTab(target);
        var at = TabStrip.SelectedIndex >= 0 ? TabStrip.SelectedIndex + 1 : _tabs.Count;
        _tabs.Insert(at, tab);
        if (activate) TabStrip.SelectedItem = tab;
        TabStrip.ScrollIntoView(tab);
    }

    public void CloseTab(FolderTab? tab)
    {
        if (tab == null) return;
        if (_tabs.Count == 1)
        {
            // The last tab stays; closing it just goes home like a fresh tab would.
            Navigate(DefaultFolder);
            return;
        }
        var index = _tabs.IndexOf(tab);
        var wasSelected = tab == CurrentTab;
        _tabs.Remove(tab);
        if (wasSelected) TabStrip.SelectedIndex = Math.Min(index, _tabs.Count - 1);
    }

    public void NextTab(int direction)
    {
        if (_tabs.Count < 2) return;
        TabStrip.SelectedIndex = (TabStrip.SelectedIndex + direction + _tabs.Count) % _tabs.Count;
    }

    public void GoBack()
    {
        if (CurrentTab?.History.Back() is { } path) ShowHistoryPath(path);
    }

    public void GoForward()
    {
        if (CurrentTab?.History.Forward() is { } path) ShowHistoryPath(path);
    }

    public void GoUp()
    {
        var from = CurrentPath;
        if (PathCrumbs.Parent(from) is not { } parent) return;
        _pendingSelect = from;
        Navigate(parent);
    }

    public void Refresh()
    {
        if (_searchRoot != null) StartSearch();
        else _ = ReloadAsync(keepView: true);
    }

    public void LoadState(PaneState state)
    {
        var paths = state.Tabs.Where(p => p == PathCrumbs.ThisPc || Directory.Exists(p)).ToList();
        if (paths.Count == 0) return;
        _tabs.Clear();
        foreach (var path in paths) _tabs.Add(new FolderTab(path));
        TabStrip.SelectedIndex = Math.Clamp(state.SelectedTab, 0, _tabs.Count - 1);
    }

    public void EditAddress()
    {
        Crumbs.Visibility = Visibility.Hidden;
        AddressBox.Visibility = Visibility.Visible;
        AddressBox.Text = CurrentPath == PathCrumbs.ThisPc ? "" : CurrentPath;
        AddressBox.Focus();
        AddressBox.SelectAll();
    }

    public void FocusFilter()
    {
        FilterBox.Focus();
        FilterBox.SelectAll();
    }

    public static string DefaultFolder => Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

    private string? _pendingSelect;

    private void ShowHistoryPath(string path)
    {
        CurrentTab!.Path = path;
        ClearFilter();
        _ = ReloadAsync(keepView: false);
    }

    /// <summary>Expands %VARS% and normalizes; files open with their app and return null.</summary>
    private string? Resolve(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return PathCrumbs.ThisPc;
        if (path == PathCrumbs.ThisPc) return path;
        var expanded = PathCrumbs.Normalize(Environment.ExpandEnvironmentVariables(path));
        if (Directory.Exists(expanded)) return expanded;
        if (File.Exists(expanded))
        {
            OpenFile(expanded);
            return null;
        }
        _host.ShowToast($"폴더를 찾을 수 없어요: {path}", isError: true);
        return null;
    }

    private async Task ReloadAsync(bool keepView)
    {
        var tab = CurrentTab;
        if (tab == null) return;
        var path = tab.Path;

        _loadCts?.Cancel();
        var cts = _loadCts = new CancellationTokenSource();
        _searchRoot = null;
        ShowLocationColumn(false);

        var selected = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (keepView) selected.UnionWith(SelectedEntries.Select(e => e.Name));
        if (_pendingSelect != null)
        {
            selected.Add(Path.GetFileName(_pendingSelect.TrimEnd('\\')) is { Length: > 0 } n ? n : _pendingSelect);
            _pendingSelect = null;
        }
        var offset = keepView ? FindScrollViewer()?.VerticalOffset ?? 0 : 0;

        UpdateChrome();
        List<FileEntry> entries;
        string? error = null;
        try
        {
            var showHidden = _host.ShowHidden;
            var colors = _host.ColorRules;
            entries = await Task.Run(() => FileEntry.ReadFolder(path, showHidden, colors, cts.Token), cts.Token);
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (UnauthorizedAccessException)
        {
            entries = [];
            error = "이 폴더를 열 권한이 없어요.";
        }
        catch (Exception ex)
        {
            entries = [];
            error = ex.Message;
        }
        if (cts.IsCancellationRequested || tab != CurrentTab || tab.Path != path) return;

        _view = new ListCollectionView(entries) { CustomSort = _sorter, Filter = o => _filter.Matches(((FileEntry)o).Name) };
        List.ItemsSource = _view;
        Watch(path);

        foreach (var entry in entries.Where(e => selected.Contains(e.Name) || selected.Contains(e.FullPath)))
            List.SelectedItems.Add(entry);
        if (List.SelectedItems.Count > 0 && !keepView) List.ScrollIntoView(List.SelectedItems[0]);
        if (keepView)
            await Dispatcher.InvokeAsync(() => FindScrollViewer()?.ScrollToVerticalOffset(offset), DispatcherPriority.Loaded);

        EmptyText.Text = error ?? (entries.Count == 0 ? "빈 폴더예요" : "");
        UpdateEmptyText();
        UpdateStatus();
    }

    private void UpdateChrome()
    {
        var tab = CurrentTab;
        BackButton.IsEnabled = tab?.History.CanGoBack == true;
        ForwardButton.IsEnabled = tab?.History.CanGoForward == true;
        UpdateUpButton();

        var crumbs = PathCrumbs.Split(CurrentPath);
        Crumbs.ItemsSource = crumbs.Select((c, i) => new CrumbView(c.Path, c.Label, i == 0 ? null : crumbs[i - 1].Path)).ToList();
        Dispatcher.InvokeAsync(() => CrumbScroller.ScrollToRightEnd(), DispatcherPriority.Loaded);

        var favorite = _host.IsFavorite(CurrentPath);
        FavoriteButton.Content = favorite ? "" : "";
        FavoriteButton.Foreground = favorite ? FileEntry.BrushFor("#FBBF24") : (Brush)FindResource("TextBrush");
        FavoriteButton.ToolTip = favorite ? "즐겨찾기에서 빼기 (Ctrl+D)" : "즐겨찾기에 추가 (Ctrl+D)";
        FavoriteButton.Visibility = CurrentPath == PathCrumbs.ThisPc ? Visibility.Hidden : Visibility.Visible;
    }

    private void UpdateUpButton() => UpButton.IsEnabled = PathCrumbs.Parent(CurrentPath) != null;

    public void RefreshFavoriteState() => UpdateChrome();

    private void Watch(string path)
    {
        _watcher?.Dispose();
        _watcher = null;
        if (path == PathCrumbs.ThisPc) return;
        try
        {
            var watcher = new FileSystemWatcher(path)
            {
                NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.Size | NotifyFilters.LastWrite,
                IncludeSubdirectories = false,
            };
            FileSystemEventHandler changed = (_, _) => Dispatcher.BeginInvoke(new Action(ScheduleRefresh));
            watcher.Created += changed;
            watcher.Deleted += changed;
            watcher.Changed += changed;
            watcher.Renamed += (_, _) => Dispatcher.BeginInvoke(new Action(ScheduleRefresh));
            watcher.EnableRaisingEvents = true;
            _watcher = watcher;
        }
        catch (Exception)
        {
            // Some network shares can't be watched; F5 still works.
        }
    }

    private void ScheduleRefresh()
    {
        if (_searchRoot != null) return;
        _refreshTimer.Stop();
        _refreshTimer.Start();
    }

    private ScrollViewer? FindScrollViewer()
    {
        DependencyObject? node = List;
        var queue = new Queue<DependencyObject>();
        queue.Enqueue(List);
        while (queue.Count > 0)
        {
            node = queue.Dequeue();
            if (node is ScrollViewer sv) return sv;
            for (var i = 0; i < VisualTreeHelper.GetChildrenCount(node); i++) queue.Enqueue(VisualTreeHelper.GetChild(node, i));
        }
        return null;
    }

    private void UpdateStatus()
    {
        var total = _view?.Count ?? 0;
        var selected = SelectedEntries;
        var text = _searchRoot != null
            ? $"'{_filter.Query}' 검색 결과 {total:N0}개 (하위 폴더 포함)"
            : $"{total:N0}개 항목";
        if (_searchRoot == null && !_filter.IsEmpty) text += $" (필터: {_filter.Query})";
        if (selected.Count > 0)
        {
            text += $"  ·  {selected.Count:N0}개 선택";
            var bytes = selected.Where(e => !e.IsDirectory).Sum(e => Math.Max(0, e.Size));
            if (bytes > 0) text += $" ({SizeFormatter.Format(bytes)})";
        }
        StatusText = text;
        _host.OnPaneStatusChanged(this);
    }

    private void UpdateEmptyText() =>
        EmptyText.Visibility = string.IsNullOrEmpty(EmptyText.Text) || (_view?.Count ?? 0) > 0 ? Visibility.Collapsed : Visibility.Visible;

    // ───────────── Opening ─────────────

    private void OpenEntry(FileEntry entry, bool newTab = false, bool otherPane = false)
    {
        if (entry.IsDirectory)
        {
            if (otherPane) _host.OpenInNextPane(this, entry.FullPath);
            else if (newTab) OpenTab(entry.FullPath, activate: false);
            else Navigate(entry.FullPath);
            return;
        }
        OpenFile(entry.FullPath);
    }

    private void OpenFile(string path)
    {
        try
        {
            ShellInfo.Open(path);
        }
        catch (Exception ex)
        {
            _host.ShowToast($"열 수 없어요: {ex.Message}", isError: true);
        }
    }

    // ───────────── File operations ─────────────

    private bool InRealFolder => CurrentPath != PathCrumbs.ThisPc;

    public void CopySelection(bool cut)
    {
        var paths = SelectedEntries.Where(e => !e.IsDrive).Select(e => e.FullPath).ToList();
        if (paths.Count == 0) return;
        FileOps.SetClipboard(paths, cut);
        _host.ShowToast(cut ? $"{paths.Count}개 잘라냄. 붙여넣을 곳에서 Ctrl+V" : $"{paths.Count}개 복사됨");
    }

    public async void Paste()
    {
        if (!InRealFolder) return;
        var (paths, cut) = FileOps.GetClipboard();
        if (paths.Count == 0) return;
        await Transfer(paths, CurrentPath, cut);
        if (cut) Clipboard.Clear();
    }

    private async Task Transfer(IReadOnlyList<string> sources, string destination, bool move)
    {
        try
        {
            var created = await FileOps.TransferAsync(sources, destination, move);
            if (destination.Equals(CurrentPath, StringComparison.OrdinalIgnoreCase))
            {
                foreach (var name in created) _pendingSelect = Path.Combine(destination, name);
                await ReloadAsync(keepView: true);
            }
        }
        catch (Exception ex)
        {
            _host.ShowToast(ex.Message, isError: true);
        }
    }

    public async void DeleteSelection(bool permanently)
    {
        var paths = SelectedEntries.Where(e => !e.IsDrive).Select(e => e.FullPath).ToList();
        if (paths.Count == 0) return;
        if (permanently)
        {
            var what = paths.Count == 1 ? $"'{Path.GetFileName(paths[0])}'" : $"{paths.Count}개 항목";
            if (!InputDialog.Confirm(_host.Owner, "영구 삭제", $"{what}을(를) 휴지통을 거치지 않고 지울까요? 되돌릴 수 없어요.", "영구 삭제"))
                return;
        }
        var index = List.SelectedIndex;
        try
        {
            await FileOps.DeleteAsync(paths, permanently);
        }
        catch (Exception ex)
        {
            _host.ShowToast(ex.Message, isError: true);
        }
        await ReloadAsync(keepView: true);
        if (List.Items.Count > 0)
        {
            List.SelectedIndex = Math.Clamp(index, 0, List.Items.Count - 1);
            FocusList();
        }
    }

    public void RenameSelection()
    {
        if (SelectedEntries is not [{ IsDrive: false } entry]) return;
        var folder = Path.GetDirectoryName(entry.FullPath)!;
        var name = InputDialog.Ask(_host.Owner, "이름 바꾸기", entry.Name, n =>
        {
            if (UniqueName.Invalid(n) is { } invalid) return invalid;
            if (!n.Equals(entry.Name, StringComparison.OrdinalIgnoreCase) && Path.Exists(Path.Combine(folder, n)))
                return "같은 이름이 이미 있어요.";
            return null;
        }, selectAll: entry.IsDirectory);
        if (name == null || name == entry.Name) return;
        try
        {
            FileOps.Rename(entry.FullPath, name);
            _pendingSelect = Path.Combine(folder, name);
            _ = ReloadAsync(keepView: true);
        }
        catch (Exception ex)
        {
            _host.ShowToast(ex.Message, isError: true);
        }
    }

    public void NewFolder() => CreateNew("새 폴더", isDirectory: true);

    public void NewTextFile() => CreateNew("새 텍스트 문서.txt", isDirectory: false);

    private void CreateNew(string baseName, bool isDirectory)
    {
        if (!InRealFolder) return;
        var folder = CurrentPath;
        var suggested = UniqueName.Next(baseName, isDirectory, n => Path.Exists(Path.Combine(folder, n)));
        var name = InputDialog.Ask(_host.Owner, isDirectory ? "새 폴더" : "새 텍스트 문서", suggested, n =>
            UniqueName.Invalid(n) ?? (Path.Exists(Path.Combine(folder, n)) ? "같은 이름이 이미 있어요." : null));
        if (name == null) return;
        try
        {
            var path = Path.Combine(folder, name);
            if (isDirectory) Directory.CreateDirectory(path);
            else File.WriteAllText(path, "");
            _pendingSelect = path;
            _ = ReloadAsync(keepView: true);
        }
        catch (Exception ex)
        {
            _host.ShowToast(ex.Message, isError: true);
        }
    }

    public void CopyPaths()
    {
        var paths = SelectedEntries.Select(e => e.FullPath).ToList();
        if (paths.Count == 0 && InRealFolder) paths.Add(CurrentPath);
        if (paths.Count == 0) return;
        FileOps.SetClipboardText(string.Join(Environment.NewLine, paths));
        _host.ShowToast(paths.Count == 1 ? $"경로 복사됨: {paths[0]}" : $"경로 {paths.Count}개 복사됨");
    }

    // ───────────── Tab strip events ─────────────

    private void OnTabSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (CurrentTab == null) return;
        ClearFilter();
        _ = ReloadAsync(keepView: false);
    }

    private void OnNewTabClick(object sender, RoutedEventArgs e) => OpenTab(CurrentPath);

    private void OnCloseTabClick(object sender, RoutedEventArgs e)
    {
        CloseTab((sender as FrameworkElement)?.Tag as FolderTab);
        e.Handled = true;
    }

    private void OnTabStripMouseDown(object sender, MouseButtonEventArgs e)
    {
        // Middle-click closes a tab, like a browser.
        if (e.ChangedButton != MouseButton.Middle) return;
        if ((e.OriginalSource as FrameworkElement)?.DataContext is FolderTab tab)
        {
            CloseTab(tab);
            e.Handled = true;
        }
    }

    private void OnTabStripBackgroundClick(object sender, MouseButtonEventArgs e)
    {
        if (e.ClickCount == 2 && e.OriginalSource is not TextBlock) OpenTab(CurrentPath);
    }

    private void OnTabStripWheel(object sender, MouseWheelEventArgs e)
    {
        if (FindChild<ScrollViewer>(TabStrip) is { } sv)
        {
            sv.ScrollToHorizontalOffset(sv.HorizontalOffset - e.Delta / 2.0);
            e.Handled = true;
        }
    }

    // ───────────── Address bar events ─────────────

    private void OnCrumbClick(object sender, RoutedEventArgs e)
    {
        if ((sender as FrameworkElement)?.Tag is string path) Navigate(path);
        e.Handled = true;
    }

    private void OnCrumbMouseDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton == MouseButton.Middle && (sender as FrameworkElement)?.Tag is string path)
        {
            OpenTab(path, activate: false);
            e.Handled = true;
        }
    }

    private void OnChevronClick(object sender, RoutedEventArgs e)
    {
        e.Handled = true;
        if (sender is not FrameworkElement { Tag: string parent } button) return;
        var menu = new ContextMenu { PlacementTarget = button, Placement = PlacementMode.Bottom };
        try
        {
            IEnumerable<(string Path, string Name)> folders = parent == PathCrumbs.ThisPc
                ? DriveInfo.GetDrives().Select(d => (d.RootDirectory.FullName, d.Name.TrimEnd('\\')))
                : new DirectoryInfo(parent)
                    .EnumerateDirectories("*", new EnumerationOptions { IgnoreInaccessible = true, AttributesToSkip = FileAttributes.Hidden | FileAttributes.System })
                    .Select(d => (d.FullName, d.Name))
                    .OrderBy(d => d.Name, Comparer<string>.Create(ShellInfo.CompareNatural))
                    .Take(400);
            foreach (var (path, name) in folders)
            {
                var item = new MenuItem { Header = name, Tag = "" };
                item.Click += (_, _) => Navigate(path);
                if (CurrentPath.StartsWith(path, StringComparison.OrdinalIgnoreCase)) item.FontWeight = FontWeights.SemiBold;
                menu.Items.Add(item);
            }
        }
        catch (Exception ex)
        {
            menu.Items.Add(new MenuItem { Header = ex.Message, IsEnabled = false });
        }
        if (menu.Items.Count == 0) menu.Items.Add(new MenuItem { Header = "하위 폴더 없음", IsEnabled = false });
        menu.IsOpen = true;
    }

    private void OnAddressBarClick(object sender, MouseButtonEventArgs e)
    {
        if (AddressBox.IsVisible) return;
        if (e.OriginalSource is DependencyObject d && FindParent<Button>(d) != null) return;
        EditAddress();
    }

    private void OnAddressKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter)
        {
            var text = AddressBox.Text;
            EndAddressEdit();
            Navigate(text);
            FocusList();
            e.Handled = true;
        }
        else if (e.Key == Key.Escape)
        {
            EndAddressEdit();
            FocusList();
            e.Handled = true;
        }
    }

    private void OnAddressLostFocus(object sender, KeyboardFocusChangedEventArgs e) => EndAddressEdit();

    private void EndAddressEdit()
    {
        AddressBox.Visibility = Visibility.Collapsed;
        Crumbs.Visibility = Visibility.Visible;
    }

    // ───────────── Toolbar events ─────────────

    private void OnBackClick(object sender, RoutedEventArgs e) => GoBack();
    private void OnForwardClick(object sender, RoutedEventArgs e) => GoForward();
    private void OnUpClick(object sender, RoutedEventArgs e) => GoUp();
    private void OnRefreshClick(object sender, RoutedEventArgs e) => Refresh();

    private void OnFavoriteClick(object sender, RoutedEventArgs e)
    {
        if (!InRealFolder) return;
        _host.ToggleFavorite(CurrentPath);
    }

    // ───────────── Filter ─────────────

    private void OnFilterChanged(object sender, TextChangedEventArgs e)
    {
        FilterHint.Visibility = FilterBox.Text.Length == 0 ? Visibility.Visible : Visibility.Collapsed;
        _filter = new NameFilter(FilterBox.Text);
        if (_searchRoot != null)
        {
            // Editing the query goes back to filtering this folder live; Enter searches again.
            _searchRoot = null;
            _ = ReloadAsync(keepView: false);
            return;
        }
        _view?.Refresh();
        if (_view != null && !_filter.IsEmpty)
        {
            EmptyText.Text = "조건에 맞는 항목이 없어요";
        }
        UpdateEmptyText();
        UpdateStatus();
    }

    private void OnFilterKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape)
        {
            ClearFilter();
            FocusList();
            e.Handled = true;
        }
        else if (e.Key == Key.Enter && !_filter.IsEmpty && InRealFolder)
        {
            StartSearch();
            e.Handled = true;
        }
        else if (e.Key is Key.Down or Key.Enter)
        {
            FocusList();
            e.Handled = true;
        }
    }

    /// <summary>Finds names matching the filter in every subfolder; results stream in.</summary>
    public async void StartSearch()
    {
        if (_filter.IsEmpty || !InRealFolder) return;
        _loadCts?.Cancel();
        var cts = _loadCts = new CancellationTokenSource();
        var root = CurrentPath;
        var filter = _filter;
        _searchRoot = root;
        _watcher?.Dispose();
        _watcher = null;

        var results = new ObservableCollection<FileEntry>();
        _view = new ListCollectionView(results) { CustomSort = _sorter };
        List.ItemsSource = _view;
        ShowLocationColumn(true);
        EmptyText.Text = "하위 폴더에서 찾는 중…";
        EmptyText.Visibility = Visibility.Visible;
        UpdateStatus();

        const int limit = 5000;
        var showHidden = _host.ShowHidden;
        var colors = _host.ColorRules;
        int found;
        try
        {
            found = await Task.Run(() => FileEntry.Search(root, filter, showHidden, colors, batch =>
                Dispatcher.InvokeAsync(() =>
                {
                    if (cts.IsCancellationRequested) return;
                    foreach (var entry in batch) results.Add(entry);
                    EmptyText.Visibility = Visibility.Collapsed;
                    UpdateStatus();
                }), limit, cts.Token), cts.Token);
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception ex)
        {
            _host.ShowToast(ex.Message, isError: true);
            return;
        }
        if (cts.IsCancellationRequested) return;
        await Dispatcher.InvokeAsync(() => { }, DispatcherPriority.Background);
        EmptyText.Text = "찾는 항목이 없어요";
        UpdateEmptyText();
        UpdateStatus();
        if (found >= limit) _host.ShowToast($"결과가 많아서 {limit:N0}개에서 멈췄어요. 검색어를 더 구체적으로 적어보세요.");
    }

    private void ShowLocationColumn(bool show)
    {
        if (List.View is not GridView grid) return;
        _locationColumn ??= new GridViewColumn
        {
            Header = new GridViewColumnHeader { Tag = "Location", Content = "위치" },
            DisplayMemberBinding = new Binding(nameof(FileEntry.Location)),
            Width = 220,
        };
        var shown = grid.Columns.Contains(_locationColumn);
        if (show && !shown) grid.Columns.Insert(1, _locationColumn);
        else if (!show && shown) grid.Columns.Remove(_locationColumn);
    }

    private void ClearFilter()
    {
        if (FilterBox.Text.Length > 0) FilterBox.Text = "";
    }

    // ───────────── List events ─────────────

    private void OnHeaderClick(object sender, RoutedEventArgs e)
    {
        if (e.OriginalSource is not GridViewColumnHeader { Tag: string key } header) return;
        var descending = _sorter.Key == key && !_sorter.Descending;
        _sorter = new FileEntrySorter(key, descending);
        if (_view != null) _view.CustomSort = _sorter;

        if (List.View is GridView grid)
        {
            foreach (var column in grid.Columns)
            {
                if (column.Header is GridViewColumnHeader h && h.Content is string text)
                    h.Content = text.TrimEnd(' ', '▲', '▼');
            }
        }
        header.Content = $"{header.Content} {(descending ? "▼" : "▲")}";
    }

    private void OnListSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        UpdateStatus();
        _host.OnPaneSelectionChanged(this);
    }

    private void OnListKeyDown(object sender, KeyEventArgs e)
    {
        var ctrl = Keyboard.Modifiers.HasFlag(ModifierKeys.Control);
        var shift = Keyboard.Modifiers.HasFlag(ModifierKeys.Shift);
        var key = e.Key == Key.System ? e.SystemKey : e.Key;
        var handled = true;
        switch (key)
        {
            case Key.Enter when List.SelectedItem is FileEntry entry:
                OpenEntry(entry, newTab: ctrl, otherPane: shift);
                break;
            case Key.Back:
                GoUp();
                break;
            case Key.Delete:
                DeleteSelection(permanently: shift);
                break;
            case Key.F2:
                RenameSelection();
                break;
            case Key.C when ctrl && shift:
                CopyPaths();
                break;
            case Key.C when ctrl:
                CopySelection(cut: false);
                break;
            case Key.X when ctrl:
                CopySelection(cut: true);
                break;
            case Key.V when ctrl:
                Paste();
                break;
            case Key.N when ctrl && shift:
                NewFolder();
                break;
            default:
                handled = false;
                break;
        }
        e.Handled = handled;
    }

    private void OnListMouseDown(object sender, MouseButtonEventArgs e)
    {
        _dragStart = e.GetPosition(List);
        var item = FindParent<ListViewItem>((DependencyObject)e.OriginalSource);
        _pressedEntry = item?.DataContext as FileEntry;
        _deferSelect = false;

        if (FindParent<GridViewColumnHeader>((DependencyObject)e.OriginalSource) != null || FindParent<ScrollBar>((DependencyObject)e.OriginalSource) != null)
        {
            _pressedEntry = null;
            return;
        }

        if (e.ClickCount == 2 && _pressedEntry != null)
        {
            OpenEntry(_pressedEntry);
            _pressedEntry = null;
            e.Handled = true;
            return;
        }

        if (_pressedEntry == null)
        {
            // Clicking empty space clears the selection, like Explorer.
            if (Keyboard.Modifiers == ModifierKeys.None) List.SelectedItems.Clear();
            List.Focus();
            return;
        }

        if (item!.IsSelected && Keyboard.Modifiers == ModifierKeys.None && List.SelectedItems.Count > 1)
        {
            // Keep the group selected so it can be dragged; select just this one on release.
            _deferSelect = true;
            item.Focus();
            e.Handled = true;
        }
    }

    private void OnListMouseUp(object sender, MouseButtonEventArgs e)
    {
        if (_deferSelect && _pressedEntry != null)
        {
            List.SelectedItems.Clear();
            List.SelectedItem = _pressedEntry;
        }
        _deferSelect = false;
        _pressedEntry = null;
    }

    private void OnListMouseMove(object sender, MouseEventArgs e)
    {
        if (e.LeftButton != MouseButtonState.Pressed || _pressedEntry == null) return;
        var delta = e.GetPosition(List) - _dragStart;
        if (Math.Abs(delta.X) < SystemParameters.MinimumHorizontalDragDistance &&
            Math.Abs(delta.Y) < SystemParameters.MinimumVerticalDragDistance) return;

        var paths = SelectedEntries.Where(x => !x.IsDrive).Select(x => x.FullPath).ToArray();
        _deferSelect = false;
        _pressedEntry = null;
        if (paths.Length == 0) return;
        var data = new DataObject(DataFormats.FileDrop, paths);
        DragDrop.DoDragDrop(List, data, DragDropEffects.Copy | DragDropEffects.Move | DragDropEffects.Link);
    }

    private void OnListMiddleClick(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton != MouseButton.Middle) return;
        if (FindParent<ListViewItem>((DependencyObject)e.OriginalSource)?.DataContext is FileEntry { IsDirectory: true } entry)
        {
            OpenTab(entry.FullPath, activate: false);
            e.Handled = true;
        }
    }

    private (string? Target, DragDropEffects Effect) DropTarget(DragEventArgs e)
    {
        if (!e.Data.GetDataPresent(DataFormats.FileDrop) || e.Data.GetData(DataFormats.FileDrop) is not string[] sources || sources.Length == 0)
            return (null, DragDropEffects.None);

        var over = FindParent<ListViewItem>((DependencyObject)e.OriginalSource)?.DataContext as FileEntry;
        string? target = over is { IsDirectory: true } && !sources.Contains(over.FullPath, StringComparer.OrdinalIgnoreCase)
            ? over.FullPath
            : InRealFolder ? CurrentPath : null;
        if (target == null) return (null, DragDropEffects.None);

        DragDropEffects effect;
        if (e.KeyStates.HasFlag(DragDropKeyStates.ControlKey)) effect = DragDropEffects.Copy;
        else if (e.KeyStates.HasFlag(DragDropKeyStates.ShiftKey)) effect = DragDropEffects.Move;
        else
        {
            // Explorer's rule: same drive moves, another drive copies.
            var sameDrive = string.Equals(Path.GetPathRoot(sources[0]), Path.GetPathRoot(target), StringComparison.OrdinalIgnoreCase);
            effect = sameDrive ? DragDropEffects.Move : DragDropEffects.Copy;
        }
        if (!e.AllowedEffects.HasFlag(effect))
            effect = e.AllowedEffects.HasFlag(DragDropEffects.Copy) ? DragDropEffects.Copy : DragDropEffects.None;

        var alreadyThere = sources.All(s => string.Equals(Path.GetDirectoryName(s.TrimEnd('\\')), target.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase));
        if (alreadyThere && effect == DragDropEffects.Move) effect = DragDropEffects.None;
        return (target, effect);
    }

    private void OnListDragOver(object sender, DragEventArgs e)
    {
        e.Effects = DropTarget(e).Effect;
        e.Handled = true;
    }

    private async void OnListDrop(object sender, DragEventArgs e)
    {
        var (target, effect) = DropTarget(e);
        e.Handled = true;
        if (target == null || effect == DragDropEffects.None) return;
        var sources = (string[])e.Data.GetData(DataFormats.FileDrop);
        _host.OnPaneActivated(this);
        await Transfer(sources, target, move: effect == DragDropEffects.Move);
    }

    private void OnListContextMenuOpening(object sender, ContextMenuEventArgs e)
    {
        var menu = List.ContextMenu!;
        menu.Items.Clear();
        var selected = SelectedEntries;
        var onItem = FindParent<ListViewItem>((DependencyObject)e.OriginalSource) != null && selected.Count > 0;

        // Shift+right-click goes straight to the full Windows menu, like Explorer's "more options".
        if (Keyboard.Modifiers.HasFlag(ModifierKeys.Shift) && (onItem || InRealFolder))
        {
            e.Handled = true;
            ShowWindowsMenu(onItem, extended: true);
            return;
        }

        MenuItem Add(string header, string glyph, Action action, string? gesture = null, bool enabled = true)
        {
            var item = new MenuItem { Header = header, Tag = glyph, InputGestureText = gesture ?? "", IsEnabled = enabled };
            item.Click += (_, _) => action();
            menu.Items.Add(item);
            return item;
        }

        if (onItem)
        {
            var first = selected[0];
            Add("열기", "", () => OpenEntry(first), "Enter");
            if (first.IsDirectory)
            {
                Add("새 탭에서 열기", "", () => OpenEntry(first, newTab: true), "Ctrl+Enter");
                Add("옆 패널에서 열기", "", () => OpenEntry(first, otherPane: true), "Shift+Enter");
            }
            menu.Items.Add(new Separator());
            Add("잘라내기", "", () => CopySelection(cut: true), "Ctrl+X", !first.IsDrive);
            Add("복사", "", () => CopySelection(cut: false), "Ctrl+C", !first.IsDrive);
            Add("경로 복사", "", CopyPaths, "Ctrl+Shift+C");
            menu.Items.Add(new Separator());
            Add("이름 바꾸기", "", RenameSelection, "F2", selected.Count == 1 && !first.IsDrive);
            Add("삭제", "", () => DeleteSelection(false), "Del", !first.IsDrive);
            menu.Items.Add(new Separator());
            if (_searchRoot != null)
            {
                Add("파일 위치 열기", "\uE8DA", () =>
                {
                    _pendingSelect = first.FullPath;
                    Navigate(Path.GetDirectoryName(first.FullPath)!);
                });
            }
            Add("탐색기에서 보기", "", () => ShellInfo.RevealInExplorer(first.FullPath));
            Add("속성", "", () => ShellInfo.ShowProperties(first.FullPath));
            menu.Items.Add(new Separator());
            Add("Windows 메뉴 더 보기", "\uE712", () => ShowWindowsMenu(true, false), "Shift+우클릭");
        }
        else
        {
            var real = InRealFolder;
            Add("붙여넣기", "", Paste, "Ctrl+V", real && FileOps.GetClipboard().Paths.Count > 0);
            menu.Items.Add(new Separator());
            Add("새 폴더", "", NewFolder, "Ctrl+Shift+N", real);
            Add("새 텍스트 문서", "", NewTextFile, null, real);
            menu.Items.Add(new Separator());
            Add("경로 복사", "", CopyPaths, "Ctrl+Shift+C", real);
            Add("터미널 열기", "", () => ShellInfo.OpenTerminal(CurrentPath), null, real);
            Add("탐색기에서 열기", "", () => ShellInfo.RevealInExplorer(CurrentPath), null, real);
            Add("새로 고침", "", Refresh, "F5");
            if (real) Add("속성", "", () => ShellInfo.ShowProperties(CurrentPath));
            if (real)
            {
                menu.Items.Add(new Separator());
                Add("Windows 메뉴 더 보기 (새로 만들기 등)", "\uE712", () => ShowWindowsMenu(false, false), "Shift+우클릭");
            }
        }
    }

    private void ShowWindowsMenu(bool forSelection, bool extended)
    {
        try
        {
            if (forSelection)
            {
                var paths = SelectedEntries.Select(x => x.FullPath).ToList();
                if (paths.Count == 0) return;
                // The shell menu works on one folder's items; search results can span many.
                var folder = Path.GetDirectoryName(paths[0].TrimEnd('\\'));
                if (paths.Any(p => !string.Equals(Path.GetDirectoryName(p.TrimEnd('\\')), folder, StringComparison.OrdinalIgnoreCase)))
                    paths = paths.Take(1).ToList();
                ShellContextMenu.ShowForItems(_host.Owner, paths, extended, verb =>
                {
                    if (!verb.Equals("rename", StringComparison.OrdinalIgnoreCase)) return false;
                    RenameSelection();
                    return true;
                });
            }
            else if (InRealFolder)
            {
                ShellContextMenu.ShowForFolder(_host.Owner, CurrentPath, extended);
            }
        }
        catch (Exception ex)
        {
            _host.ShowToast("Windows 메뉴를 열지 못했어요: " + ex.Message, isError: true);
        }
    }

    // ───────────── Helpers ─────────────

    private static T? FindParent<T>(DependencyObject? node) where T : DependencyObject
    {
        while (node != null)
        {
            if (node is T match) return match;
            node = node is Visual or System.Windows.Media.Media3D.Visual3D ? VisualTreeHelper.GetParent(node) : LogicalTreeHelper.GetParent(node);
        }
        return null;
    }

    private static T? FindChild<T>(DependencyObject node) where T : DependencyObject
    {
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(node); i++)
        {
            var child = VisualTreeHelper.GetChild(node, i);
            if (child is T match) return match;
            if (FindChild<T>(child) is { } deeper) return deeper;
        }
        return null;
    }
}
