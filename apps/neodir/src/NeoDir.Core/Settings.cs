using System.Text.Json;
using System.Text.Json.Serialization;

namespace NeoDir.Core;

public enum LayoutKind
{
    Single,
    TwoColumns,
    TwoRows,
    Three,
    Four,
}

public sealed class Favorite
{
    public string Name { get; set; } = "";
    public string Path { get; set; } = "";
}

public sealed class PaneState
{
    public List<string> Tabs { get; set; } = [];
    public int SelectedTab { get; set; }
}

public sealed class AppSettings
{
    public LayoutKind Layout { get; set; } = LayoutKind.Four;
    public List<PaneState> Panes { get; set; } = [];
    public int ActivePane { get; set; }
    public List<Favorite> Favorites { get; set; } = [];
    public List<ColorRule> ColorRules { get; set; } = Core.ColorRules.Defaults();
    public bool ShowHidden { get; set; }
    public bool SidebarVisible { get; set; } = true;
    public double SidebarWidth { get; set; } = 230;
    public double WindowLeft { get; set; } = double.NaN;
    public double WindowTop { get; set; } = double.NaN;
    public double WindowWidth { get; set; } = 1400;
    public double WindowHeight { get; set; } = 860;
    public bool WindowMaximized { get; set; }
}

/// <summary>
/// Portable settings: a JSON file next to the exe when that folder is writable
/// (USB stick, Downloads), otherwise %APPDATA%\NeoDir.
/// </summary>
public sealed class SettingsStore
{
    public const string FileName = "NeoDir.settings.json";

    private static readonly JsonSerializerOptions Json = new()
    {
        WriteIndented = true,
        Converters = { new JsonStringEnumConverter() },
        NumberHandling = JsonNumberHandling.AllowNamedFloatingPointLiterals,
    };

    public SettingsStore(string path) => FilePath = path;

    public string FilePath { get; }

    public static SettingsStore Locate(string exeDirectory, string appDataDirectory)
    {
        var portable = System.IO.Path.Combine(exeDirectory, FileName);
        if (File.Exists(portable) || CanWrite(exeDirectory)) return new SettingsStore(portable);
        return new SettingsStore(System.IO.Path.Combine(appDataDirectory, "NeoDir", FileName));
    }

    public AppSettings Load()
    {
        try
        {
            if (File.Exists(FilePath))
                return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(FilePath), Json) ?? new AppSettings();
        }
        catch (Exception)
        {
            // A broken file shouldn't stop the app from starting; keep a copy for the user.
            try { File.Copy(FilePath, FilePath + ".broken", overwrite: true); } catch (Exception) { }
        }
        return new AppSettings();
    }

    public void Save(AppSettings settings)
    {
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(FilePath)!);
        var temp = FilePath + ".tmp";
        File.WriteAllText(temp, JsonSerializer.Serialize(settings, Json));
        File.Move(temp, FilePath, overwrite: true);
    }

    private static bool CanWrite(string directory)
    {
        try
        {
            var probe = System.IO.Path.Combine(directory, $".neodir-{Guid.NewGuid():N}.tmp");
            File.WriteAllText(probe, "");
            File.Delete(probe);
            return true;
        }
        catch (Exception)
        {
            return false;
        }
    }
}
