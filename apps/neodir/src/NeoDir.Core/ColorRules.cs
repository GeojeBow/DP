namespace NeoDir.Core;

/// <summary>Colors file names by extension, like Q-Dir's color filter.</summary>
public sealed class ColorRule
{
    public string Name { get; set; } = "";
    /// <summary>Space-separated extensions without dots, e.g. "jpg png gif".</summary>
    public string Extensions { get; set; } = "";
    /// <summary>#RRGGBB.</summary>
    public string Color { get; set; } = "#FFFFFF";
}

public sealed class ColorRules
{
    private readonly Dictionary<string, string> _byExtension = new(StringComparer.OrdinalIgnoreCase);

    public ColorRules(IEnumerable<ColorRule> rules)
    {
        foreach (var rule in rules)
            foreach (var ext in rule.Extensions.Split(new[] { ' ', ',', ';' }, StringSplitOptions.RemoveEmptyEntries))
                _byExtension.TryAdd(ext.TrimStart('*', '.'), rule.Color);
    }

    public string? ColorFor(string fileName)
    {
        var dot = fileName.LastIndexOf('.');
        if (dot < 0 || dot == fileName.Length - 1) return null;
        return _byExtension.TryGetValue(fileName[(dot + 1)..], out var color) ? color : null;
    }

    public static List<ColorRule> Defaults() =>
    [
        new() { Name = "이미지", Extensions = "jpg jpeg png gif bmp webp svg heic ico tif tiff psd", Color = "#F472B6" },
        new() { Name = "영상", Extensions = "mp4 mkv avi mov wmv webm flv m4v", Color = "#A78BFA" },
        new() { Name = "음악", Extensions = "mp3 wav flac aac ogg m4a wma", Color = "#60A5FA" },
        new() { Name = "압축", Extensions = "zip 7z rar tar gz bz2 xz cab iso alz egg", Color = "#FBBF24" },
        new() { Name = "문서", Extensions = "pdf doc docx hwp hwpx txt md rtf odt", Color = "#34D399" },
        new() { Name = "표·발표", Extensions = "xls xlsx xlsm csv ppt pptx", Color = "#2DD4BF" },
        new() { Name = "코드", Extensions = "cs js ts tsx jsx py java c cpp h json xml yaml yml html css sql ps1 bat cmd sh", Color = "#FB923C" },
        new() { Name = "실행 파일", Extensions = "exe msi lnk dll com scr", Color = "#F87171" },
    ];
}
