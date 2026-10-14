using System.IO;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media.Imaging;
using NeoDir.Core;

namespace NeoDir;

/// <summary>Shows what's selected in the active pane: picture, start of a text file, or a thumbnail.</summary>
public partial class PreviewPanel : UserControl
{
    private static readonly HashSet<string> ImageTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".ico", ".tif", ".tiff", ".webp", ".jfif",
    };

    private static readonly HashSet<string> TextTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        ".txt", ".md", ".log", ".csv", ".tsv", ".json", ".xml", ".yaml", ".yml", ".ini", ".cfg", ".conf", ".toml",
        ".cs", ".js", ".ts", ".tsx", ".jsx", ".py", ".java", ".c", ".cpp", ".h", ".hpp", ".go", ".rs", ".kt",
        ".html", ".htm", ".css", ".scss", ".sql", ".ps1", ".bat", ".cmd", ".sh", ".vb", ".reg", ".gitignore", ".editorconfig",
    };

    private const int TextBytes = 64 * 1024;
    private const long MaxImageBytes = 60L * 1024 * 1024;

    private int _version;

    static PreviewPanel()
    {
        // Korean files saved by older Windows apps are often CP949, not UTF-8.
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
    }

    public PreviewPanel()
    {
        InitializeComponent();
        Show([]);
    }

    public async void Show(IReadOnlyList<FileEntry> selected)
    {
        var version = ++_version;
        ImageFrame.Visibility = Visibility.Collapsed;
        PreviewImage.Source = null;
        TextPreview.Visibility = Visibility.Collapsed;
        TextPreview.Text = "";
        MessageText.Text = "";

        if (selected.Count == 0)
        {
            NameText.Text = "";
            DetailText.Text = "";
            MessageText.Text = "파일을 고르면 여기에 미리보기가 나와요.";
            return;
        }
        if (selected.Count > 1)
        {
            NameText.Text = $"{selected.Count:N0}개 선택";
            var bytes = selected.Where(e => !e.IsDirectory).Sum(e => Math.Max(0, e.Size));
            var folders = selected.Count(e => e.IsDirectory);
            DetailText.Text = $"파일 {selected.Count - folders:N0}개 ({SizeFormatter.Format(bytes)})" + (folders > 0 ? $" · 폴더 {folders:N0}개" : "");
            return;
        }

        var entry = selected[0];
        NameText.Text = entry.Name;
        DetailText.Text = entry.IsDrive
            ? entry.TypeName
            : string.Join("\n", new[]
            {
                entry.TypeName,
                entry.IsDirectory ? null : SizeFormatter.Format(entry.Size),
                entry.ModifiedText.Length > 0 ? "수정 " + entry.ModifiedText : null,
                entry.Location is { Length: > 0 } location ? "위치 " + location : null,
            }.Where(s => s != null));

        if (entry.IsDirectory)
        {
            var count = await Task.Run(() => CountItems(entry.FullPath));
            if (version != _version) return;
            MessageText.Text = count switch
            {
                null => "",
                0 => "빈 폴더예요",
                >= 10000 => "항목 10,000개 이상",
                _ => $"항목 {count:N0}개",
            };
            return;
        }
        if (entry.IsCloudOnly)
        {
            MessageText.Text = "온라인 전용 파일이라 미리보기를 건너뛰었어요.\n열면 OneDrive에서 내려받아요.";
            return;
        }

        var ext = Path.GetExtension(entry.Name);
        try
        {
            if (ImageTypes.Contains(ext) && entry.Size <= MaxImageBytes)
            {
                var image = await Task.Run(() => LoadImage(entry.FullPath));
                if (version != _version) return;
                if (image != null)
                {
                    PreviewImage.Source = image;
                    ImageFrame.Visibility = Visibility.Visible;
                    DetailText.Text += $"\n{image.PixelWidth} × {image.PixelHeight}";
                    return;
                }
            }
            else if (TextTypes.Contains(ext) || (ext.Length == 0 && entry.Size < TextBytes))
            {
                var text = await Task.Run(() => ReadText(entry.FullPath));
                if (version != _version) return;
                TextPreview.Text = text;
                TextPreview.Visibility = Visibility.Visible;
                return;
            }

            var thumbnail = await Thumbnails.GetAsync(entry.FullPath, 400);
            if (version != _version) return;
            if (thumbnail != null)
            {
                PreviewImage.Source = thumbnail;
                ImageFrame.Visibility = Visibility.Visible;
                return;
            }
            MessageText.Text = "이 형식은 미리보기가 없어요.";
        }
        catch (Exception ex)
        {
            if (version == _version) MessageText.Text = "미리보기를 못 만들었어요: " + ex.Message;
        }
    }

    private static int? CountItems(string path)
    {
        try
        {
            return Directory.EnumerateFileSystemEntries(path, "*", new EnumerationOptions { IgnoreInaccessible = true })
                .Take(10000).Count();
        }
        catch (Exception)
        {
            return null;
        }
    }

    private static BitmapSource? LoadImage(string path)
    {
        try
        {
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            var image = new BitmapImage();
            image.BeginInit();
            image.CacheOption = BitmapCacheOption.OnLoad;
            image.CreateOptions = BitmapCreateOptions.IgnoreColorProfile;
            image.DecodePixelWidth = 640;
            image.StreamSource = stream;
            image.EndInit();
            image.Freeze();
            return image;
        }
        catch (Exception)
        {
            return null;
        }
    }

    private static string ReadText(string path)
    {
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        var buffer = new byte[TextBytes];
        var read = stream.ReadAtLeast(buffer, buffer.Length, throwOnEndOfStream: false);
        var truncated = stream.Length > read;
        if (Array.IndexOf(buffer, (byte)0, 0, Math.Min(read, 4096)) >= 0 && !HasUtf16Bom(buffer))
            return "(텍스트가 아닌 파일 같아요)";

        string text;
        if (HasUtf16Bom(buffer)) text = Encoding.Unicode.GetString(buffer, 2, read - 2);
        else
        {
            try
            {
                text = new UTF8Encoding(false, throwOnInvalidBytes: true).GetString(buffer, 0, read);
            }
            catch (DecoderFallbackException) when (!truncated || read < 4)
            {
                text = Encoding.GetEncoding(949).GetString(buffer, 0, read);
            }
            catch (DecoderFallbackException)
            {
                // The cut at 64 KB may split a UTF-8 character; retry without the last few bytes.
                try { text = new UTF8Encoding(false, true).GetString(buffer, 0, read - 3); }
                catch (DecoderFallbackException) { text = Encoding.GetEncoding(949).GetString(buffer, 0, read); }
            }
        }
        text = text.TrimStart('﻿');
        return truncated ? text + "\n\n… (앞부분 64KB만 보여줘요)" : text;
    }

    private static bool HasUtf16Bom(byte[] buffer) => buffer.Length >= 2 && buffer[0] == 0xFF && buffer[1] == 0xFE;
}
