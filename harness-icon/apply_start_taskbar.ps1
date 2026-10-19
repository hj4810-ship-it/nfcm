$ErrorActionPreference = 'Stop'
$dir  = Join-Path $env:LOCALAPPDATA "DeepSeekHarness\icons"
$ico  = Join-Path $dir "harness-chibi.ico"
$sh   = New-Object -ComObject WScript.Shell

$targets = @(
  (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\DeepSeek Harness.lnk"),
  (Join-Path $env:APPDATA "Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\DeepSeek Harness.lnk")
)

foreach ($t in $targets) {
  if (-not (Test-Path -LiteralPath $t)) { Write-Output "MISSING: $t"; continue }
  $item = Get-Item -LiteralPath $t
  $bak  = Join-Path $dir ($item.BaseName + "." + $item.Directory.Name + ".lnk.bak")
  Copy-Item -LiteralPath $t -Destination $bak -Force

  $s = $sh.CreateShortcut($t)
  $beforeExe   = $s.TargetPath
  $beforeIcon  = $s.IconLocation
  $s.IconLocation = "$ico,0"
  $s.Save()

  $v = $sh.CreateShortcut($t)
  Write-Output "LNK    : $t"
  Write-Output "  before icon: $beforeIcon"
  Write-Output "  after  icon: $($v.IconLocation)"
  Write-Output "  target kept: $($v.TargetPath)  [same=$($v.TargetPath -eq $beforeExe)]"
  Write-Output "  backup     : $bak"
  Write-Output ""
}
