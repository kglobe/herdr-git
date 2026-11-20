---
landmark: decision-log
---

| Date | Context | Decision | Why | Source | Status | Ref |
|---|---|---|---|---|---|---|
| 2026-11-17 | PR/MR 和 CI 資料要給狀態列和 git-graph 兩個 mod 用 | 只有 git-status 呼叫 gh／glab，結果寫進 `shared("git-remote:<repo 根目錄>")`，git-graph 只讀；本機資料（已合併分支、未 push commit）各自算 | git-status 一直顯示在狀態列，由它抓就只有一份請求；值不含時間戳，沒變就不寫，避免每次都觸發所有 mod 重繪 | spec 2026-11-17-herdr-git-design | active | mods/git-status/main.js |
| 2026-11-17 | herdr mod 不能 import 自己資料夾以外的檔案 | 共用程式放 `shared/`，install.ps1 複製到每個 mod 資料夾 | `herdr-app check` 回報 resolves outside the application directory | 實測 | active | install.ps1 |
| 2026-11-17 | 右上角要有 Git 按鈕，內建 tabs mod 不能改 | 每次安裝重新 `mod.clone tabs → tabs-git`，在 Changes 按鈕那行後面插入 Git 按鈕，找不到那行就讓安裝失敗 | 內建 mod 開機會被換掉；每次重 clone 才吃得到 tabs 的更新 | spec | active | install.ps1 |
| 2026-11-17 | 安裝時 herdr 把新 mod 自動放進 layout root（右側 320px） | 先複製 mod.json 再複製 main.js；install 會清掉這類自動加的 block | herdr 看到沒有 mod.json 的 main.js 就用預設位置，還會覆寫 layout 檔 | 實測截圖 | superseded | install.ps1 |
| 2026-11-17 | 同上，/simplify 指出 regex 清理很脆弱 | 第一次安裝時先在 mods 外面的 `.staging-<名稱>` 組好資料夾，再整個搬進 mods；layout 和 keys.json 改用 ConvertFrom-Json 修改，不用 regex | 搬進去時 main.js 和 mod.json 同時出現，herdr 不會自動放；用 JSON 改不受排版影響 | /simplify | active | install.ps1 |
| 2026-11-17 | git-graph 的 commit 列表用 v_virtual_list 時什麼都沒畫 | 改用 absolute + overflow_y_scroll 的一般 children，跟 changes mod 的檔案清單同樣寫法 | LOG 最多 300 列，不需要虛擬列表；給了固定高度和 w_full 還是畫不出來 | 實測截圖 | superseded | mods/git-graph/main.js |
| 2026-11-17 | 遠端 space（machine）的 cwd 在別台機器 | 不支援，git-status、git-graph 在遠端 space 不顯示資料 | exec 只在本機跑 | 實作取捨 | active | shared/repo.js |
| 2026-11-18 | graph 只畫本機已有的 ref，遠端新 commit 要 fetch 才看得到 | git-status 在有 git-graph pane 時每 5 分鐘 `git fetch origin`（30 秒 timeout、`credential.interactive=never`、SSH `BatchMode=yes`、關 gc）；同一 repo 連續失敗 3 次就停，狀態列顯示授權／連線／其他錯誤；graph 的「重新整理」按鈕立即 fetch 並重置失敗計數 | 參考 GitHub Desktop（最短 5 分鐘）、lazygit（背景 fetch 遇到要帳密就失敗）；exec 不能帶 env，只能用 `git -c`；連續失敗還一直重試沒意義 | 對話討論 | active | mods/git-status/main.js |
| 2026-11-19 | 300 列 graph 一次畫完超過 script 時限（interrupted） | commit 列表改回 v_virtual_list，只畫看得到的列，點擊用 on_item_click | scan_gov 333 列實測會中斷；取代 11-17 那列 | 810ac16 | active | mods/git-graph/main.js |
| 2026-11-20 | 分支多時 graph 被其他分支擠滿（參考別的 git 面板的 All branches / Current / Remotes） | Graph 分頁加「所有分支／目前分支」和「遠端」切換，預設所有分支加遠端（等於原本的 `--all`）。目前分支畫 HEAD 加 `--remotes=*/<分支>`；關掉遠端時加 `--decorate-refs-exclude=refs/remotes`，連標籤一起拿掉。選擇不存檔，重開回預設 | 參數由 `logRefs()` 產生，單元測試蓋到四種組合；不存檔是因為現在沒有需要記住偏好的情境 | 對話討論 | active | shared/git.js、mods/git-graph/main.js |
| 2026-11-20 | 重建 tabs-git 後，agent-home 補的 Repos、Progress 按鈕消失 | install.ps1 結尾檢查 `mods/home-repo/home.json`，有的話用 pwsh 跑它 `root` 底下的 `herdr\install.ps1`，失敗就讓安裝失敗 | 兩支安裝都改 tabs-git，順序錯了按鈕就不見。home.json 本來就記著 agent-home 的位置，不用另外設定 | 使用者決定 | active | install.ps1 |
| 2026-11-20 | agent-home 的 Repos 面板要開 git-graph 並直接停在 Issue | git-graph 的初始分頁讀 `props.tab`，沒帶就是 `graph` | `pane.split` 本來就能帶 props，不用另外加指令 | 使用者決定 | withdrawn | mods/git-graph/main.js |
| 2026-11-20 | agent-home 不再自動開 git-graph | 拿掉初始分頁讀 `props().tab`，面板一律從 Graph 開始 | 沒有呼叫端了。使用者改在 Repos 面板看 issue 數 | 使用者決定 | superseded | mods/git-graph/main.js |
| 2026-11-20 | agent-home 的 Repos 面板按 `issue N` 要開 git-graph 並停在 Issue | 初始分頁讀 `props().tab`，沒帶就是 `graph`。已經開著的面板沒有辦法改分頁，呼叫端要換分頁就關掉重開 | `init` 的第一個參數拿不到 `pane.split` 給的 props，要用 `props()`。關掉重開只丟掉篩選和展開的 commit，不值得為它加指令 | 使用者決定 | active | mods/git-graph/main.js |
