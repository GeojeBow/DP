namespace NeoDir.Core;

public static class UniqueName
{
    /// <summary>
    /// "report.pdf" → "report (2).pdf" → "report (3).pdf" … until <paramref name="exists"/> says it's free.
    /// </summary>
    public static string Next(string name, bool isDirectory, Func<string, bool> exists)
    {
        if (!exists(name)) return name;
        var dot = isDirectory ? -1 : name.LastIndexOf('.');
        var stem = dot > 0 ? name[..dot] : name;
        var ext = dot > 0 ? name[dot..] : "";
        for (var i = 2; ; i++)
        {
            var candidate = $"{stem} ({i}){ext}";
            if (!exists(candidate)) return candidate;
        }
    }

    /// <summary>Characters Windows refuses in a file name, or null when the name is fine.</summary>
    public static string? Invalid(string name)
    {
        if (string.IsNullOrWhiteSpace(name)) return "이름을 입력하세요.";
        if (name.IndexOfAny(['\\', '/', ':', '*', '?', '"', '<', '>', '|']) >= 0)
            return "다음 문자는 쓸 수 없어요: \\ / : * ? \" < > |";
        if (name.EndsWith('.') || name.EndsWith(' ')) return "이름은 점이나 공백으로 끝날 수 없어요.";
        return null;
    }
}
