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
| 2026-11-17 | git-graph 的 commit 列表用 v_virtual_list 時什麼都沒畫 | 改用 absolute + overflow_y_scroll 的一般 children，跟 changes mod 的檔案清單同樣寫法 | LOG 最多 300 列，不需要虛擬列表；給了固定高度和 w_full 還是畫不出來 | 實測截圖 | active | mods/git-graph/main.js |
| 2026-11-17 | 遠端 space（machine）的 cwd 在別台機器 | 不支援，git-status、git-graph 在遠端 space 不顯示資料 | exec 只在本機跑 | 實作取捨 | active | shared/repo.js |
