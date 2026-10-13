namespace NeoDir.Core;

/// <summary>One clickable segment of the address bar.</summary>
public sealed record Crumb(string Path, string Label);

/// <summary>
/// Splits Windows paths into breadcrumb segments with plain string logic, so it
/// behaves the same on any OS (and in tests).
/// </summary>
public static class PathCrumbs
{
    /// <summary>Virtual root that lists drives ("내 PC").</summary>
    public const string ThisPc = "::pc";

    public static IReadOnlyList<Crumb> Split(string path)
    {
        var crumbs = new List<Crumb> { new(ThisPc, "내 PC") };
        if (string.IsNullOrWhiteSpace(path) || path == ThisPc) return crumbs;

        path = Normalize(path);
        string root;
        string rest;
        if (path.StartsWith(@"\\", StringComparison.Ordinal))
        {
            // UNC: \\server\share is the root.
            var parts = path[2..].Split('\\', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 2)
            {
                crumbs.Add(new Crumb(path, path));
                return crumbs;
            }
            root = @"\\" + parts[0] + @"\" + parts[1];
            rest = string.Join('\\', parts.Skip(2));
            crumbs.Add(new Crumb(root, root));
        }
        else if (path.Length >= 2 && path[1] == ':')
        {
            root = path[..2].ToUpperInvariant() + @"\";
            rest = path.Length > 3 ? path[3..] : "";
            crumbs.Add(new Crumb(root, root[..2]));
        }
        else
        {
            crumbs.Add(new Crumb(path, path));
            return crumbs;
        }

        var current = root;
        foreach (var part in rest.Split('\\', StringSplitOptions.RemoveEmptyEntries))
        {
            current = current.EndsWith('\\') ? current + part : current + @"\" + part;
            crumbs.Add(new Crumb(current, part));
        }
        return crumbs;
    }

    /// <summary>Parent folder, or <see cref="ThisPc"/> for a drive root; null at the top.</summary>
    public static string? Parent(string path)
    {
        if (string.IsNullOrWhiteSpace(path) || path == ThisPc) return null;
        var crumbs = Split(path);
        return crumbs.Count >= 2 ? crumbs[^2].Path : ThisPc;
    }

    /// <summary>Forward slashes to backslashes, no trailing slash except on a drive root.</summary>
    public static string Normalize(string path)
    {
        path = path.Trim().Trim('"').Replace('/', '\\');
        if (path.Length == 2 && path[1] == ':') return path.ToUpperInvariant() + @"\";
        if (path.Length > 3 && path.EndsWith('\\')) path = path.TrimEnd('\\');
        if (path.Length >= 2 && path[1] == ':') path = char.ToUpperInvariant(path[0]) + path[1..];
        return path;
    }

    /// <summary>Last segment for tab titles.</summary>
    public static string DisplayName(string path)
    {
        var crumbs = Split(path);
        return crumbs[^1].Label;
    }
}
