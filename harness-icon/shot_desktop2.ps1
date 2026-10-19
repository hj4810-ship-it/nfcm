$ErrorActionPreference = 'Stop'
$dir = "C:\Users\hjh48\Documents\deepseek-harness\default-workspace\harness-icon"
Add-Type -Namespace IC2 -Name W -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
public delegate bool EnumProc(IntPtr h, IntPtr p);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr p, IntPtr c, string cls, string win);
[DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
[DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
'@
[IC2.W]::SetProcessDPIAware() | Out-Null

$script:found = @{}
$cb = [IC2.W+EnumProc]{
  param($h, $p)
  $sb = New-Object System.Text.StringBuilder 256
  [IC2.W]::GetClassName($h, $sb, 256) | Out-Null
  $c = $sb.ToString()
  if ($c -in @('Progman', 'WorkerW')) { $script:found[$c] = $h }
  return $true
}
[IC2.W]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
$script:found.GetEnumerator() | ForEach-Object { Write-Output ("class=" + $_.Key + " hwnd=" + $_.Value) }

$defview = [IntPtr]::Zero
foreach ($k in @('Progman', 'WorkerW')) {
  if ($script:found.ContainsKey($k)) {
    $dv = [IC2.W]::FindWindowEx($script:found[$k], [IntPtr]::Zero, "SHELLDLL_DefView", $null)
    if ($dv -ne [IntPtr]::Zero) { $defview = $dv; Write-Output ("DefView under " + $k + ": " + $dv); break }
  }
}
if ($defview -eq [IntPtr]::Zero) { Write-Output "DefView not found"; exit 0 }

$r = New-Object IC2.W+RECT
[IC2.W]::GetClientRect($defview, [ref]$r) | Out-Null
$w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
Write-Output "defview size: $w x $h"
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
[IC2.W]::PrintWindow($defview, $hdc, 2) | Out-Null
$g.ReleaseHdc($hdc); $g.Dispose()

$cropW = [Math]::Min(900, $w); $cropH = [Math]::Min(900, $h)
$crop = $bmp.Clone((New-Object System.Drawing.Rectangle 0, 0, $cropW, $cropH), $bmp.PixelFormat)
$crop.Save("$dir\state-desktop.png", [System.Drawing.Imaging.ImageFormat]::Png)
$crop.Dispose(); $bmp.Dispose()
Write-Output "saved state-desktop.png"
