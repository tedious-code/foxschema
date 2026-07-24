import { homedir, platform } from 'node:os';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import chalk from 'chalk';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

function resolveFoxschemaBin(): string {
  // Prefer the running binary (npm link / global install).
  try {
    const bin = process.argv[1];
    if (bin && existsSync(bin)) return resolve(bin);
  } catch {
    /* ignore */
  }
  const which = spawnSync(platform() === 'win32' ? 'where' : 'which', ['foxschema'], {
    encoding: 'utf8',
    shell: platform() === 'win32',
  });
  const line = (which.stdout || '').trim().split(/\r?\n/)[0];
  if (line && existsSync(line)) return line;
  throw new Error(
    'Could not find the `foxschema` executable on PATH. Install or link it first (`npm i -g foxschema` / `npm link -w @foxschema/cli`).'
  );
}

function resolveIconDir(): string {
  const candidates = [
    // Bundled CLI: dist/index.js → ../resources/icons
    join(here, '..', 'resources', 'icons'),
    // tsx from src/commands: ../../resources/icons
    join(here, '..', '..', 'resources', 'icons'),
    // Monorepo desktop icons
    resolve(here, '..', '..', '..', 'desktop', 'src-tauri', 'icons'),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, 'icon.icns')) || existsSync(join(dir, 'icon.png'))) {
      return dir;
    }
  }
  try {
    const web = dirname(require.resolve('@foxschema/web/package.json'));
    const desktopIcons = resolve(web, '..', 'desktop', 'src-tauri', 'icons');
    if (existsSync(join(desktopIcons, 'icon.icns'))) return desktopIcons;
  } catch {
    /* ignore */
  }
  throw new Error('Fox icon assets not found (resources/icons).');
}

function desktopDir(): string {
  const home = homedir();
  if (platform() === 'win32') {
    return process.env.USERPROFILE
      ? join(process.env.USERPROFILE, 'Desktop')
      : join(home, 'Desktop');
  }
  // macOS / Linux
  const desk = join(home, 'Desktop');
  if (existsSync(desk)) return desk;
  // Some Linux setups use XDG
  const xdg = process.env.XDG_DESKTOP_DIR;
  if (xdg && existsSync(xdg)) return xdg;
  return desk;
}

function installMacApp(bin: string, iconDir: string, destDir: string): string {
  const appName = 'Fox Schema.app';
  const appPath = join(destDir, appName);
  const contents = join(appPath, 'Contents');
  const macos = join(contents, 'MacOS');
  const resources = join(contents, 'Resources');
  mkdirSync(macos, { recursive: true });
  mkdirSync(resources, { recursive: true });

  const icns = join(iconDir, 'icon.icns');
  if (existsSync(icns)) cpSync(icns, join(resources, 'AppIcon.icns'));

  const launcher = join(macos, 'FoxSchema');
  // Open UI: if server already running (user closed browser without stop), just reopen.
  writeFileSync(
    launcher,
    `#!/bin/bash
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | tail -1)/bin:$PATH"
BIN=${JSON.stringify(bin)}
if [ -x "$BIN" ]; then
  exec "$BIN" open "$@"
fi
# Fallback: node + linked script
if command -v foxschema >/dev/null 2>&1; then
  exec foxschema open "$@"
fi
osascript -e 'display alert "Fox Schema" message "foxschema was not found. Install with: npm install -g foxschema" as critical'
exit 1
`,
    { mode: 0o755 }
  );
  chmodSync(launcher, 0o755);

  writeFileSync(
    join(contents, 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Fox Schema</string>
  <key>CFBundleDisplayName</key><string>Fox Schema</string>
  <key>CFBundleIdentifier</key><string>com.foxschema.launcher</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleExecutable</key><string>FoxSchema</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`
  );

  // Clear quarantine so double-click works without Gatekeeper friction for a local app.
  spawnSync('xattr', ['-dr', 'com.apple.quarantine', appPath], { stdio: 'ignore' });
  return appPath;
}

function installWindowsShortcut(bin: string, iconDir: string, destDir: string): string {
  const lnk = join(destDir, 'Fox Schema.lnk');
  const ico = join(iconDir, 'icon.ico');
  const iconPath = existsSync(ico) ? ico : '';
  // node.exe runs the CLI script; TargetPath must be an .exe for a clean shortcut.
  const nodeExe = process.execPath;
  const args = `${JSON.stringify(bin)} open`;
  const ps = `
$W = New-Object -ComObject WScript.Shell
$S = $W.CreateShortcut(${JSON.stringify(lnk)})
$S.TargetPath = ${JSON.stringify(nodeExe)}
$S.Arguments = ${JSON.stringify(args)}
$S.WorkingDirectory = ${JSON.stringify(homedir())}
$S.WindowStyle = 7
$S.Description = "Open Fox Schema (starts or reopens the local UI)"
${iconPath ? `$S.IconLocation = ${JSON.stringify(iconPath + ',0')}` : ''}
$S.Save()
`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], {
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    throw new Error(`Failed to create shortcut: ${r.stderr || r.stdout}`);
  }
  return lnk;
}

function installLinuxDesktop(bin: string, iconDir: string, destDir: string): string {
  const png = existsSync(join(iconDir, '128x128.png'))
    ? join(iconDir, '128x128.png')
    : join(iconDir, 'icon.png');
  const desk = join(destDir, 'foxschema.desktop');
  writeFileSync(
    desk,
    `[Desktop Entry]
Type=Application
Name=Fox Schema
Comment=Open Fox Schema local UI
Exec=${bin} open
Icon=${png}
Terminal=false
Categories=Development;Database;
`
  );
  chmodSync(desk, 0o755);
  return desk;
}

export interface ShortcutOptions {
  /** Override destination directory (default: Desktop). */
  dir?: string;
}

/**
 * Install a Desktop shortcut/app with the Fox icon that runs `foxschema open`.
 * Clicking it starts the UI server if needed, or just reopens the browser when
 * the server is still running after the user closed the window without `stop`.
 */
export async function runShortcut(opts: ShortcutOptions = {}): Promise<void> {
  const bin = resolveFoxschemaBin();
  const iconDir = resolveIconDir();
  const dest = opts.dir ? resolve(opts.dir) : desktopDir();
  mkdirSync(dest, { recursive: true });

  let path: string;
  const p = platform();
  if (p === 'darwin') path = installMacApp(bin, iconDir, dest);
  else if (p === 'win32') path = installWindowsShortcut(bin, iconDir, dest);
  else path = installLinuxDesktop(bin, iconDir, dest);

  console.log(chalk.green.bold('✔ Desktop shortcut installed'));
  console.log(`  ${path}`);
  console.log(
    chalk.dim(
      'Double-click the Fox icon to open the UI. If you closed the browser without `foxschema stop`, this reopens it.'
    )
  );
}
