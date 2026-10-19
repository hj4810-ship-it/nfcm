$ErrorActionPreference = 'Stop'
$out = "C:\Users\hjh48\Documents\deepseek-harness\default-workspace\harness-icon\taskbar-check2.png"

Add-Type -Namespace W5 -Name N5 -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string win);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr child, string cls, string win);
'@
[W5.N5]::SetProcessDPIAware() | Out-Null

$tray = [W5.N5]::FindWindow("Shell_TrayWnd", $null)
Write-Output ("Shell_TrayWnd: " + $tray)
$rr = New-Object W5.N5+RECT
[W5.N5]::GetWindowRect($tray, [ref]$rr) | Out-Null
Write-Output ("taskbar rect: " + $rr.Left + "," + $rr.Top + " - " + $rr.Right + "," + $rr.Bottom)

# task list buttons live in Shell_TrayWnd > ReBarWindow32 > MSTaskSwWClass (Win11: DirectUIHWND under Shell_TrayWnd)
$w = $rr.Right - $rr.Left
$h = $rr.Bottom - $rr.Top
Add-Type -AssemblyName System.Drawing
if ($w -le 0 -or $h -le 0) { throw "taskbar rect empty" }
$src = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($src)
$g.CopyFromScreen($rr.Left, $rr.Top, 0, 0, (New-Object System.Drawing.Size $w, $h))
$g.Dispose()
$big = New-Object System.Drawing.Bitmap ($w * 2), ($h * 2)
$g2 = [System.Drawing.Graphics]::FromImage($big)
$g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$g2.DrawImage($src, 0, 0, $big.Width, $big.Height)
$g2.Dispose()
$big.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$big.Dispose(); $src.Dispose()
Write-Output "saved $out ($w x $h)"
