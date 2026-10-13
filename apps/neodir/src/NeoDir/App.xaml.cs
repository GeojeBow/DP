using System.Windows;
using System.Windows.Threading;

namespace NeoDir;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        DispatcherUnhandledException += OnUnhandled;

        var window = new MainWindow();
        MainWindow = window;
        // "NeoDir.exe D:\Work" opens that folder in the first pane.
        if (e.Args.Length > 0) window.StartupPath = e.Args[0];
        window.Show();
    }

    private static void OnUnhandled(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        // A file-system hiccup should never close every pane the user has open.
        e.Handled = true;
        if (Current?.MainWindow is MainWindow main) main.ShowToast("문제가 생겼어요: " + e.Exception.Message, isError: true);
    }
}
