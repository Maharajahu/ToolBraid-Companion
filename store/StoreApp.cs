using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal sealed class StoreApp : Form
{
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetCurrentPackageFullName(ref int length, StringBuilder name);
    private readonly StoreConnection connection = StoreConnection.ForCurrentUser();
    private readonly Dictionary<string, object> settings;
    private readonly Label status;
    private readonly Button connect;
    private readonly Button disconnect;
    private readonly Button configuration;

    internal StoreApp()
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        settings = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(Path.Combine(root, "store-settings.json")));
        Text = "ToolBraid Companion";
        Font = new Font("Segoe UI", 10);
        AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(660, 720);
        MinimumSize = new Size(580, 580);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = SystemColors.Window;
        ForeColor = SystemColors.WindowText;
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(28), ColumnCount = 1, RowCount = 8, AutoScroll = true };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        Controls.Add(layout);
        layout.Controls.Add(new Label { Text = "ToolBraid Companion", AutoSize = true, Font = new Font(Font.FontFamily, 23, FontStyle.Bold), Margin = new Padding(0, 0, 0, 12) });
        layout.Controls.Add(Paragraph("Your browser. Your AI. Connected locally.", 32));
        layout.Controls.Add(Paragraph("Finish setup in both the companion and your browser:\r\n\r\n1. Install the public ToolBraid extension separately.\r\n2. Select Connect browsers below. This registers the companion; it does not enable browser access.\r\n3. Open the test page and open the ToolBraid extension on that tab. Review the disclosure, tick the consent checkbox and select Enable on this site. Approve site access if asked.\r\n4. Keep the tab open and select Check connection here. No AI sign-in is required for this check.", 192));
        bool packaged = HasPackageIdentity();
        bool preview = (bool)settings["preview"];
        status = Paragraph(preview ? "Local validation build — not submitted or Store-signed." : packaged ? "Ready to configure the Store companion." : "Install this companion through Microsoft Store before connecting.", 56);
        status.AccessibleName = "Connection status";
        layout.Controls.Add(status);
        layout.Controls.Add(Paragraph("Connecting replaces an existing public ToolBraid browser registration; its files and settings are kept. Disconnect restores the earlier registration. Personal ToolBraid is not changed.", 72));
        var actions = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, WrapContents = true, Margin = new Padding(0, 8, 0, 8) };
        connect = ActionButton("&Connect browsers", actions, delegate {
            connection.Connect((string)settings["edgeExtensionId"], (string)settings["chromeExtensionId"]);
            status.Text = "Companion registered. Next: open the test page, open ToolBraid and finish the browser permission step. Control stays paused until you enable it.";
            RefreshActions();
        });
        disconnect = ActionButton("&Disconnect browsers", actions, delegate {
            connection.Disconnect();
            status.Text = "Registration disconnected. Close existing ToolBraid browser connections; already-running actions are not undone.";
            RefreshActions();
        });
        connect.Enabled = packaged && !preview;
        ActionButton("Open &test page", actions, delegate { Open("https://example.org/"); });
        ActionButton("Check co&nnection", actions, delegate { CheckConnection(packaged && !preview); });
        layout.Controls.Add(actions);
        var links = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, WrapContents = true, Margin = new Padding(0) };
        configuration = ActionButton("Open &MCP configuration", links, delegate { Process.Start(new ProcessStartInfo { FileName = connection.ClientPath, UseShellExecute = true }); });
        ActionButton("Setup &guide", links, delegate { Open("https://toolbraid.pages.dev/#connect"); });
        ActionButton("&Privacy", links, delegate { Open("https://toolbraid.pages.dev/privacy/"); });
        layout.Controls.Add(links);
        layout.Controls.Add(Paragraph("The built-in chat is optional. You can stay in your existing Codex or MCP client. Disconnect browsers before uninstalling this app in Windows Settings. Local conversation and connection data are retained.", 82));
        RefreshActions();
    }

    private static bool HasPackageIdentity()
    {
        int length = 0;
        return GetCurrentPackageFullName(ref length, null) == 122;
    }

    private void RefreshActions()
    {
        disconnect.Enabled = HasPackageIdentity() && !(bool)settings["preview"] && File.Exists(Path.Combine(connection.DataRoot, "prior-registration.json"));
        configuration.Enabled = File.Exists(connection.ClientPath);
    }

    private Label Paragraph(string text, int height)
    {
        return new Label { Text = text, Dock = DockStyle.Fill, AutoSize = true, MinimumSize = new Size(0, height), Margin = new Padding(0, 0, 0, 8) };
    }

    private Button ActionButton(string text, Control parent, Action action)
    {
        var button = new Button { Text = text, AutoSize = true, MinimumSize = new Size(160, 40), Padding = new Padding(8), Margin = new Padding(0, 0, 10, 8), UseVisualStyleBackColor = true };
        button.Click += delegate {
            try { action(); }
            catch (Exception error) { status.Text = error.Message; status.Focus(); }
        };
        parent.Controls.Add(button);
        return button;
    }

    private static void Open(string url) { Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true }); }

    private void CheckConnection(bool installed)
    {
        using (var dialog = new Form { Text = "ToolBraid connection check", ClientSize = new Size(640, 460),
            MinimumSize = new Size(500, 340), StartPosition = FormStartPosition.CenterParent, Font = Font, Padding = new Padding(20) })
        {
            var results = new TextBox { Dock = DockStyle.Fill, Multiline = true, ReadOnly = true, WordWrap = true,
                ScrollBars = ScrollBars.Vertical, AccessibleName = "Connection check results", BackColor = SystemColors.Window,
                Text = "Checking local configuration and MCP. No browser actions or model requests are sent..." };
            var buttons = new FlowLayoutPanel { Dock = DockStyle.Bottom, AutoSize = true, WrapContents = true };
            var retry = new Button { Text = "Check &again", AutoSize = true, MinimumSize = new Size(150, 42), Enabled = false };
            var close = new Button { Text = "&Close", AutoSize = true, MinimumSize = new Size(150, 42), DialogResult = DialogResult.Cancel };
            buttons.Controls.Add(retry);
            buttons.Controls.Add(close);
            dialog.Controls.Add(results);
            dialog.Controls.Add(buttons);
            dialog.CancelButton = close;
            Func<Task> runCheck = async delegate {
                retry.Enabled = false;
                results.Text = "Checking local configuration and MCP. No browser actions or model requests are sent...";
                string report;
                try {
                    report = installed ? await Task.Run(() => RunConnectionCheck())
                        : "STORE PACKAGE — NOT INSTALLED\r\n\r\nThis is a local validation or unpackaged build. Live checks are disabled until the companion is installed with its real Store identity.\r\n\r\nNo browser registrations, connection data or permissions were changed.";
                } catch {
                    report = "CHECK UNAVAILABLE\r\n\r\nThe connection check could not finish. Reopen the Store companion and try again. No settings were changed.";
                }
                if (!results.IsDisposed) { results.Text = report; results.Select(0, 0); results.Focus(); retry.Enabled = installed; }
            };
            dialog.Shown += async delegate { await runCheck(); };
            retry.Click += async delegate { await runCheck(); };
            dialog.ShowDialog(this);
        }
    }

    private static string QuoteArgument(string value) { return "\"" + value.Replace("\"", "\\\"") + "\""; }

    private string RunConnectionCheck()
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        using (var process = new Process { StartInfo = new ProcessStartInfo {
            FileName = Path.Combine(root, "runtime", "node.exe"),
            Arguments = QuoteArgument(Path.Combine(root, "store", "diagnostics.mjs"))
                + " --data-root " + QuoteArgument(connection.DataRoot) + " --alias-root " + QuoteArgument(connection.AliasRoot)
                + " --edge-id " + QuoteArgument((string)settings["edgeExtensionId"])
                + " --chrome-id " + QuoteArgument((string)settings["chromeExtensionId"])
                + " --registered " + (connection.IsConnected() ? "yes" : "no"),
            UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden,
            RedirectStandardOutput = true, RedirectStandardError = true,
        } })
        {
            process.Start();
            var output = process.StandardOutput.ReadToEndAsync();
            var errors = process.StandardError.ReadToEndAsync();
            if (!process.WaitForExit(15000)) { process.Kill(); return "CHECK TIMED OUT\r\n\r\nReopen the Store companion and try again. No settings were changed."; }
            Task.WaitAll(output, errors);
            if (process.ExitCode != 0 || output.Result.Length > 16384) throw new InvalidOperationException();
            var report = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(output.Result);
            var lines = new StringBuilder();
            foreach (var item in (System.Collections.IEnumerable)report["checks"])
            {
                var check = (Dictionary<string, object>)item;
                lines.Append(check["name"]).Append(" — ").Append(check["state"]).Append("\r\n").Append(check["detail"]).Append("\r\n\r\n");
            }
            return lines.ToString().TrimEnd();
        }
    }

    [STAThread]
    private static int Main()
    {
        try {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new StoreApp());
            return 0;
        }
        catch (Exception error) { MessageBox.Show(error.Message, "ToolBraid Companion", MessageBoxButtons.OK, MessageBoxIcon.Error); return 1; }
    }
}
