using System.Collections.ObjectModel;
using System.ComponentModel;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media.Animation;
using System.Windows.Threading;
using NeoDir.Core;

namespace NeoDir;

public partial class MainWindow : Window, IPaneHost
{
    private readonly SettingsStore _store;
    private readonly AppSettings _settings;
    private readonly FolderPane[] _panes = new FolderPane[4];
    private readonly ObservableCollection<SidebarItem> _favorites = [];
    private readonly ObservableCollection<SidebarItem> _drives = [];
    private readonly DispatcherTimer _toastTimer = new() { Interval = TimeSpan.FromSeconds(2.6) };
    private FolderPane _active;
    private LayoutKind _layout;
    private DateTime _drivesRefreshed;

    public MainWindow()
    {
        InitializeComponent();
        _store = SettingsStore.Locate(AppContext.BaseDirectory,
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData));
        _settings = _store.Load();
        ColorRules = new ColorRules(_settings.ColorRules);
        ShowHidden = _settings.ShowHidden;
        HiddenToggle.IsChecked = ShowHidden;

        var template = (DataTemplate)FindResource("SidebarItemTemplate");
        FavoritesList.ItemTemplate = template;
        QuickList.ItemTemplate = template;
        DriveList.ItemTemplate = template;
        FavoritesList.ItemsSource = _favorites;
        DriveList.ItemsSource = _drives;
        QuickList.ItemsSource = QuickLinks();
        foreach (var favorite in _settings.Favorites)
            _favorites.Add(new SidebarItem { Name = favorite.Name, Path = favorite.Path, Glyph = "", Usage = -1 });
        UpdateFavoritesHint();

        string[] defaults =
        [
            Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
            Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
            KnownFolders.Downloads,
            PathCrumbs.ThisPc,
        ];
        for (var i = 0; i < _panes.Length; i++)
        {
            var pane = new FolderPane();
            _panes[i] = pane;
            pane.Initialize(this, i, i < _settings.Panes.Count ? _settings.Panes[i] : null,
                Directory.Exists(defaults[i]) || defaults[i] == PathCrumbs.ThisPc ? defaults[i] : FolderPane.DefaultFolder);
        }
        _active = _panes[Math.Clamp(_settings.ActivePane, 0, 3)];

        ApplySavedBounds();
        SetSidebar(_settings.SidebarVisible, _settings.SidebarWidth);
        ApplyLayout(_settings.Layout);

