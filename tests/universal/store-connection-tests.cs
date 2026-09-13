using System;
using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using Microsoft.Win32;

internal static class StoreConnectionTests
{
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
    private static void Reject(Action action, string message) {
        try { action(); } catch (InvalidOperationException) { return; }
        throw new Exception(message);
    }
    public static int Main(string[] args)
    {
        string root = args[0];
        string prefix = "Software\\ToolBraid\\StoreIntegrationTests\\" + Guid.NewGuid().ToString("N");
        string edge = prefix + "\\Microsoft\\Edge\\NativeMessagingHosts\\com.toolbraid.bridge";
        string chrome = prefix + "\\Google\\Chrome\\NativeMessagingHosts\\com.toolbraid.bridge";
        var data = new StoreConnection(Path.Combine(root, "data"), Path.Combine(root, "aliases"), prefix);
        string edgeId = new string('a', 32), chromeId = new string('b', 32);
        try {
            Reject(delegate { data.Connect("invalid", chromeId); }, "Invalid ID accepted");
            Reject(delegate { data.Connect(edgeId, chromeId); }, "Missing aliases accepted");
            Check(!Directory.Exists(data.DataRoot), "Failed preconditions wrote state");
            Directory.CreateDirectory(data.AliasRoot);
            File.WriteAllText(Path.Combine(data.AliasRoot, "ToolBraidNativeHost.exe"), "test-only alias sentinel");
            File.WriteAllText(Path.Combine(data.AliasRoot, "ToolBraidMcp.exe"), "test-only alias sentinel");
            using (var key = Registry.CurrentUser.CreateSubKey(edge)) key.SetValue("", "previous-public-host.json");
            data.Connect(edgeId, chromeId);
            Check(data.IsConnected(), "Registration not connected");
            string configPath = Path.Combine(data.DataRoot, "bridge-config.json");
            var config = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(configPath));
            string token = (string)config["token"];
            Check(Regex.IsMatch(token, "^[a-f0-9]{64}$"), "Invalid generated token");
            Check((string)config["pipe"] == "\\\\.\\pipe\\toolbraid-mcp-" + token.Substring(0, 32), "Wrong pipe");
            var manifest = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(data.ManifestPath));
            Check((string)manifest["path"] == Path.Combine(data.AliasRoot, "ToolBraidNativeHost.exe"), "Manifest uses a versioned executable path");
            Check(File.ReadAllText(data.ClientPath).Contains("ToolBraidMcp.exe"), "MCP alias not configured");
            Check(File.ReadAllText(data.ClientPath).Contains("\"args\":[\"--mcp\"]"), "MCP transport selector not configured");
            Check(File.ReadAllText(data.ManifestPath).Contains("chrome-extension://" + edgeId + "/"), "Edge origin missing");
            Check(File.ReadAllText(data.ManifestPath).Contains("chrome-extension://" + chromeId + "/"), "Chrome origin missing");
            Check(Directory.GetAccessControl(data.DataRoot).AreAccessRulesProtected, "Connection directory inherits permissions");
            data.Connect(edgeId, chromeId);
            Check((string)Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(configPath))["token"] == token, "Reconnect replaced credentials");
            using (var key = Registry.CurrentUser.CreateSubKey(chrome)) key.SetValue("", "another-installer.json");
            data.Disconnect();
            using (var key = Registry.CurrentUser.OpenSubKey(edge)) Check((string)key.GetValue("") == "previous-public-host.json", "Earlier registration not restored");
            using (var key = Registry.CurrentUser.OpenSubKey(chrome)) Check((string)key.GetValue("") == "another-installer.json", "Another installer's registration overwritten");
            Check(File.Exists(configPath), "Disconnect removed retained data");
            Check(!data.IsConnected(), "Disconnected registration still marked connected");
            File.WriteAllText(configPath, "{\"token\":\"invalid\"}");
            Reject(delegate { data.Connect(edgeId, chromeId); }, "Corrupt existing token accepted");
            Check(File.ReadAllText(configPath) == "{\"token\":\"invalid\"}", "Invalid configuration was replaced");
            Console.WriteLine("Store connection checks passed: isolated registry, exact origins, aliases, token preservation, ACL and safe restoration.");
            return 0;
        }
        finally { Registry.CurrentUser.DeleteSubKeyTree(prefix, false); }
    }
}
