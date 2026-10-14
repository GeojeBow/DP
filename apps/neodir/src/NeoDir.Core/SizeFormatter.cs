using System.Globalization;

namespace NeoDir.Core;

public static class SizeFormatter
{
    private static readonly string[] Units = ["B", "KB", "MB", "GB", "TB", "PB"];

    public static string Format(long bytes)
    {
        if (bytes < 0) return "";
        if (bytes < 1024) return $"{bytes} B";
        double value = bytes;
        var unit = 0;
        while (value >= 1024 && unit < Units.Length - 1)
        {
            value /= 1024;
            unit++;
        }
        var format = value >= 100 ? "0" : "0.#";
        return value.ToString(format, CultureInfo.InvariantCulture) + " " + Units[unit];
    }
}
