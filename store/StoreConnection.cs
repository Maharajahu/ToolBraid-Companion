using System;
using System.Collections.Generic;
using System.IO;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using Microsoft.Win32;

internal sealed class StoreConnection
{
    internal const string HostName = "com.toolbraid.bridge";
    internal readonly string DataRoot;
    internal readonly string AliasRoot;
    private readonly string registryPrefix;
    private readonly JavaScriptSerializer json = new JavaScriptSerializer();
    private static readonly string[] Vendors = { "Microsoft\\Edge", "Google\\Chrome" };

    internal StoreConnection(string dataRoot, string aliasRoot, string registryPrefix)
    {
        DataRoot = Path.GetFullPath(dataRoot);
        AliasRoot = Path.GetFullPath(aliasRoot);
        this.registryPrefix = registryPrefix;
    }

    internal static StoreConnection ForCurrentUser()
    {
        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        return new StoreConnection(Path.Combine(local, "ToolBraid", "store"),
            Path.Combine(local, "Microsoft", "WindowsApps"), "Software");
    }

    internal string ManifestPath { get { return Path.Combine(DataRoot, HostName + ".json"); } }
    internal string ClientPath { get { return Path.Combine(DataRoot, "mcp-client.json"); } }
    private string JournalPath { get { return Path.Combine(DataRoot, "prior-registration.json"); } }
    private string RegistryPath(string vendor) { return registryPrefix + "\\" + vendor + "\\NativeMessagingHosts\\" + HostName; }

    private Dictionary<string, object> Read(string file)
    {
        return json.Deserialize<Dictionary<string, object>>(File.ReadAllText(file));
    }

    private void Write(string file, object value)
    {
        string pending = file + ".pending";
        File.WriteAllText(pending, json.Serialize(value) + "\n", new UTF8Encoding(false));
        if (File.Exists(file)) File.Replace(pending, file, null);
        else File.Move(pending, file);
    }

    internal bool IsConnected()
    {
        foreach (string vendor in Vendors)
        {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(RegistryPath(vendor)))
                if (key == null || !String.Equals(key.GetValue("") as string, ManifestPath, StringComparison.OrdinalIgnoreCase)) return false;
        }
        return File.Exists(ClientPath) && File.Exists(ManifestPath);
    }

    internal void Connect(string edgeId, string chromeId)
    {
        if (!Regex.IsMatch(edgeId ?? "", "^[a-p]{32}$") || !Regex.IsMatch(chromeId ?? "", "^[a-p]{32}$"))
            throw new InvalidOperationException("The packaged browser extension IDs are invalid.");
        string host = Path.Combine(AliasRoot, "ToolBraidNativeHost.exe");
        string mcp = Path.Combine(AliasRoot, "ToolBraidMcp.exe");
        if (!File.Exists(host) || !File.Exists(mcp))
            throw new InvalidOperationException("The Store execution aliases are unavailable. Check ToolBraid in Windows App execution aliases, then reopen the companion.");

        Directory.CreateDirectory(DataRoot);
        var security = new DirectorySecurity();
        security.SetAccessRuleProtection(true, false);
        security.AddAccessRule(new FileSystemAccessRule(WindowsIdentity.GetCurrent().User, FileSystemRights.FullControl,
            InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), FileSystemRights.FullControl,
            InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        Directory.SetAccessControl(DataRoot, security);

        string config = Path.Combine(DataRoot, "bridge-config.json");
        string token;
        if (File.Exists(config))
        {
            var existing = Read(config);
            token = existing.ContainsKey("token") ? existing["token"] as string : null;
            if (!Regex.IsMatch(token ?? "", "^[a-f0-9]{64}$"))
                throw new InvalidOperationException("Existing connection data is invalid and has been preserved. Contact support without sending the configuration file.");
        }
        else
        {
            byte[] bytes = new byte[32];
            using (RandomNumberGenerator rng = RandomNumberGenerator.Create()) rng.GetBytes(bytes);
            token = BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant();
        }
        string[] origins = edgeId == chromeId
            ? new[] { "chrome-extension://" + edgeId + "/" }
            : new[] { "chrome-extension://" + edgeId + "/", "chrome-extension://" + chromeId + "/" };
        Write(config, new { version = 1, token = token, pipe = "\\\\.\\pipe\\toolbraid-mcp-" + token.Substring(0, 32), allowedOrigin = origins[0], allowedOrigins = origins });
        Write(ManifestPath, new { name = HostName, description = "ToolBraid Store companion", path = host, type = "stdio", allowed_origins = origins });
        Write(ClientPath, new { mcpServers = new { toolbraid = new { command = mcp, args = new[] { "--mcp" } } } });

        // Save the previous public registration before replacing it; personal hosts are separate.
        if (!File.Exists(JournalPath))
        {
            var previous = new Dictionary<string, object>();
            foreach (string vendor in Vendors)
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(RegistryPath(vendor)))
                    previous[vendor] = key == null ? null : key.GetValue("") as string;
            }
            Write(JournalPath, previous);
        }
        foreach (string vendor in Vendors)
        {
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(RegistryPath(vendor)))
                key.SetValue("", ManifestPath, RegistryValueKind.String);
        }
    }

    internal void Disconnect()
    {
        if (!File.Exists(JournalPath)) return;
        var previous = Read(JournalPath);
        foreach (string vendor in Vendors)
        {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(RegistryPath(vendor), true))
            {
                if (key == null || !String.Equals(key.GetValue("") as string, ManifestPath, StringComparison.OrdinalIgnoreCase)) continue;
                string value = previous.ContainsKey(vendor) ? previous[vendor] as string : null;
                if (value == null) key.DeleteValue("", false);
                else key.SetValue("", value, RegistryValueKind.String);
            }
        }
        File.Delete(JournalPath);
    }
}