        _toastTimer.Tick += (_, _) => HideToast();
    }

    public string? StartupPath { get; set; }

    public bool ShowHidden { get; private set; }

    public ColorRules ColorRules { get; }

    Window IPaneHost.Owner => this;

    // ───────────── Layout ─────────────

    private int VisiblePaneCount => _layout switch
    {
        LayoutKind.Single => 1,
        LayoutKind.TwoColumns or LayoutKind.TwoRows => 2,
        LayoutKind.Three => 3,
        _ => 4,
    };

    private void ApplyLayout(LayoutKind layout)
    {
        _layout = layout;
        foreach (var pane in _panes)
            if (pane.Parent is Panel parent) parent.Children.Remove(pane);
        PaneHost.Children.Clear();

        UIElement root = layout switch
        {
            LayoutKind.Single => _panes[0],
            LayoutKind.TwoColumns => Split(_panes[0], _panes[1], sideBySide: true),
            LayoutKind.TwoRows => Split(_panes[0], _panes[1], sideBySide: false),
            LayoutKind.Three => Split(_panes[0], Split(_panes[1], _panes[2], sideBySide: false), sideBySide: true),
            _ => Split(Split(_panes[0], _panes[1], sideBySide: true), Split(_panes[2], _panes[3], sideBySide: true), sideBySide: false),
        };
        PaneHost.Children.Add(root);

        var radio = layout switch
        {
            LayoutKind.Single => Layout1,
            LayoutKind.TwoColumns => Layout2,
            LayoutKind.TwoRows => Layout3,
            LayoutKind.Three => Layout4,
            _ => Layout5,
        };
        radio.IsChecked = true;

        if (_active.Index >= VisiblePaneCount) SetActive(_panes[0]);
        else SetActive(_active);
    }

    private Grid Split(UIElement first, UIElement second, bool sideBySide)
    {
        var grid = new Grid();
        var splitter = new GridSplitter { Style = (Style)FindResource("PaneSplitter") };
        if (sideBySide)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star), MinWidth = 160 });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(4) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star), MinWidth = 160 });
            Grid.SetColumn(splitter, 1);
            Grid.SetColumn(second, 2);
        }
        else
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star), MinHeight = 120 });
            grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(4) });
            grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star), MinHeight = 120 });
            Grid.SetRow(splitter, 1);
            Grid.SetRow(second, 2);
        }
        Grid.SetColumn(first, 0);
        Grid.SetRow(first, 0);
        if (sideBySide) Grid.SetRow(second, 0);
        else Grid.SetColumn(second, 0);
        grid.Children.Add(first);
        grid.Children.Add(splitter);
        grid.Children.Add(second);
        return grid;
    }

    private void OnLayoutChecked(object sender, RoutedEventArgs e)
    {
        if (sender is RadioButton { Tag: string tag } && Enum.TryParse<LayoutKind>(tag, out var layout) && layout != _layout)
            ApplyLayout(layout);
    }

    private void SetActive(FolderPane pane)
    {
        _active = pane;
        foreach (var p in _panes) p.IsActive = p == pane && VisiblePaneCount > 1;
        StatusText.Text = pane.StatusText;
        Title = $"NeoDir — {PathCrumbs.DisplayName(pane.CurrentPath)}";
    }

    private void CyclePane(int direction)
    {
        var count = VisiblePaneCount;
        var next = _panes[(_active.Index + direction + count) % count];
        SetActive(next);
        next.FocusList();
    }

    // ───────────── IPaneHost ─────────────

    public void OnPaneActivated(FolderPane pane)
    {
        if (pane != _active) SetActive(pane);
    }

    public void OnPaneStatusChanged(FolderPane pane)
    {
        if (pane != _active) return;
        StatusText.Text = pane.StatusText;
        Title = $"NeoDir — {PathCrumbs.DisplayName(pane.CurrentPath)}";
    }

    public void OpenInNextPane(FolderPane from, string path)
    {
        if (VisiblePaneCount == 1) ApplyLayout(LayoutKind.TwoColumns);
        var target = _panes[(from.Index + 1) % VisiblePaneCount];
        target.Navigate(path);
        SetActive(target);
    }

    public bool IsFavorite(string path) =>
        _favorites.Any(f => string.Equals(f.Path, path, StringComparison.OrdinalIgnoreCase));

    public void ToggleFavorite(string path)
    {
        var existing = _favorites.FirstOrDefault(f => string.Equals(f.Path, path, StringComparison.OrdinalIgnoreCase));
        if (existing != null)
        {
            _favorites.Remove(existing);
            ShowToast($"즐겨찾기에서 뺐어요: {existing.Name}");
        }
        else
        {
            AddFavorite(path);
        }
        FavoritesChanged();
    }

    private void AddFavorite(string path)
    {
        if (IsFavorite(path) || !Directory.Exists(path)) return;
        var name = PathCrumbs.DisplayName(path);
        _favorites.Add(new SidebarItem { Name = name, Path = path, Glyph = "", Usage = -1 });
        ShowToast($"즐겨찾기에 추가했어요: {name}");
    }

    private void FavoritesChanged()
    {
        UpdateFavoritesHint();
        foreach (var pane in _panes) pane.RefreshFavoriteState();
        SaveSettings();
    }

    private void UpdateFavoritesHint() =>
        FavoritesHint.Visibility = _favorites.Count == 0 ? Visibility.Visible : Visibility.Collapsed;

    public void ShowToast(string message, bool isError = false)
    {
        ToastText.Text = message;
        Toast.BorderBrush = (System.Windows.Media.Brush)FindResource(isError ? "DangerBrush" : "AccentSoftBrush");
        Toast.Visibility = Visibility.Visible;
        Toast.BeginAnimation(OpacityProperty, new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(140)));
        _toastTimer.Stop();
        _toastTimer.Interval = TimeSpan.FromSeconds(isError ? 4.5 : 2.6);
        _toastTimer.Start();
    }

    private void HideToast()
    {
        _toastTimer.Stop();
        var fade = new DoubleAnimation(1, 0, TimeSpan.FromMilliseconds(220));
        fade.Completed += (_, _) =>
        {
            if (!_toastTimer.IsEnabled) Toast.Visibility = Visibility.Collapsed;
        };
        Toast.BeginAnimation(OpacityProperty, fade);
    }

    // ───────────── Sidebar ─────────────

    private static List<SidebarItem> QuickLinks()
    {
        var links = new List<SidebarItem>
        {
            new() { Name = "내 PC", Path = PathCrumbs.ThisPc, Glyph = "", Usage = -1 },
            new() { Name = "홈", Path = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), Glyph = "", Usage = -1 },
            new() { Name = "바탕 화면", Path = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), Glyph = "", Usage = -1 },
            new() { Name = "다운로드", Path = KnownFolders.Downloads, Glyph = "", Usage = -1 },
            new() { Name = "문서", Path = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), Glyph = "", Usage = -1 },
            new() { Name = "사진", Path = Environment.GetFolderPath(Environment.SpecialFolder.MyPictures), Glyph = "", Usage = -1 },
        };
        return links.Where(l => l.Path == PathCrumbs.ThisPc || Directory.Exists(l.Path)).ToList();
    }

    private async void RefreshDrives()
    {
        if (DateTime.Now - _drivesRefreshed < TimeSpan.FromSeconds(10)) return;
        _drivesRefreshed = DateTime.Now;
        var drives = await Task.Run(() =>
        {
            var list = new List<SidebarItem>();
            foreach (var drive in DriveInfo.GetDrives())
            {
                var item = new SidebarItem
                {
                    Name = drive.Name.TrimEnd('\\'),
                    Path = drive.RootDirectory.FullName,
                    Glyph = drive.DriveType == DriveType.Network ? "" : drive.DriveType == DriveType.Removable ? "" : "",
                    Usage = -1,
                };
                try
                {
                    if (drive.IsReady)
                    {
                        var label = string.IsNullOrWhiteSpace(drive.VolumeLabel) ? "로컬 디스크" : drive.VolumeLabel;
                        item.Name = $"{label} ({drive.Name.TrimEnd('\\')})";
                        item.Usage = drive.TotalSize > 0 ? 1 - (double)drive.AvailableFreeSpace / drive.TotalSize : -1;
                        item.Detail = $"{SizeFormatter.Format(drive.AvailableFreeSpace)} 남음 / {SizeFormatter.Format(drive.TotalSize)}";
                    }
                }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
                list.Add(item);
            }
            return list;
        });
        _drives.Clear();
        foreach (var drive in drives) _drives.Add(drive);
    }

    private void OnSidebarItemClick(object sender, RoutedEventArgs e)
    {
        if ((sender as FrameworkElement)?.Tag is SidebarItem item)
        {
            if (Keyboard.Modifiers.HasFlag(ModifierKeys.Control)) _active.OpenTab(item.Path);
            else _active.Navigate(item.Path);
            _active.FocusList();
        }
    }

    private void OnSidebarItemMouseUp(object sender, MouseButtonEventArgs e)
    {
        if ((sender as FrameworkElement)?.Tag is not SidebarItem item) return;
        if (e.ChangedButton == MouseButton.Middle)
        {
            _active.OpenTab(item.Path, activate: false);
            e.Handled = true;
        }
        else if (e.ChangedButton == MouseButton.Right && _favorites.Contains(item))
        {
            ShowFavoriteMenu(item, (FrameworkElement)sender);
            e.Handled = true;
        }
    }

    private void ShowFavoriteMenu(SidebarItem item, FrameworkElement anchor)
    {
        var menu = new ContextMenu { PlacementTarget = anchor, Placement = PlacementMode.MousePoint };
        void Add(string header, string glyph, Action action)
        {
            var mi = new MenuItem { Header = header, Tag = glyph };
            mi.Click += (_, _) => action();
            menu.Items.Add(mi);
        }
        Add("새 탭에서 열기", "", () => _active.OpenTab(item.Path));
        Add("옆 패널에서 열기", "", () => OpenInNextPane(_active, item.Path));
        menu.Items.Add(new Separator());
        Add("이름 바꾸기", "", () =>
        {
            var name = InputDialog.Ask(this, "즐겨찾기 이름", item.Name, n => string.IsNullOrWhiteSpace(n) ? "이름을 입력하세요." : null, selectAll: true);
            if (name == null) return;
            item.Name = name;
            SaveSettings();
        });
        Add("위로", "", () => MoveFavorite(item, -1));
        Add("아래로", "", () => MoveFavorite(item, 1));
        Add("즐겨찾기에서 빼기", "", () =>
        {
            _favorites.Remove(item);
            FavoritesChanged();
        });
        menu.IsOpen = true;
    }

    private void MoveFavorite(SidebarItem item, int direction)
    {
        var index = _favorites.IndexOf(item);
        var target = index + direction;
        if (target < 0 || target >= _favorites.Count) return;
        _favorites.Move(index, target);
        SaveSettings();
    }

    private void OnAddFavoriteClick(object sender, RoutedEventArgs e)
    {
        if (_active.CurrentPath == PathCrumbs.ThisPc) return;
        AddFavorite(_active.CurrentPath);
        FavoritesChanged();
    }

    private void OnFavoritesDragOver(object sender, DragEventArgs e)
    {
        e.Effects = e.Data.GetData(DataFormats.FileDrop) is string[] paths && paths.Any(Directory.Exists)
            ? DragDropEffects.Link
            : DragDropEffects.None;
        e.Handled = true;
    }

    private void OnFavoritesDrop(object sender, DragEventArgs e)
    {
        if (e.Data.GetData(DataFormats.FileDrop) is not string[] paths) return;
        foreach (var path in paths.Where(Directory.Exists)) AddFavorite(path);
        FavoritesChanged();
        e.Handled = true;
    }

    private void SetSidebar(bool visible, double width)
    {
        SidebarToggle.IsChecked = visible;
        Sidebar.Visibility = visible ? Visibility.Visible : Visibility.Collapsed;
        SidebarSplitter.Visibility = Sidebar.Visibility;
        SidebarColumn.Width = visible ? new GridLength(Math.Clamp(width, 150, 500)) : new GridLength(0);
        SidebarSplitterColumn.Width = visible ? new GridLength(4) : new GridLength(0);
    }

    private void OnSidebarToggle(object sender, RoutedEventArgs e) => ToggleSidebar();

    private void ToggleSidebar()
    {
        var visible = Sidebar.Visibility != Visibility.Visible;
        if (!visible) _settings.SidebarWidth = SidebarColumn.ActualWidth;
        SetSidebar(visible, _settings.SidebarWidth);
    }

    private void OnHiddenToggle(object sender, RoutedEventArgs e) => ToggleHidden();

    private void ToggleHidden()
    {
        ShowHidden = !ShowHidden;
        HiddenToggle.IsChecked = ShowHidden;
        foreach (var pane in _panes) pane.Refresh();
        ShowToast(ShowHidden ? "숨김 파일을 보여줘요" : "숨김 파일을 감췄어요");
    }

    private void OnHelpClick(object sender, RoutedEventArgs e) => ShowHelp();

    private void ShowHelp()
    {
        const string help =
            "Ctrl+1~5  레이아웃 바꾸기\n" +
            "F6 / Shift+F6  다음·이전 패널\n" +
            "Ctrl+T / Ctrl+W  새 탭 / 탭 닫기 (휠 클릭으로도 닫힘)\n" +
            "Ctrl+Tab  다음 탭\n" +
            "Ctrl+L  주소 입력 (%USERPROFILE% 같은 변수 가능)\n" +
            "Ctrl+F  필터. 띄어쓰기=모두 포함, ;=또는, *.pdf 와일드카드\n" +
            "Alt+← / Alt+→ / Backspace  뒤로 / 앞으로 / 위로\n" +
            "Enter / Ctrl+Enter / Shift+Enter  열기 / 새 탭 / 옆 패널\n" +
            "Ctrl+Shift+→  지금 폴더를 옆 패널에도 열기\n" +
            "Ctrl+C / X / V  복사 / 잘라내기 / 붙여넣기 (탐색기와 호환)\n" +
            "F2 / Del / Shift+Del  이름 바꾸기 / 휴지통 / 영구 삭제\n" +
            "Ctrl+Shift+N  새 폴더 · Ctrl+Shift+C  경로 복사\n" +
            "Ctrl+D  즐겨찾기 · Ctrl+B  사이드바 · Ctrl+H  숨김 파일\n" +
            "끌어서 놓기: 같은 드라이브는 이동, 다른 드라이브는 복사 (Ctrl=복사, Shift=이동)";
        InputDialog.Confirm(this, "단축키", help, "닫기");
    }

    // ───────────── Keyboard ─────────────

    private void OnPreviewKeyDown(object sender, KeyEventArgs e)
    {
        var key = e.Key == Key.System ? e.SystemKey : e.Key;
        var mods = Keyboard.Modifiers;
        var ctrl = mods.HasFlag(ModifierKeys.Control);
        var shift = mods.HasFlag(ModifierKeys.Shift);
        var alt = mods.HasFlag(ModifierKeys.Alt);
        var typing = Keyboard.FocusedElement is TextBox;
        var handled = true;

        switch (key)
        {
            case Key.D1 or Key.NumPad1 when ctrl: ApplyLayout(LayoutKind.Single); break;
            case Key.D2 or Key.NumPad2 when ctrl: ApplyLayout(LayoutKind.TwoColumns); break;
            case Key.D3 or Key.NumPad3 when ctrl: ApplyLayout(LayoutKind.TwoRows); break;
            case Key.D4 or Key.NumPad4 when ctrl: ApplyLayout(LayoutKind.Three); break;
            case Key.D5 or Key.NumPad5 when ctrl: ApplyLayout(LayoutKind.Four); break;
            case Key.F6: CyclePane(shift ? -1 : 1); break;
            case Key.F1: ShowHelp(); break;
            case Key.F5: _active.Refresh(); break;
            case Key.T when ctrl: _active.OpenTab(_active.CurrentPath); _active.FocusList(); break;
            case Key.W when ctrl: _active.CloseTab(_active.CurrentTab); break;
            case Key.Tab when ctrl: _active.NextTab(shift ? -1 : 1); break;
            case Key.L when ctrl: _active.EditAddress(); break;
            case Key.F when ctrl: _active.FocusFilter(); break;
            case Key.B when ctrl: ToggleSidebar(); break;
            case Key.H when ctrl: ToggleHidden(); break;
            case Key.D when ctrl:
                if (_active.CurrentPath != PathCrumbs.ThisPc) ToggleFavorite(_active.CurrentPath);
                break;
            case Key.Left when alt: _active.GoBack(); break;
            case Key.Right when alt: _active.GoForward(); break;
            case Key.Up when alt: _active.GoUp(); break;
            case Key.Right when ctrl && shift && !typing: OpenInNextPane(_active, _active.CurrentPath); break;
            default: handled = false; break;
        }
        e.Handled = handled;
    }

    // ───────────── Window chrome & lifetime ─────────────

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        OnStateChanged(this, EventArgs.Empty);
        if (StartupPath is { } path && Directory.Exists(path)) _active.OpenTab(path);
        _active.FocusList();
        RefreshDrives();
    }

    private void OnActivated(object? sender, EventArgs e) => RefreshDrives();

    private void OnMinimize(object sender, RoutedEventArgs e) => WindowState = WindowState.Minimized;

    private void OnMaximize(object sender, RoutedEventArgs e) =>
        WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;

    private void OnClose(object sender, RoutedEventArgs e) => Close();

    private void OnStateChanged(object? sender, EventArgs e)
    {
        // A borderless window overhangs the screen by the resize border when maximized.
        var maximized = WindowState == WindowState.Maximized;
        Root.Margin = maximized ? new Thickness(7) : new Thickness(0);
        Root.BorderThickness = maximized ? new Thickness(0) : new Thickness(1);
        MaximizeButton.Content = maximized ? "" : "";
        MaximizeButton.ToolTip = maximized ? "이전 크기로" : "최대화";
    }

    private void ApplySavedBounds()
    {
        Width = Math.Max(MinWidth, _settings.WindowWidth);
        Height = Math.Max(MinHeight, _settings.WindowHeight);
        var left = _settings.WindowLeft;
        var top = _settings.WindowTop;
        var onScreen = !double.IsNaN(left) && !double.IsNaN(top) &&
            left > SystemParameters.VirtualScreenLeft - 100 &&
            top > SystemParameters.VirtualScreenTop - 20 &&
            left < SystemParameters.VirtualScreenLeft + SystemParameters.VirtualScreenWidth - 200 &&
            top < SystemParameters.VirtualScreenTop + SystemParameters.VirtualScreenHeight - 100;
        if (onScreen)
        {
            WindowStartupLocation = WindowStartupLocation.Manual;
            Left = left;
            Top = top;
        }
        else
        {
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
        }
        if (_settings.WindowMaximized) WindowState = WindowState.Maximized;
    }

    private void OnClosing(object? sender, CancelEventArgs e) => SaveSettings();

    private void SaveSettings()
    {
        var bounds = WindowState == WindowState.Normal ? new Rect(Left, Top, Width, Height) : RestoreBounds;
        if (!bounds.IsEmpty)
        {
            _settings.WindowLeft = bounds.Left;
            _settings.WindowTop = bounds.Top;
            _settings.WindowWidth = bounds.Width;
            _settings.WindowHeight = bounds.Height;
        }
        _settings.WindowMaximized = WindowState == WindowState.Maximized;
        _settings.Layout = _layout;
        _settings.ActivePane = _active.Index;
        _settings.Panes = _panes.Select(p => p.GetState()).ToList();
        _settings.Favorites = _favorites.Select(f => new Favorite { Name = f.Name, Path = f.Path }).ToList();
        _settings.ShowHidden = ShowHidden;
        _settings.SidebarVisible = Sidebar.Visibility == Visibility.Visible;
        if (_settings.SidebarVisible && SidebarColumn.ActualWidth > 0) _settings.SidebarWidth = SidebarColumn.ActualWidth;
        try
        {
            _store.Save(_settings);
        }
        catch (Exception ex)
        {
            ShowToast("설정을 저장하지 못했어요: " + ex.Message, isError: true);
        }
    }
}

public static class KnownFolders
{
    /// <summary>The real Downloads folder, even when it's been moved to another drive.</summary>
    public static string Downloads
    {
        get
        {
            try
            {
                var path = Microsoft.Win32.Registry.GetValue(
                    @"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders",
                    "{374DE290-123F-4565-9164-39C4925E467B}", null) as string;
                if (!string.IsNullOrEmpty(path)) return Environment.ExpandEnvironmentVariables(path);
            }
            catch (Exception) { }
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
        }
    }
}
