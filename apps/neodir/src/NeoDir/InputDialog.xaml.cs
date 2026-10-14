using System.IO;
using System.Windows;
using System.Windows.Input;

namespace NeoDir;

public partial class InputDialog : Window
{
    private Func<string, string?>? _validate;

    private InputDialog()
    {
        InitializeComponent();
    }

    /// <summary>Asks for a name. The stem is pre-selected so typing keeps the extension.</summary>
    public static string? Ask(Window owner, string title, string initial, Func<string, string?>? validate = null, bool selectAll = false, string? message = null)
    {
        var dialog = new InputDialog { Owner = owner, _validate = validate };
        dialog.TitleText.Text = title;
        dialog.SetMessage(message);
        dialog.Input.Text = initial;
        dialog.Loaded += (_, _) =>
        {
            dialog.Input.Focus();
            var stem = selectAll ? initial.Length : Path.GetFileNameWithoutExtension(initial).Length;
            dialog.Input.Select(0, stem > 0 ? stem : initial.Length);
        };
        return dialog.ShowDialog() == true ? dialog.Input.Text.Trim() : null;
    }

    public static bool Confirm(Window owner, string title, string message, string okText)
    {
        var dialog = new InputDialog { Owner = owner };
        dialog.TitleText.Text = title;
        dialog.SetMessage(message);
        dialog.Input.Visibility = Visibility.Collapsed;
        dialog.OkButton.Content = okText;
        dialog.Loaded += (_, _) => dialog.OkButton.Focus();
        return dialog.ShowDialog() == true;
    }

    private void SetMessage(string? message)
    {
        MessageText.Text = message ?? "";
        MessageText.Visibility = string.IsNullOrEmpty(message) ? Visibility.Collapsed : Visibility.Visible;
    }

    private void OnOk(object sender, RoutedEventArgs e)
    {
        if (Input.Visibility == Visibility.Visible && _validate?.Invoke(Input.Text.Trim()) is { } error)
        {
            ErrorText.Text = error;
            ErrorText.Visibility = Visibility.Visible;
            return;
        }
        DialogResult = true;
    }

    private void OnTextChanged(object sender, System.Windows.Controls.TextChangedEventArgs e) =>
        ErrorText.Visibility = Visibility.Collapsed;

    private void OnDrag(object sender, MouseButtonEventArgs e)
    {
        if (e.ButtonState == MouseButtonState.Pressed) DragMove();
    }
}
