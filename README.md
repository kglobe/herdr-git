# herdr-git

給 herdr-app 用的兩個 mod，在 Herdr 裡看目前 repo 的 git 狀態。全部唯讀，不會寫進 `.git`。

- git-graph：主區的面板，有 Graph、PR/MR、Issue 三個分頁。
- git-status：底部狀態列右邊的摘要，例如 `MR !12 ✗ · CI ● · 2 分支可刪`。

## 安裝

### 需要先準備

- Windows 版 herdr-app，裝在預設位置 `%LOCALAPPDATA%\Programs\herdr-app`
- 跑過 herdr-notify-win 的 install.ps1，要有 `main-wintoast` layout
- `git` 在 PATH 上
- 看 GitHub 的 PR 要裝 gh 並跑過 `gh auth login`；看 GitLab 的 MR 要裝 glab 並跑過 `glab auth login`。只用其中一邊的話，另一個可以不裝

### 執行安裝

在這個 repo 的根目錄跑：

```powershell
pwsh -File install.ps1
```

設定資料夾預設是 `~/.config/herdr-app`，設了 `HERDR_APP_HOME` 就改用那個位置。

install.ps1 會做這些事：

1. 把兩個 mod 和 `shared/*.js` 複製到 `mods/` 底下
2. 從內建 tabs clone 出 `tabs-git`，加上 Git 按鈕
3. 把 `main-wintoast` 的狀態列改成左右兩格，右格放 git-status，tabs 換成 tabs-git
4. 在 `keys.json` 加 `ctrl-shift-g`
5. 對三個 mod 跑 `herdr-app check`，有錯就停下來
6. 裝過 agent-home 的 Repos、Progress 面板（`mods/home-repo/home.json` 存在）的話，接著跑 agent-home 的 `herdr/install.ps1`。tabs-git 重建後那兩顆按鈕會不見，要靠它補回來

重跑不會重複套用。拉了新版或 herdr-app 更新內建 tabs 之後，再跑一次就會更新。

### 自架 GitLab

github.com 和 gitlab.com 會自動認得。自架 GitLab 要用 git config 告訴 git-status 主機名稱，可以設多個：

```powershell
git config --global --add herdr.gitlab-host git.example.com
```

## 使用

### 看的是哪個 repo

跟著目前聚焦的終端機的工作目錄走。點進 git-graph 面板時，會繼續顯示剛才那個終端機的 repo。PR/MR 只看 `origin` 遠端。遠端機器上的 space 目前不顯示。

### 開關 git-graph

三種方法都可以，面板開著時再做一次就會關掉：

- 點狀態列右邊的摘要
- 按右上角的 Git 按鈕
- 按 `ctrl-shift-g`

面板會從目前的窗格往右切出來。

### Graph 分頁

畫出 `git log --graph`，最多 300 筆。refs 有變動（commit、切分支、fetch）時會自動重畫。

- 上方的「所有分支」「目前分支」切換要畫哪些分支。「目前分支」只畫 HEAD 和遠端上同名的分支
- 「遠端」關掉後，不畫遠端分支，本地 commit 上也不再標 `origin/...`
- 右上角顯示 repo 名稱和目前分支
- 空心圓點是還沒 push 的 commit，分支名稱旁邊會標「↑ 未push」
- 已經合併進預設分支的本地分支標成「已合併，可刪」
- 目前的 HEAD 用實心底色標出來
- 點一筆 commit，下半部會顯示 `git show` 的內容。按右上角的 ✕ 或再點同一筆就關掉
- repo 有多個 worktree 時，上方會多一列 worktree，點了就切過去
- 面板寬度到 720 px 以上，會多顯示 hash 和作者

### PR/MR 分頁

github.com 的 repo 用 gh 抓 PR，GitLab 用 glab 抓 MR。

- 上半部列出所有開著的 PR/MR，附 CI 狀態、分支和 review 狀態，目前分支的那筆會標顏色
- 下半部是目前分支最近 5 次的 CI
- 點任何一列都會用瀏覽器開

### Issue 分頁

列出開著的 issue（gh / glab 預設最多 30 筆），附 label 和負責人，點一列會用瀏覽器開。repo 關掉 issue 功能時，這裡顯示 CLI 的錯誤訊息，PR/MR 分頁不受影響。

### 狀態列摘要

只顯示有的項目：目前分支的 PR/MR 和它的 CI、目前分支最新一次 CI、可刪的分支數。都沒有的時候只顯示 `git`。

圖示的意思：`✓` 成功、`✗` 失敗、`●` 進行中、`–` 沒有 CI。

### 多久更新一次

gh / glab 的資料每 60 秒抓一次，沒開 git-graph 時改成 120 秒。等不及就按面板右上角的「重新整理」。

### 出現這些訊息時

- `沒有 origin 遠端`：repo 沒有叫 `origin` 的遠端
- `不支援的遠端`：遠端不是 github.com、gitlab.com，也不在 `herdr.gitlab-host` 裡
- `gh：…` 或 `glab：…`：CLI 回報的錯誤，通常是沒登入或沒裝

## 測試

```powershell
npm test
```
