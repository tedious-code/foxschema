// Minimal Win32 launcher: runs `node <installDir>\dist\index.js` with forwarded args.
// Must compile with older Roslyn/csc on GitHub windows-latest (avoid C# 8+ syntax).
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;

internal static class Program
{
    private static int Main(string[] args)
    {
        string root = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        string script = Path.Combine(root, "dist", "index.js");
        if (!File.Exists(script))
        {
            Console.Error.WriteLine("foxschema: missing dist\\index.js next to the executable.");
            Console.Error.WriteLine("Expected: " + script);
            return 1;
        }

        StringBuilder argBuilder = new StringBuilder();
        argBuilder.Append('"').Append(script).Append('"');
        for (int i = 0; i < args.Length; i++)
        {
            argBuilder.Append(' ');
            argBuilder.Append('"').Append(args[i].Replace("\"", "\\\"")).Append('"');
        }

        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = "node";
        psi.Arguments = argBuilder.ToString();
        psi.UseShellExecute = false;
        psi.WorkingDirectory = root;

        Process proc = null;
        try
        {
            proc = Process.Start(psi);
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
        finally
        {
            if (proc != null)
            {
                proc.Dispose();
            }
        }
    }
}
