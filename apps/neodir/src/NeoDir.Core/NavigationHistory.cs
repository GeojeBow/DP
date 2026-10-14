namespace NeoDir.Core;

/// <summary>Back/forward stacks for one tab.</summary>
public sealed class NavigationHistory
{
    private readonly Stack<string> _back = new();
    private readonly Stack<string> _forward = new();

    public NavigationHistory(string start) => Current = start;

    public string Current { get; private set; }
    public bool CanGoBack => _back.Count > 0;
    public bool CanGoForward => _forward.Count > 0;

    public void Visit(string path)
    {
        if (string.Equals(path, Current, StringComparison.OrdinalIgnoreCase)) return;
        _back.Push(Current);
        _forward.Clear();
        Current = path;
    }

    public string? Back()
    {
        if (!CanGoBack) return null;
        _forward.Push(Current);
        Current = _back.Pop();
        return Current;
    }

    public string? Forward()
    {
        if (!CanGoForward) return null;
        _back.Push(Current);
        Current = _forward.Pop();
        return Current;
    }
}
