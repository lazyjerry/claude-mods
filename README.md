# claude-mods

> 作者：[LazyJerry](https://github.com/lazyjerry/claude-mods)
>
> 最後更新：2026-10-15

Claude Code mod（以 plugin 形式載入的 hook 模組）收藏。每個子資料夾是一個獨立的 mod。

| Mod | 用途 |
|---|---|
| [changed-files](changed-files/) | 列出本 session 每一輪改到的檔案與增刪行數 |

## changed-files

追蹤 Edit、Write、NotebookEdit 與 Bash 造成的檔案變更，依輪次整理成清單，並累計 `+新增 −刪除` 行數。Bash 的變更用執行前後的 `git diff --numstat` 與未追蹤檔案比對，所以需要在 git repo 內才能計到 Bash 造成的變更；比對的 repo 以 session 開始時的工作目錄解析一次，之後 `cd` 到別的 repo 不會跟著換。

面板在 session 第一次記到變更時才自動打開，沒改檔的 session 不會出現；關掉後要再看就輸入 `/changed-files`。

### 各環境的顯示結果

| 環境 | 顯示方式 |
|---|---|
| 終端機（fullscreen） | 輸入框旁的「變更檔案」面板（`x` 收合／展開），每輪結束追加一行摘要 |
| VS Code 擴充套件 2.1.299 以上 | 輸入框上方的「變更檔案」面板（外框與標題列由擴充套件繪製，mod 無法隱藏），加上 `/changed-files` 的文字輸出 |
| VS Code 擴充套件 2.1.296 以下 | 只有 `/changed-files` 的文字輸出；面板、狀態列、對話摘要與 toast 都不會顯示 |

VS Code 的版本分界來自實測：2.1.296 的擴充套件 bundle 沒有 Pane／AbovePrompt 的渲染程式，2.1.299 才有。兩個人裝同一份 mod、一個有面板一個只有文字，先比擴充套件版本。

### 安裝

前置條件：已安裝 Claude Code，且 `claude` 指令可用。

**一行指令：遠端下載並安裝（建議）**

不用先 clone，下載 repo 壓縮檔到暫存目錄後執行 [install.sh](install.sh)，裝完刪掉暫存目錄（需要 `curl`、`tar`、`jq`）：

```bash
tmp="$(mktemp -d)" && curl -fsSL https://github.com/lazyjerry/claude-mods/archive/refs/heads/main.tar.gz | tar -xz -C "$tmp" && bash "$tmp/claude-mods-main/install.sh" && rm -rf "$tmp"
```

不加參數會出現互動選單；要跳過選單，在 `install.sh` 後面加 `--all` 或 mod 名稱（例如 `changed-files`）。結果與方式三相同：mod 複製到 `~/.claude/mods`，路徑補進 `~/.claude/settings.json`。

不支援 `curl …/install.sh | bash`：腳本從自己所在的資料夾偵測 mod，只下載腳本本身會找不到任何 mod。

以下三種方式適合要自己保留原始碼、或要改 mod 的情況。

**方式一：啟動時指定資料夾（單次，適合試用）**

```bash
claude --plugin-dir /path/to/claude-mods/changed-files
```

**方式二：用環境變數永久載入（終端機與 VS Code 都適用）**

在 `~/.claude/settings.json` 加入 `env`，路徑指向本資料夾下的 `changed-files`：

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/claude-mods/changed-files"
  }
}
```

已有 `env` 區塊就只加這一個鍵。要同時載入多個 mod，路徑用冒號分隔（未實測，依 `PATH` 慣例推定）。

**方式三：複製到 `~/.claude/mods`**

```bash
mkdir -p ~/.claude/mods
cp -R /path/to/claude-mods/changed-files ~/.claude/mods/
```

再用方式二指向 `~/.claude/mods/changed-files`。這樣原始碼與實際載入的版本分開，改動前請先確認要改哪一份。

上面兩步可以用 [install.sh](install.sh) 一次完成，它會複製選定的 mod 並把 `CLAUDE_CODE_PLUGIN_DIRS` 補進 `~/.claude/settings.json`（需要 `jq`）：

```bash
bash install.sh                  # 互動選單，挑要裝的 mod
bash install.sh changed-files    # 直接指定 mod 名稱，可多個
bash install.sh --all            # 全部安裝
bash install.sh --list           # 只列出可安裝的 mod
```

重跑是安全的：已安裝的副本先搬到 `~/.claude/mods/.bak/<時間戳>/` 再覆蓋，`settings.json` 改動前留 `settings.json.bak-<時間戳>`，路徑已存在就不重複加。`--mods-dir`、`--settings` 可改目的地與設定檔位置，`--no-validate` 略過安裝後的 `claude plugin validate`。

### 啟用後

1. 新開一個 Claude Code 對話或重啟 session。mod 只在 session 開始時載入，已開著的對話不會套用。
2. 輸入 `/changed-files`。看到「變更檔案面板已打開。」代表指令已註冊；輸入框打到 `/changed-files` 卻顯示 `No matching commands`，代表 mod 還沒載入。
3. 請 Claude 改任一檔案，面板會在第一次變更時自動打開；舊版 VS Code 擴充套件沒有面板，再輸入一次 `/changed-files` 看清單。

### 驗證

```bash
claude plugin validate /path/to/claude-mods/changed-files
claude plugin test /path/to/claude-mods/changed-files
```

驗證預期有一則 `author` 缺漏的警告，不影響載入。測試預期全部通過。

### 疑難排解

| 現象 | 處理 |
|---|---|
| 輸入框顯示 `No matching commands` | 確認 `CLAUDE_CODE_PLUGIN_DIRS` 路徑存在，並**新開**對話 |
| VS Code 沒有面板 | 擴充套件 2.1.296 以下沒有這個顯示位置，更新到 2.1.299 以上並新開對話；或改用 `/changed-files` |
| VS Code 版本夠新仍沒有面板，log 有 `session.start: raised (surface none, not interactive)` 與 `ui.open: no-surface` | 兩個可能，依序查：(1) `claudeCode.useTerminal` 為 true，Claude 跑在終端機裡沒有 webview，使用者層級與工作區檔（`.code-workspace`）兩處都要拿掉；(2) 帳號層級的伺服器端 feature flag 未開，`jq '.cachedGrowthBookFeatures.tengu_melodic_ember' ~/.claude.json` 為 `false` 時內建 binary 不宣告 `ui_surface_v1`，webview 不會 attach。第 (2) 種本機沒有正規方式打開，只能用 `/changed-files` 文字輸出或終端機版 |
| 面板一直沒出現 | 面板在第一次記到變更時才開；還沒改檔或變更不在判定範圍內（見「Bash 的變更沒計入」）就不會開 |
| 想確認 VS Code 有沒有載入 | 命令面板執行 `Claude: Show Logs`，Output 選「Claude VSCode」，篩選 `changed-files`，應看到 `plugin.register: changed-files ... admitted` |
| Bash 的變更沒計入 | 確認 session 開始時的工作目錄在 git repo 內，且改到的檔案在同一個 repo；用 Bash 改其他 repo 或非 repo 的檔案不會計入 |

### 解除安裝

移除 `settings.json` 的 `CLAUDE_CODE_PLUGIN_DIRS`（或只拿掉這個路徑），刪除複製過去的資料夾，新開對話即可。

### 檔案結構

```text
changed-files/
├── .claude-plugin/plugin.json   # mod 名稱、版本與型別契約位置
├── hooks/
│   ├── hooks.json               # 指向 register.tsx
│   ├── register.tsx             # 事件 hook 與畫面
│   └── lib.ts                   # 行數計算與 git 快照比對
├── tests/changed-files.test.ts
├── tsconfig.json
└── types/index.d.ts             # 狀態值的型別契約
```

`.claude-plugin/types/` 由引擎在載入時自動產生（API 型別），不放進這個資料夾，也不用手動建立。
