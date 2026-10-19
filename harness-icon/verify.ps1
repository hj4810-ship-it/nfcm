$ErrorActionPreference = 'Stop'
$lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) "DeepSeek Harness.lnk"
$out = "C:\Users\hjh48\Documents\deepseek-harness\default-workspace\harness-icon\shell-icon.png"

# 1) notify shell that associations/icons changed, rebuild icon cache
Start-Process -FilePath "ie4uinit.exe" -ArgumentList "-show" -NoNewWindow -Wait -ErrorAction SilentlyContinue
Add-Type -Namespace W -Name N -MemberDefinition @'
[DllImport("shell32.dll")] public static extern void SHChangeNotify(int eventId, int flags, IntPtr item1, IntPtr item2);
'@
[W.N]::SHChangeNotify(0x08000000, 0x0000, [IntPtr]::Zero, [IntPtr]::Zero)

# 2) ask Windows itself what icon it shows for this .lnk
Add-Type -AssemblyName System.Drawing
$ico = [System.Drawing.Icon]::ExtractAssociatedIcon($lnk)
$bmp = $ico.ToBitmap()
$big = New-Object System.Drawing.Bitmap 192, 192
$g = [System.Drawing.Graphics]::FromImage($big)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
$g.DrawImage($bmp, 0, 0, 192, 192)
$g.Dispose()
$big.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$big.Dispose(); $bmp.Dispose(); $ico.Dispose()
Write-Output "shell-resolved icon exported -> $out"

# 3) report other shortcuts pointing at the same exe (start menu / taskbar pins)
$sh = New-Object -ComObject WScript.Shell
$exe = $sh.CreateShortcut($lnk).TargetPath
$startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
Get-ChildItem -Path $startMenu -Recurse -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object {
  try {
    $t = $sh.CreateShortcut($_.FullName).TargetPath
    if ($t -eq $exe) { Write-Output ("OTHER-LNK: " + $_.FullName + " | icon=" + ($sh.CreateShortcut($_.FullName).IconLocation)) }
  } catch {}
}
$pins = Join-Path $env:APPDATA "Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"
Get-ChildItem -Path $pins -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object {
  try {
    $t = $sh.CreateShortcut($_.FullName).TargetPath
    if ($t -eq $exe) { Write-Output ("TASKBAR-PIN: " + $_.FullName) }
  } catch {}
}
