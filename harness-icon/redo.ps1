$ErrorActionPreference = 'Stop'
$dir = "C:\Users\hjh48\Documents\deepseek-harness\default-workspace\harness-icon"
$ico = Join-Path $env:LOCALAPPDATA "DeepSeekHarness\icons\harness-chibi.ico"

$lnks = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) "DeepSeek Harness.lnk"),
  (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\DeepSeek Harness.lnk"),
  (Join-Path $env:APPDATA "Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\DeepSeek Harness.lnk")
)

$sh = New-Object -ComObject WScript.Shell
foreach ($lnk in $lnks) {
  if (-not (Test-Path -LiteralPath $lnk)) { Write-Output "MISSING: $lnk"; continue }
  $s = $sh.CreateShortcut($lnk)
  $s.IconLocation = "$ico,0"
  $s.Save()
  $v = $sh.CreateShortcut($lnk)
  Write-Output ("OK  {0}`n    icon={1}`n    target={2}" -f $lnk, $v.IconLocation, $v.TargetPath)
}

# tell the shell about the change and rebuild the icon cache
Start-Process -FilePath "ie4uinit.exe" -ArgumentList "-show" -NoNewWindow -Wait -ErrorAction SilentlyContinue
Add-Type -Namespace IconFix -Name Shell -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
[DllImport("shell32.dll", CharSet = CharSet.Unicode)] public static extern void SHChangeNotify(int eventId, int flags, string item1, IntPtr item2);
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string win);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
'@
foreach ($lnk in $lnks) { [IconFix.Shell]::SHChangeNotify(0x00002000, 0x0001, $lnk, [IntPtr]::Zero) }
[IconFix.Shell]::SHChangeNotify(0x08000000, 0x0000, $null, [IntPtr]::Zero)
Start-Sleep -Seconds 3

# capture taskbar
[IconFix.Shell]::SetProcessDPIAware() | Out-Null
$tray = [IconFix.Shell]::FindWindow("Shell_TrayWnd", $null)
$r = New-Object IconFix.Shell+RECT
[IconFix.Shell]::GetWindowRect($tray, [ref]$r) | Out-Null
Add-Type -AssemblyName System.Drawing
$w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
if ($w -le 0) { throw "taskbar rect empty" }
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object System.Drawing.Size $w, $h))
$g.Dispose()
$bmp.Save("$dir\state-taskbar.png", [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output ("taskbar captured: {0}x{1}" -f $w, $h)
