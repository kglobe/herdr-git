# herdr-git 設計

日期：2026-11-17

## 目的

使用者在 herdr-app 裡開好幾個 Claude Code 做開發（wayne-mode、kne 會自己開分支、worktree、push、開 MR）。現在要確認「Claude 做了什麼、repo 現在長怎樣、遠端 CI 過了沒」，只能切 terminal 打 git 指令或開瀏覽器。目標是在 herdr 裡直接看到：

1. commit 樹與分支全貌（git tree view）
2. 遠端 PR / MR 與 CI pipeline 狀態，公司自架 GitLab（用 `glab`）和個人 GitHub（kglobe，用 `gh`）都要

## 目標

- 主區可開一個 `git-graph` mod pane：頁籤「Graph」「PR/MR」。
- 底部狀態列一段常駐摘要 `git-status`，點了開 / 聚焦 `git-graph` pane。
- 一個快捷鍵和右上角 Git 按鈕開 / 聚焦 `git-graph` pane。
- 跟著目前聚焦 pane 的 cwd 切 repo（跟內建 `changes`、`files` 同一套 `location()`）。

## 不做（non-goals）

- 不做 stage、commit、diff 工作區：內建 `changes` 已有。
- 不顯示分支、ahead/behind、未 commit 數：`spaces` sidebar 已有。
- 不做 merge、rebase、reset、刪分支、merge MR、rerun pipeline 這類寫入動作。第一版只讀；要動手時給「在瀏覽器開」或「複製指令」。
- 不做跨 repo 總覽，只看目前聚焦的 repo。

## 反目標（做出來也算失敗）

- 讓 repo 的 `.git` 被鎖或改動（Claude 正在同一個 repo 跑 git 時撞 index.lock）。
- 一直打 API 把 gh / glab rate limit 用完，或讓 herdr 變卡。
- 摘要列在非 git 資料夾、沒有 remote、沒登入時顯示錯誤噪音。

## 限制（herdr-app 給的）

- mod 是 JS + gpui-kit，原生 GPUI 元件；沒有 DOM、CSS、Node API、`setTimeout`。型別以 `~/.config/herdr-app/herdr.d.ts`、`gpui-kit.d.ts` 為準（每次啟動重寫）。
- 外部指令用 `exec(cmd, args, {cwd, on, timeout})`；監看檔案用 `watchFolder(dir)`；定時用 `cx.timer.every(ms, …)`。隱藏中的 mod timer 照跑，要省著用。
- 動畫用 `.frames` / `.loop`，不用 timer。
- 完成前每個 mod 都要過 `herdr-app check ~/.config/herdr-app/mods/<name>`；`init()` 裡用 `checking()` 擋掉副作用。
- 預設 mod 不能直接改，要用就照抄寫法（`changes` 的 `location()`、`READ` 參數、`diffRows`、`v_virtual_list`）。

## 方案比較（已選）

| 方案 | 取捨 |
|------|------|
| A 全放右側面板（files/changes 那排 stack） | 一直在，但 368px 太窄，commit 圖和 PR 列表都擠；stack 一次只露一個，也不算「常駐」 |
| B 全放主區 mod pane | 夠寬、可 zoom、跟 tab 一起存；但不開就看不到任何狀態 |
| C 快捷鍵叫 overlay | 不佔空間；但不能邊看邊對 Claude 下指令 |

選 **B 為主 + 一條常駐摘要**。使用者同意這個建議。commit 圖需要寬度，所以放主區；摘要列只放 sidebar 沒有的資訊，點了進 B。

## 設計

### 1. `git-graph`（主區 mod pane）

開法：快捷鍵 `ctrl-shift-g` 綁 `git-status.open`，由常駐的 `git-status` 判斷：同 tab 已有 `git-graph` 就聚焦，沒有就 `pane.split {direction:"right", mod:"git-graph"}`。只開或聚焦，不做 toggle 關閉。摘要列點擊、右上角 Git 按鈕同樣行為。

右上角按鈕：內建 `tabs` 的 Files / Changes 按鈕是寫死的，沒有插入點。`install.ps1` 把內建 `tabs` 複製成 `tabs-git`，在 Changes 後面插一顆 Git 按鈕（樣式照抄 `panelButton`，git-graph 在目前 tab 開著時高亮），layout 的 `tabs` block 改用 `tabs-git`。**（使用者選定。代價：herdr 更新 tabs 後要重跑 install.ps1；插入點找不到時 install 要報錯，不能默默裝一份沒按鈕的。）****（`pane.split` 直接綁快捷鍵每按一次就多開一個，`<mod>.<command>` 只送得到顯示中的 mod，所以要靠常駐的 git-status 轉接。）**

看哪個 repo：記住最後一個聚焦的非 mod pane 的 cwd。mod pane 的 `PaneInfo.cwd` 是 null，照抄 `location()` 會在點進 graph 時跳回 space 根目錄。遠端 machine 的 space（`on` 不為 null）第一版不支援，留白。

**Graph 頁籤**

