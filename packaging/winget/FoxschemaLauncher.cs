// Minimal Win32 launcher: runs `node <installDir>\dist\index.js` with forwarded args.
// Built by packaging/winget/build-portable.ps1 via `csc` on windows-latest.
using System;
using System.Diagnostics;
using System.IO;
using System.Text;

internal static class Program
{
    private static int Main(string[] args)
    {
        var root = AppContext.BaseDirectory;
        var script = Path.Combine(root, "dist", "index.js");
        if (!File.Exists(script))
        {
            Console.Error.WriteLine("foxschema: missing dist\\index.js next to the executable.");
            Console.Error.WriteLine("Expected: " + script);
            return 1;
        }

        var argBuilder = new StringBuilder();
        argBuilder.Append('"').Append(script).Append('"');
        foreach (var a in args)
        {
            argBuilder.Append(' ');
            argBuilder.Append('"').Append(a.Replace("\"", "\\\"")).Append('"');
        }

        var psi = new ProcessStartInfo
        {
            FileName = "node",
            Arguments = argBuilder.ToString(),
            UseShellExecute = false,
            WorkingDirectory = root,
        };

        try
        {
            using var proc = Process.Start(psi);
            if (proc == null)
            {
                Console.Error.WriteLine("foxschema: failed to start node. Is Node.js on PATH?");
                return 1;
            }
            proc.WaitForExit();
            return proc.ExitCode;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("foxschema: " + ex.Message);
            Console.Error.WriteLine("Install Node.js LTS (22.5+) or: winget install OpenJS.NodeJS.LTS");
            return 1;
        }
    }
}
