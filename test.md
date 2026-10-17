# changed-files mod：VS Code 沒有面板的處理狀態

更新時間：2026-10-14 21:58

## 結論（已確認）

原因是伺服器端 feature flag `tengu_melodic_ember`：有面板的 macOS 使用者為 `true`（對方 21:50 確認），沒面板的為 `false`。VS Code 裡的 mod 面板受這個 flag 控制；版本、設定、mod、profile 都已排除。`useTerminal` 不是主因。

## 待釐清：同一個 Claude 帳號為什麼 flag 不同

flag 由伺服器依「使用者屬性」計算，不只看帳號。binary 2.1.299 送出的屬性（`getUserAttributes`）包含：

`deviceId`、`accountUuid`、`organizationUuid`、`email`、`subscriptionType`、`rateLimitTier`、`firstTokenTime`、`appVersion`、`entrypoint`、`platform` 等。

其中 `deviceId` 是每個安裝各自隨機產生、存在各自 `~/.claude.json` 的 `userID`。兩個 macOS 使用者各有一份，所以即使登入同一個 Claude 帳號，`deviceId` 也不同。灰度發布常以 `deviceId` 分組，最可能就是一個分到 `true`、一個分到 `false`。flag 在伺服器端計算（remote eval），本機看不到規則，這點是推論。

請對方在能顯示面板的 macOS 使用者執行，貼前 8 碼即可（完整值不用貼）：

```bash
jq -r '"account=\(.oauthAccount.accountUuid[0:8]) org=\(.oauthAccount.organizationUuid[0:8]) device=\(.userID[0:8]) firstStart=\(.firstStartTime)"' ~/.claude.json
```

沒面板這邊的值：

```text
account=b5647916 org=ca4b624b device=86d137f9 firstStart=2025-07-17T07:49:30.411Z
```

預期：`account`、`org` 相同，`device` 不同。如果 `account` 也不同，代表兩邊其實登入不同帳號。

結果（有面板這邊，2026-10-14 22:05 查 `~/.claude.json`，只回報比對結果不貼識別值）：

```text
account=相同  org=相同  device=不同  firstStart=2025-10-02T01:52:09.875Z
```

與預期一致：兩邊登入同一個 Claude 帳號、同一個組織，只有 `deviceId` 不同。本機 binary 2.1.299 送出的使用者屬性確實含 `deviceId`（與 `accountUuid`、`organizationUuid`、`subscriptionType`、`rateLimitTier`、`firstTokenTime`、`appVersion`、`entrypoint` 同一組）。有面板這邊的安裝較新（firstStart 2025-10），沒面板那邊較舊（2025-07）；是否與分組有關無從驗證，只能當線索。

結論：同帳號不同結果，是伺服器端依 `deviceId` 灰度分組，本機沒有正規方式改變。「本機覆寫 flag 的嘗試」兩條都已確認無效，不必再試。

## 本機覆寫 flag 的嘗試（失敗）

| 方法 | 結果 |
|---|---|
| 環境變數 `CLAUDE_INTERNAL_FC_OVERRIDES` | 無效：這個 build 的 `getEnvironmentOverrides(){return null}` |
| 改 `~/.claude.json` 的 flag 快取為 `true` | 無效：新 session 啟動先向伺服器重抓，蓋回 `false` |

## 目前可用的做法

- VS Code 內用 `/changed-files` 的文字輸出。
- 要面板就用終端機版 Claude Code（fullscreen），不受這個 flag 限制。
- 等伺服器把這個 `deviceId` 也分進開啟組；開啟後新開對話即可。