```
● a1b2c3  fix(hooks): gate-check …          ⬆ 未push
● d4e5f6  feat(project-event): …   main origin/main
│ ● 9f8e7d  wip …                   wayne/xx  [已合併，可刪]
├─╯
● 1234ab  …
```

- 資料：`git log --graph --all --date-order --format=<固定分隔欄位> -n 300`，用 `changes` 的 `READ` 參數（不碰 index、不加鎖）。
- 每列：圖形欄、短 hash、標題、ref 標籤（本機分支、遠端分支、tag、HEAD）。
- 標記：還沒 push 的 commit（`@{u}..HEAD` 及各分支相對其 upstream）；已合併進預設分支、可刪的分支（`git branch --merged <default>`，排除預設分支本身與目前分支）。
- worktree：頂端一行列出 `git worktree list --porcelain` 的路徑與分支，點了用 `space` 相關指令跳過去（或開 worktree）——細節見「留給實作者」。
- 點一列：下半部顯示該 commit 的 `git show --stat` 加 diff，畫法照抄 `changes` 的 `diffRows` + `v_virtual_list`。
- 窄寬時（pane 未 zoom）只顯示圖形 + 標題 + 標記；hash、作者、相對時間在寬度夠時才出現。
- 刷新：`watchFolder(<git rev-parse --git-common-dir>)` 有變就重讀（linked worktree 的 `.git` 是檔案；Windows 會遞迴監看 objects，debounce 一定要做）；切換聚焦 repo 時重讀。

**PR/MR 頁籤**

- 依 `git remote get-url origin` 判斷：host 為 `github.com` 用 `gh`，`gitlab.com` 或 `git config herdr.gitlab-host` 列出的主機用 `glab`，其他 host 顯示「不支援的遠端」。
- GitHub：`gh pr list --json number,title,headRefName,state,isDraft,reviewDecision,statusCheckRollup,url`；`gh run list --json …` 取目前分支最近幾次 CI。
- GitLab：`glab mr list -F json`、`glab ci list -F json`（目前分支最近 pipeline）。
- 每列：編號、標題、分支、CI 狀態圖示（過 / 失敗 / 跑中 / 無）、review 狀態。點一列用系統瀏覽器開 URL。
- 刷新：pane 存在就每 60 秒一次，加手動重新整理按鈕。herdr 沒有可見性事件，自己推算「是否顯示」太複雜，第一版不做。

### 2. `git-status`（右側常駐摘要列）

- 位置：layout `main-wintoast.json` 底部 `status` 列，跟 `workspace-status` 並排（status 改成 row，git-status 靠右）。**（使用者選定。右側 `panel` 預設 `hidden: true`，放那裡平常看不到，快捷鍵轉接也會失效。）**
- 內容只放 sidebar 沒有的：可刪分支數、目前分支的 PR/MR（編號 + CI 圖示）、目前分支最近 pipeline 狀態。例：`MR !12 ✗ CI · 2 分支可刪`。
- 沒東西可說時顯示淡色的 `git` 字樣當按鈕；非 git 資料夾整列空白。
- 資料與 `git-graph` 共用（`setShared` / `shared`，key 按 repo 分；`setShared` 會寫檔並讓所有 mod 重繪，只在資料真的變了才寫），避免兩邊各打一次 API；`git-graph` 沒開時由 `git-status` 自己以 120 秒間隔查遠端。
- 點擊：開 / 聚焦 `git-graph` pane。

### 3. 安裝與 repo

- 新 repo `D:\GitHub\herdr-git`（個人 GitHub，private，比照 `herdr-notify-win`）。**（我的決定）**
- 結構：`mods/git-graph/`、`mods/git-status/`（`tabs-git` 不進 repo，install 時從內建 tabs 產生）、共用 `mods/git-graph/shared.js` 若需要；`install.ps1` 把 mods 複製到 `~/.config/herdr-app/mods/`，並在 `layouts/main-wintoast.json` 的 `status` 列插入 `git-status` block、在 `keys.json` 加 `ctrl-shift-g` → `git-status.open`（已存在就不重複加）。
- 每個 mod 過 `herdr-app check`。

## 留給實作者

- `git log --graph` 輸出解析：圖形欄與欄位分隔的寫法、`--all` 在 ref 很多時的效能（300 筆上限可調）。
- 「若已開則聚焦」怎麼找到既有 pane（`panes()` 裡找 `mod === "git-graph"` 的同 tab pane）。
- `pane` 型 mod 能不能從 `props().pane` 拿到自己的 pane id（拿得到的話聚焦判斷比較簡單）。
- worktree 列點擊的行為：跳到已開的 space，或用內建 `worktree` mod 的 open 流程。
- 預設分支的判斷（`origin/HEAD`，取不到再試 `main`、`master`）。
- gh / glab 失敗（沒登入、網路斷、不在公司網段）時的顯示：一行灰字，不 toast。
- 瀏覽器開 URL 的方式（`exec("cmd", ["/c","start","",url])` 或 herdr 有現成指令）。
