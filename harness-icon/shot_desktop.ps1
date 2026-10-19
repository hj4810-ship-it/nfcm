$ErrorActionPreference = 'Stop'
$out = "C:\Users\hjh48\Documents\deepseek-harness\default-workspace\harness-icon\desktop-icons.png"

Add-Type -Namespace W7 -Name N7 -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string w);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr p, IntPtr c, string cls, string win);
[DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
[DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
'@
[W7.N7]::SetProcessDPIAware() | Out-Null

$progman = [W7.N7]::FindWindow("Progman", $null)
$defview = [W7.N7]::FindWindowEx($progman, [IntPtr]::Zero, "SHELLDLL_DefView", $null)
if ($defview -eq [IntPtr]::Zero) {
  # Win11: desktop list lives under a WorkerW
  $w = [IntPtr]::Zero
  do {
    $w = [W7.N7]::FindWindowEx([IntPtr]::Zero, $w, "WorkerW", $null)
    if ($w -ne [IntPtr]::Zero) {
      $dv = [W7.N7]::FindWindowEx($w, [IntPtr]::Zero, "SHELLDLL_DefView", $null)
      if ($dv -ne [IntPtr]::Zero) { $defview = $dv; break }
    }
  } while ($w -ne [IntPtr]::Zero)
}
Write-Output "Progman=$progman DefView=$defview"

$r = New-Object W7.N7+RECT
[W7.N7]::GetClientRect($defview, [ref]$r) | Out-Null
$w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
Write-Output "defview client: $w x $h"

Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
[W7.N7]::PrintWindow($defview, $hdc, 2) | Out-Null
$g.ReleaseHdc($hdc); $g.Dispose()

# the shortcut sits in the top-left cluster; crop the left 420 x top 420 logical px
$crop = $bmp.Clone((New-Object System.Drawing.Rectangle 0, 0, [Math]::Min(460, $w), [Math]::Min(460, $h)), $bmp.PixelFormat)
$zoom = New-Object System.Drawing.Bitmap ($crop.Width * 2), ($crop.Height * 2)
$g2 = [System.Drawing.Graphics]::FromImage($zoom)
$g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$g2.DrawImage($crop, 0, 0, $zoom.Width, $zoom.Height)
$g2.Dispose()
$zoom.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$zoom.Dispose(); $crop.Dispose(); $bmp.Dispose()
Write-Output "saved $out"
