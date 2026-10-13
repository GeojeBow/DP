using System.Text.RegularExpressions;

namespace NeoDir.Core;

/// <summary>
/// Instant filter for the file list.
/// "report 2024" → name contains both words; "*.pdf;*.hwp" → either pattern.
/// </summary>
public sealed class NameFilter
{
    private readonly List<List<Func<string, bool>>> _groups = [];

    public NameFilter(string? query)
    {
        Query = query?.Trim() ?? "";
        foreach (var group in Query.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var tests = group
                .Split(' ', StringSplitOptions.RemoveEmptyEntries)
                .Select(Compile)
                .ToList();
            if (tests.Count > 0) _groups.Add(tests);
        }
    }

    public string Query { get; }

    public bool IsEmpty => _groups.Count == 0;

    public bool Matches(string name) =>
        IsEmpty || _groups.Any(group => group.All(test => test(name)));

    private static Func<string, bool> Compile(string token)
    {
        if (token.Contains('*') || token.Contains('?'))
        {
            var pattern = "^" + Regex.Escape(token).Replace(@"\*", ".*").Replace(@"\?", ".") + "$";
            var regex = new Regex(pattern, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
            return regex.IsMatch;
        }
        return name => name.Contains(token, StringComparison.OrdinalIgnoreCase);
    }
}
