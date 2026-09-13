using System;
using System.IO;
using System.Reflection;

// Test-only host: execute the real compiled launcher against disposable connection data.
internal static class StoreLauncherHarness
{
    private static int Main(string[] args)
    {
        if (args.Length < 2) return 90;
        var launcher = Assembly.LoadFrom(args[0]).GetType("ToolBraidNativeHostLauncher", true);
        var flags = BindingFlags.NonPublic | BindingFlags.Static;
        string root = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, ".."));
        if ((string)launcher.GetField("NodePath", flags).GetValue(null) != Path.Combine(root, "runtime", "node.exe")) return 91;
        if ((string)launcher.GetField("HostScriptPath", flags).GetValue(null) != Path.Combine(root, "bridge", "native-host.mjs")) return 92;
        var config = launcher.GetField("ConfigPath", flags);
        string expected = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ToolBraid", "store", "bridge-config.json");
        if ((string)config.GetValue(null) != expected) return 93;
        // No production override or real Store configuration is used by these tests.
        string fixture = Path.GetFullPath(args[1]);
        if (!fixture.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) return 94;
        config.SetValue(null, fixture);
        var callerArguments = new string[args.Length - 2];
        Array.Copy(args, 2, callerArguments, 0, callerArguments.Length);
        return (int)launcher.GetMethod("Main").Invoke(null, new object[] { callerArguments });
    }
}
