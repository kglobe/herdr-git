# herdr-git

給 herdr-app 用的兩個 mod，在 Herdr 裡看目前 repo 的 git 狀態。全部唯讀，不會寫進 `.git`。

- git-graph：主區的面板。Graph 分頁畫 `git log --graph --all`（最多 300 筆），標出還沒 push 的 commit 和已合併可刪的分支，點 commit 看 `git show`。PR/MR 分頁列出開著的 PR（github.com 用 gh）或 MR（自架 GitLab 用 glab），附 CI 和 review 狀態，點了用瀏覽器開。
- git-status：底部狀態列右邊的摘要，例如 `MR !12 ✗ · CI ● · 2 分支可刪`。點它開啟 git-graph。

開 git-graph 的方法：點狀態列摘要、按右上角 Git 按鈕，或按 `ctrl-shift-g`。

## 安裝

需要 gh、glab 已登入。先跑過 herdr-notify-win 的 install.ps1（要有 `main-wintoast` layout）。

```powershell
pwsh -File install.ps1
```

install.ps1 會做這些事，重跑不會重複：

1. 把兩個 mod 和 `shared/*.js` 複製到 `~/.config/herdr-app/mods/`
2. 從內建 tabs clone 出 `tabs-git`，加上 Git 按鈕
3. 把 `main-wintoast` 的狀態列改成左右兩格，右格放 git-status，tabs 換成 tabs-git
4. 在 `keys.json` 加 `ctrl-shift-g`
5. 對三個 mod 跑 `herdr-app check`

## 測試

```powershell
npm test
```
