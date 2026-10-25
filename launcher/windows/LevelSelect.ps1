# Level Select for Windows: starts the local library, opens it in your browser and keeps an
# icon in the notification area (by the clock) to open a section or stop Level Select.
# The installer puts this file in <install>\app\launcher\windows, next to its own Node.js
# (<install>\runtime\node) and Python (<install>\runtime\python).
# Kept to plain ASCII: Windows PowerShell 5 reads scripts without a byte-order mark as ANSI.
param([string]$Route = 'library/backlog.html')

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$app = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$install = Split-Path -Parent $app
$node = Join-Path $install 'runtime\node\node.exe'
$control = Join-Path $app 'scripts\library-control.mjs'
$env:LEVEL_SELECT_PYTHON = Join-Path $install 'runtime\python\python.exe'
# The installed app has its own address, so its browser data never mixes with a copy run
# from the project folder (port 8765).
$env:RETRO_LIBRARY_PORT = '8790'
$base = 'http://127.0.0.1:8790/'

function Show-Problem([string]$text) {
  [void][System.Windows.Forms.MessageBox]::Show($text, 'Level Select', 'OK', 'Warning')
}

# Runs scripts\library-control.mjs (start, stop or status) without a console window.
function Invoke-Library([string]$action) {
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $node
  $info.Arguments = '"' + $control + '" ' + $action
  $info.WorkingDirectory = $app
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $process = [System.Diagnostics.Process]::Start($info)
  $output = $process.StandardOutput.ReadToEnd() + $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  return @{ Code = $process.ExitCode; Text = ($output -replace '^(RUNNING|STOPPED|BLOCKED|ERROR) ', '').Trim() }
}

function Start-Library {
  $result = Invoke-Library 'start'
  if ($result.Code -eq 0) { return $true }
  if ($result.Code -eq 4) { Show-Problem "Level Select couldn't start: another program is using its address (port 8790). Close that program and try again." }
  else { Show-Problem ("Level Select couldn't start.`n`n" + $result.Text + "`n`nDetails are in " + (Join-Path $app '.runtime\library-server.log')) }
  return $false
}

# Opens a section, starting the library again first if it has stopped.
function Open-Section([string]$route) {
  if ((Invoke-Library 'status').Code -ne 0 -and -not (Start-Library)) { return }
  Start-Process ($base + $route)
}

# One icon at a time: opening Level Select again just shows it in the browser.
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\LevelSelectTray', [ref]$created)
if (-not $created) {
  Open-Section $Route
  exit 0
}

if (-not (Test-Path $node)) { Show-Problem 'Level Select is incomplete (Node.js is missing). Please install it again.'; exit 1 }
if (-not (Start-Library)) { exit 1 }
Start-Process ($base + $Route)

$icon = New-Object System.Windows.Forms.NotifyIcon
$icon.Icon = New-Object System.Drawing.Icon (Join-Path $install 'LevelSelect.ico')
$icon.Text = 'Level Select'
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$context = New-Object System.Windows.Forms.ApplicationContext

function Add-Section([string]$label, [string]$route) {
  $item = $menu.Items.Add($label)
  $item.Tag = $route
  $item.add_Click({ param($sender) Open-Section $sender.Tag })
  return $item
}
$play = Add-Section 'Play' 'library/backlog.html'
$play.Font = New-Object System.Drawing.Font($play.Font, [System.Drawing.FontStyle]::Bold)
[void](Add-Section 'Library' 'library/index.html')
[void](Add-Section 'Wishlist' 'library/wishlist.html')
[void](Add-Section 'Game Atlas' 'index.html')
[void](Add-Section 'Import games' 'library/sources.html')
[void]$menu.Items.Add('-')
$stop = $menu.Items.Add('Stop Level Select')
$stop.add_Click({
  $result = Invoke-Library 'stop'
  if ($result.Code -ne 0 -and $result.Code -ne 3) { Show-Problem ("Level Select couldn't stop.`n`n" + $result.Text); return }
  $icon.Visible = $false
  $icon.Dispose()
  $context.ExitThread()
})

$icon.ContextMenuStrip = $menu
$icon.add_MouseClick({ param($sender, $click) if ($click.Button -eq [System.Windows.Forms.MouseButtons]::Left) { Open-Section 'library/backlog.html' } })
$icon.Visible = $true
$icon.ShowBalloonTip(6000, 'Level Select is running', 'It opened in your browser. Click this icon to open it again; right-click to stop it.', [System.Windows.Forms.ToolTipIcon]::Info)

[System.Windows.Forms.Application]::Run($context)
$mutex.ReleaseMutex()
