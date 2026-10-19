$ErrorActionPreference = 'Stop'
$deskDir = "C:\Users\hjh48\Documents\deepseek-harness\default-workspace\harness-icon"

Start-Process -FilePath "ie4uinit.exe" -ArgumentList "-show" -NoNewWindow -Wait -ErrorAction SilentlyContinue

Add-Type -Namespace W3 -Name N3 -MemberDefinition @'
[DllImport("shell32.dll", CharSet = CharSet.Unicode)] public static extern void SHChangeNotify(int e, int f, string p1, IntPtr p2);
'@

$targets = @(
  (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\DeepSeek Harness.lnk"),
  (Join-Path $env:APPDATA "Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\DeepSeek Harness.lnk")
)
foreach ($t in $targets) { [W3.N3]::SHChangeNotify(0x00002000, 0x0001, $t, [IntPtr]::Zero) }
[W3.N3]::SHChangeNotify(0x08000000, 0x0000, $null, [IntPtr]::Zero)
Start-Sleep -Milliseconds 800

# screenshot the taskbar strip of the primary screen
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$h = 64
$rect = New-Object System.Drawing.Rectangle 0, ($b.Height - $h), $b.Width, $h
$bmp = New-Object System.Drawing.Bitmap $rect.Width, $rect.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $rect.Size)
$g.Dispose()
$big = New-Object System.Drawing.Bitmap ($rect.Width * 2), ($rect.Height * 2)
$g2 = [System.Drawing.Graphics]::FromImage($big)
$g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$g2.DrawImage($bmp, 0, 0, $big.Width, $big.Height)
$g2.Dispose()
$big.Save((Join-Path $deskDir "taskbar-check.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$big.Dispose(); $bmp.Dispose()
Write-Output ("screenshot: " + $rect.Width + "x" + $rect.Height + " saved")

# what icon the shell resolves for each lnk now
foreach ($t in $targets) {
  $ic = [System.Drawing.Icon]::ExtractAssociatedIcon($t)
  $tb = $ic.ToBitmap()
  Write-Output ("resolved " + $t + " -> " + $tb.Width + "x" + $tb.Height)
  $tb.Dispose(); $ic.Dispose()
}
