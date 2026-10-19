$ErrorActionPreference = 'Stop'
$dir = "C:\Users\hjh48\Documents\deepseek-harness\default-workspace\harness-icon"
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing, System.Windows.Forms
Add-Type -Namespace IC -Name Dpi -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
'@
[IC.Dpi]::SetProcessDPIAware() | Out-Null

$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition ([System.Windows.Automation.AutomationElement]::ClassNameProperty), "Shell_TrayWnd"
$tray = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
if (-not $tray) { throw "taskbar not found" }

$btnCond = New-Object System.Windows.Automation.PropertyCondition ([System.Windows.Automation.AutomationElement]::ControlTypeProperty), ([System.Windows.Automation.ControlType]::Button)
$buttons = $tray.FindAll([System.Windows.Automation.TreeScope]::Descendants, $btnCond)
Write-Output ("buttons: " + $buttons.Count)
$hit = $null
foreach ($b in $buttons) {
  $n = $b.Current.Name
  if ($n -match 'Harness') {
    $r = $b.Current.BoundingRectangle
    Write-Output ("FOUND name=" + $n + " rect=" + $r.X + "," + $r.Y + "," + $r.Width + "," + $r.Height)
    $hit = $r
  }
}
if ($null -eq $hit) { Write-Output "no button matched 'Harness'; names:"; foreach ($b in $buttons) { Write-Output (" - " + $b.Current.Name) } }
else {
  $pad = 6
  $x = [int]$hit.X - $pad; $y = [int]$hit.Y - $pad
  $w = [int]$hit.Width + 2 * $pad; $h = [int]$hit.Height + 2 * $pad
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size $w, $h))
  $g.Dispose()
  $big = New-Object System.Drawing.Bitmap ($w * 8), ($h * 8)
  $g2 = [System.Drawing.Graphics]::FromImage($big)
  $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
  $g2.DrawImage($bmp, 0, 0, $big.Width, $big.Height)
  $g2.Dispose()
  $big.Save("$dir\state-tile.png", [System.Drawing.Imaging.ImageFormat]::Png)
  $big.Dispose(); $bmp.Dispose()
  Write-Output "saved state-tile.png"
}
