# Installs git-graph and git-status, a tabs-git clone of the tabs mod with a Git button, a
# git-status block in main-wintoast's status row and ctrl-shift-g. Re-run to update.
$ErrorActionPreference = 'Stop'
$app = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME } else { "$env:USERPROFILE\.config\herdr-app" }
$herdr = "$env:LOCALAPPDATA\Programs\herdr-app\herdr-app.exe"

# Mods can't import outside their own folder: each gets its own copy of shared/.
foreach ($name in 'git-graph', 'git-status') {
    $dir = "$app\mods\$name"
    New-Item -ItemType Directory -Force $dir | Out-Null
    # mod.json first: a main.js seen without it gets the default place (right, 320 px) in the layout.
    Copy-Item "$PSScriptRoot\mods\$name\mod.json" $dir -Force
    Copy-Item "$PSScriptRoot\mods\$name\*", "$PSScriptRoot\shared\*.js" $dir -Force
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
$text = [IO.File]::ReadAllText($layout)
# Blocks Herdr auto-placed for these mods (see mod.json note above).
$text = $text -replace ',\s*\{\s*"id": "b[0-9a-f]+",\s*"type": "block",\s*"content": \{\s*"mod": "git-(graph|status)"\s*\},\s*"size": \{\s*"px": \d+\s*\}\s*\}', ''
if ($text -notmatch '"status-git"') {
    $status = [regex]'\{\s*"id": "status",\s*"type": "block",\s*"content": \{\s*"mod": "workspace-status"\s*\},\s*"size": \{\s*"px": 28\s*\}\s*\}'
    if (-not $status.IsMatch($text)) { throw "status block not found in $layout" }
    $row = '{ "id": "status", "type": "row", "size": { "px": 28 }, "children": [ ' +
        '{ "id": "status-main", "type": "block", "content": { "mod": "workspace-status" } }, ' +
        '{ "id": "status-git", "type": "block", "content": { "mod": "git-status" }, "size": { "px": 300 } } ] }'
    $text = $status.Replace($text, $row, 1)
}
$text = $text -replace '"mod": "tabs"', '"mod": "tabs-git"'
[IO.File]::WriteAllText($layout, $text)

$keys = "$app\keys.json"
$k = [IO.File]::ReadAllText($keys)
if ($k -notmatch '"ctrl-shift-g"') {
    $k = ([regex]'"global": \{').Replace($k, "`"global`": {`n    `"ctrl-shift-g`": `"git-status.open`",", 1)
    [IO.File]::WriteAllText($keys, $k)
}

foreach ($name in 'git-graph', 'git-status', 'tabs-git') {
    & $herdr check "$app\mods\$name"
    if ($LASTEXITCODE) { throw "herdr-app check $name failed" }
}
