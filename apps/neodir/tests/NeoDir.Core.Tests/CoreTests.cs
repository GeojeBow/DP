using NeoDir.Core;

namespace NeoDir.Core.Tests;

public class PathCrumbsTests
{
    [Fact]
    public void Splits_drive_path_into_clickable_segments()
    {
        var crumbs = PathCrumbs.Split(@"c:\Users\harry\Documents\");
        Assert.Equal(
            [PathCrumbs.ThisPc, @"C:\", @"C:\Users", @"C:\Users\harry", @"C:\Users\harry\Documents"],
            crumbs.Select(c => c.Path));
        Assert.Equal(["내 PC", "C:", "Users", "harry", "Documents"], crumbs.Select(c => c.Label));
    }

    [Fact]
    public void Treats_server_and_share_as_one_root()
    {
        var crumbs = PathCrumbs.Split(@"\\nas\team\2024");
        Assert.Equal([PathCrumbs.ThisPc, @"\\nas\team", @"\\nas\team\2024"], crumbs.Select(c => c.Path));
    }

    [Theory]
    [InlineData(@"C:\Users\harry", @"C:\Users")]
    [InlineData(@"C:\Users", @"C:\")]
    [InlineData(@"C:\", PathCrumbs.ThisPc)]
    [InlineData("d:", PathCrumbs.ThisPc)]
    public void Parent_walks_up_to_this_pc(string path, string parent) =>
        Assert.Equal(parent, PathCrumbs.Parent(path));

    [Fact]
    public void This_pc_has_no_parent() => Assert.Null(PathCrumbs.Parent(PathCrumbs.ThisPc));

    [Theory]
    [InlineData("c:/temp/", @"C:\temp")]
    [InlineData("\"D:\\Work\"", @"D:\Work")]
    [InlineData("e:", @"E:\")]
    public void Normalizes_typed_paths(string typed, string expected) =>
        Assert.Equal(expected, PathCrumbs.Normalize(typed));
}

public class SizeFormatterTests
{
    [Theory]
    [InlineData(0, "0 B")]
    [InlineData(1023, "1023 B")]
    [InlineData(1536, "1.5 KB")]
    [InlineData(5L * 1024 * 1024, "5 MB")]
    [InlineData(250L * 1024 * 1024 * 1024, "250 GB")]
    public void Formats_like_explorer(long bytes, string expected) =>
        Assert.Equal(expected, SizeFormatter.Format(bytes));
}

public class NameFilterTests
{
    [Fact]
    public void Empty_query_matches_everything() => Assert.True(new NameFilter("  ").Matches("a.txt"));

    [Fact]
    public void Words_must_all_appear_in_any_order()
    {
        var filter = new NameFilter("2024 report");
        Assert.True(filter.Matches("Report_final_2024.pdf"));
        Assert.False(filter.Matches("Report_final_2023.pdf"));
    }

    [Fact]
    public void Semicolon_separates_alternatives_and_wildcards_match_whole_name()
    {
        var filter = new NameFilter("*.pdf; *.hwp");
        Assert.True(filter.Matches("계약서.HWP"));
        Assert.True(filter.Matches("a.pdf"));
        Assert.False(filter.Matches("a.pdf.bak"));
    }
}

public class UniqueNameTests
{
    [Fact]
    public void Adds_a_counter_before_the_extension()
    {
        var taken = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "a.txt", "a (2).txt" };
        Assert.Equal("a (3).txt", UniqueName.Next("a.txt", false, taken.Contains));
    }

    [Fact]
    public void Folders_keep_dots_in_the_name()
    {
        var taken = new HashSet<string> { "v1.2" };
        Assert.Equal("v1.2 (2)", UniqueName.Next("v1.2", true, taken.Contains));
    }

    [Theory]
    [InlineData("ok.txt", true)]
    [InlineData("a:b", false)]
    [InlineData("trailing.", false)]
    [InlineData(" ", false)]
    public void Validates_windows_names(string name, bool valid) =>
        Assert.Equal(valid, UniqueName.Invalid(name) is null);
}

public class ColorRulesTests
{
    [Fact]
    public void Matches_extension_case_insensitively()
    {
        var rules = new ColorRules([new ColorRule { Extensions = "jpg .png *.gif", Color = "#123456" }]);
        Assert.Equal("#123456", rules.ColorFor("photo.JPG"));
        Assert.Equal("#123456", rules.ColorFor("x.gif"));
        Assert.Null(rules.ColorFor("noext"));
        Assert.Null(rules.ColorFor("a.txt"));
    }
}

public class NavigationHistoryTests
{
    [Fact]
    public void Back_and_forward_round_trip_and_new_visit_clears_forward()
    {
        var history = new NavigationHistory("A");
        history.Visit("B");
        history.Visit("C");
        Assert.Equal("B", history.Back());
        Assert.Equal("A", history.Back());
        Assert.Null(history.Back());
        Assert.Equal("B", history.Forward());
        history.Visit("D");
        Assert.False(history.CanGoForward);
        Assert.Equal("B", history.Back());
    }
}

public class SettingsStoreTests
{
    [Fact]
    public void Round_trips_and_survives_a_broken_file()
    {
        var dir = Directory.CreateTempSubdirectory().FullName;
        var store = SettingsStore.Locate(dir, Path.Combine(dir, "appdata"));
        Assert.Equal(Path.Combine(dir, SettingsStore.FileName), store.FilePath);

        var settings = new AppSettings { Layout = LayoutKind.Three, ShowHidden = true };
        settings.Favorites.Add(new Favorite { Name = "작업", Path = @"D:\Work" });
        settings.Panes.Add(new PaneState { Tabs = [@"C:\", @"D:\"], SelectedTab = 1 });
        store.Save(settings);

        var loaded = store.Load();
        Assert.Equal(LayoutKind.Three, loaded.Layout);
        Assert.True(loaded.ShowHidden);
        Assert.Equal(@"D:\Work", loaded.Favorites[0].Path);
        Assert.Equal(1, loaded.Panes[0].SelectedTab);
        Assert.True(double.IsNaN(loaded.WindowLeft));

        File.WriteAllText(store.FilePath, "{ not json");
        Assert.Equal(LayoutKind.Four, store.Load().Layout);
        Assert.True(File.Exists(store.FilePath + ".broken"));
    }
}
