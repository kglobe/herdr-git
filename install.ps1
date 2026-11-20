# Installs git-graph and git-status, a tabs-git clone of the tabs mod with a Git button, a
# git-status block in main-wintoast's status row and ctrl-shift-g. Re-run to update.
$ErrorActionPreference = 'Stop'
$app = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME } else { "$env:USERPROFILE\.config\herdr-app" }
$herdr = "$env:LOCALAPPDATA\Programs\herdr-app\herdr-app.exe"

# Mods can't import outside their own folder: each gets its own copy of shared/.
foreach ($name in 'git-graph', 'git-status') {
    $dir = "$app\mods\$name"
    # A new mod folder whose main.js Herdr sees before mod.json gets the default place (right, 320 px)
    # in the layout: build it outside mods\ and move it in whole.
    $to = if (Test-Path $dir) { $dir } else { New-Item -ItemType Directory -Force "$app\.staging-$name" }
    Copy-Item "$PSScriptRoot\mods\$name\main.js", "$PSScriptRoot\mods\$name\mod.json", "$PSScriptRoot\mods\$name\*.svg", "$PSScriptRoot\shared\*.js" $to -Force
    if ("$to" -ne $dir) { Move-Item $to $dir }
}

# tabs-git: a fresh clone of the built-in tabs each run, so tabs updates carry over.
$tabs = "$app\mods\tabs-git"
if (Test-Path $tabs) { Remove-Item $tabs -Recurse -Force }
& $herdr do mod.clone --name tabs --as tabs-git | Out-Null
if ($LASTEXITCODE) { throw 'mod.clone tabs failed' }
Copy-Item "$PSScriptRoot\mods\tabs-git\git.svg" $tabs -Force
$main = "$tabs\main.js"
$js = [IO.File]::ReadAllText($main)
$anchor = '.when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))'
if (-not $js.Contains($anchor)) { throw "tabs main.js changed: anchor not found in $main" }
$button = @'

      .child((on => h_flex().id("panel-git").h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", stop).on_click(() => run("git-status.open"))
        .child(svg("mods/tabs-git/git.svg").size(14)).child("Git"))(panes().some(p => p.mod === "git-graph" && p.tab === selected)))
'@
[IO.File]::WriteAllText($main, $js.Replace($anchor, $anchor + $button.TrimEnd()))

$layout = "$app\layouts\main-wintoast.json"
if (-not (Test-Path $layout)) { throw "$layout not found: run herdr-notify-win's install.ps1 first" }
function Get-Nodes($node) { $node; foreach ($c in @($node.children)) { if ($null -ne $c) { Get-Nodes $c } } }
# [IO.File] reads and writes UTF-8 (no BOM) in both pwsh and Windows PowerShell 5.1, whose Get/Set-Content use ANSI.
$root = [IO.File]::ReadAllText($layout) | ConvertFrom-Json
$nodes = @(Get-Nodes $root)
# The status block becomes a row: workspace-status, then git-status at 300 px.
$status = $nodes | Where-Object id -eq 'status'
if (-not $status) { throw "status node not found in $layout" }
if (-not ($nodes | Where-Object id -eq 'status-git')) {
    $left = [pscustomobject]@{ id = 'status-main'; type = 'block'; content = $status.content }
    $right = [pscustomobject]@{ id = 'status-git'; type = 'block'; content = @{ mod = 'git-status' }; size = @{ px = 300 } }
    $status.PSObject.Properties.Remove('content')
    $status.type = 'row'
    $status | Add-Member children @($left, $right)
}
$nodes | Where-Object { $_.content.mod -eq 'tabs' } | ForEach-Object { $_.content.mod = 'tabs-git' }
[IO.File]::WriteAllText($layout, ($root | ConvertTo-Json -Depth 100))

$keys = "$app\keys.json"
$k = [IO.File]::ReadAllText($keys) | ConvertFrom-Json
if (-not $k.global.'ctrl-shift-g') {
    $k.global | Add-Member 'ctrl-shift-g' 'git-status.open'
    [IO.File]::WriteAllText($keys, ($k | ConvertTo-Json -Depth 100))
}

foreach ($name in 'git-graph', 'git-status', 'tabs-git') {
    & $herdr check "$app\mods\$name"
    if ($LASTEXITCODE) { throw "herdr-app check $name failed" }
}

# agent-home keeps its Repos and Progress buttons in tabs-git, which was just rebuilt without them:
# its installer (home.json's root says where) puts them back. It needs pwsh 7.
$homeRepo = "$app\mods\home-repo\home.json"
if (Test-Path $homeRepo) {
    $again = Join-Path ([IO.File]::ReadAllText($homeRepo) | ConvertFrom-Json).root 'herdr\install.ps1'
    if (Test-Path $again) {
        pwsh -NoProfile -File $again
        if ($LASTEXITCODE) { throw "$again failed" }
    }
}
