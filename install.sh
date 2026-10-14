#!/usr/bin/env bash
#
# 方式三的操作腳本：把選定的 mod 複製到 ~/.claude/mods，再把 ~/.claude/settings.json
# 的 env.CLAUDE_CODE_PLUGIN_DIRS 指向複製後的位置。原始碼與實際載入的版本因此分開。
#
# 用法:
#   bash install.sh                        互動選單，挑要裝的 mod
#   bash install.sh changed-files [...]    直接指定 mod 名稱
#   bash install.sh --all                  全部安裝
#   bash install.sh --list                 只列出可安裝的 mod，不動任何檔案
#
# 選項:
#   --mods-dir <路徑>   複製目的地，預設 ~/.claude/mods
#   --settings <路徑>   要改的 settings.json，預設 ~/.claude/settings.json
#   --no-validate       略過 claude plugin validate
#
# 可安裝的 mod 從本腳本所在資料夾自動偵測：含 .claude-plugin/plugin.json 的子資料夾。
#
# 重跑是冪等的：目的地已有同名副本就先搬到 <mods-dir>/.bak/<時間戳>/ 再複製；
# settings.json 改動前留一份 settings.json.bak-<時間戳>，路徑已在
# CLAUDE_CODE_PLUGIN_DIRS 裡就不重複加，沒有變動就不寫檔也不留備份。
#
# 結束碼: 0 成功；1 參數、環境或路徑錯誤

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MODS_DIR="$HOME/.claude/mods"
SETTINGS="$HOME/.claude/settings.json"
VALIDATE=1
ALL=0
LIST=0
TS="$(date +%Y%m%d-%H%M%S)"
BAK_DIR=""
SELECTED=()
AVAILABLE=()

die() { printf '❌ %s\n' "$*" >&2; exit 1; }

usage() {
    sed -n '3,/^# 結束碼/p' "$0" | sed 's/^# \{0,1\}//' >&2
    exit 1
}

while [ $# -gt 0 ]; do
    case "$1" in
        --mods-dir) shift; MODS_DIR="${1:-}"; [ -n "$MODS_DIR" ] || die '--mods-dir 缺路徑' ;;
        --settings) shift; SETTINGS="${1:-}"; [ -n "$SETTINGS" ] || die '--settings 缺路徑' ;;
        --no-validate) VALIDATE=0 ;;
        --all) ALL=1 ;;
        --list) LIST=1 ;;
        -h|--help) usage ;;
        -*) die "未知參數: $1" ;;
        *) SELECTED+=("$1") ;;
    esac
    shift
done

command -v jq >/dev/null 2>&1 || die '需要 jq 來改 settings.json（brew install jq）'

# ---- 偵測可安裝的 mod ----------------------------------------------------

for d in "$SCRIPT_DIR"/*/; do
    d="${d%/}"
    [ -f "$d/.claude-plugin/plugin.json" ] || continue
    AVAILABLE+=("$(basename "$d")")
done
[ -n "${AVAILABLE[*]:-}" ] || die "在 $SCRIPT_DIR 下沒有找到任何 mod（含 .claude-plugin/plugin.json 的子資料夾）"

mod_version() {
    jq -r '.version // "?"' "$SCRIPT_DIR/$1/.claude-plugin/plugin.json"
}

mod_state() {
    [ -d "$MODS_DIR/$1" ] && printf '已安裝，會覆蓋' || printf '未安裝'
}

list_mods() {
    local i m
    i=1
    for m in "${AVAILABLE[@]}"; do
        printf '  %d) %s v%s（%s）\n' "$i" "$m" "$(mod_version "$m")" "$(mod_state "$m")"
        i=$((i + 1))
    done
}

if [ "$LIST" -eq 1 ]; then
    printf '可安裝的 mod（目的地 %s）：\n' "$MODS_DIR"
    list_mods
    exit 0
fi

# ---- 決定要裝哪些 ---------------------------------------------------------

is_available() {
    local m
    for m in "${AVAILABLE[@]}"; do [ "$m" = "$1" ] && return 0; done
    return 1
}

pick_interactive() {
    local answer tok
    [ -t 0 ] || die '沒有終端機可互動，請直接指定 mod 名稱或 --all'
    printf '可安裝的 mod（目的地 %s）：\n' "$MODS_DIR"
    list_mods
    printf '輸入編號（空白分隔，a = 全部，直接 Enter 取消）: '
    read -r answer
    [ -n "$answer" ] || { printf '已取消。\n'; exit 0; }
    for tok in $answer; do
        case "$tok" in
            a|all) SELECTED=("${AVAILABLE[@]}"); return 0 ;;
            ''|*[!0-9]*) die "看不懂的輸入: $tok" ;;
        esac
        [ "$tok" -ge 1 ] && [ "$tok" -le "${#AVAILABLE[@]}" ] || die "編號超出範圍: $tok"
        SELECTED+=("${AVAILABLE[$((tok - 1))]}")
    done
}

if [ "$ALL" -eq 1 ]; then
    SELECTED=("${AVAILABLE[@]}")
elif [ -z "${SELECTED[*]:-}" ]; then
    pick_interactive
fi

for m in "${SELECTED[@]}"; do
    is_available "$m" || die "沒有這個 mod: $m. 可用: ${AVAILABLE[*]}"
done

# settings.json 壞掉就先停，不要複製完才發現設定改不了
if [ -f "$SETTINGS" ]; then
    jq -e . "$SETTINGS" >/dev/null 2>&1 || die "$SETTINGS 不是合法 JSON，請先修好再重跑"
fi

# ---- 複製 -----------------------------------------------------------------

install_mod() {
    local src dst
    src="$SCRIPT_DIR/$1"
    dst="$MODS_DIR/$1"
    if [ -d "$dst" ]; then
        # 同一次執行共用一個備份目錄；mktemp 加亂數尾碼，同秒重跑也不會撞名
        [ -n "$BAK_DIR" ] || { mkdir -p "$MODS_DIR/.bak"; BAK_DIR="$(mktemp -d "$MODS_DIR/.bak/$TS-XXXXXX")"; }
        mv "$dst" "$BAK_DIR/"
        printf '  舊副本已搬到 %s\n' "$BAK_DIR/$1"
    fi
    cp -R "$src" "$dst"
    # .claude-plugin/types/ 是引擎載入時自動產生的 API 型別，原始碼若曾被方式一直接
    # 載入過就會殘留；副本不帶它，讓引擎自己重新產生。
    rm -rf "$dst/.claude-plugin/types"
    printf '✅ %s → %s\n' "$1" "$dst"
}

validate_mod() {
    [ "$VALIDATE" -eq 1 ] || return 0
    command -v claude >/dev/null 2>&1 || { printf '  （找不到 claude 指令，略過驗證）\n'; return 0; }
    if ! claude plugin validate "$MODS_DIR/$1"; then
        printf '⚠️  %s 驗證回報問題，請看上方輸出（author 缺漏的警告屬預期）\n' "$1" >&2
    fi
}

mkdir -p "$MODS_DIR"
INSTALLED_PATHS=()
for m in "${SELECTED[@]}"; do
    install_mod "$m"
    validate_mod "$m"
    INSTALLED_PATHS+=("$MODS_DIR/$m")
done

# ---- 改 settings.json -----------------------------------------------------

mkdir -p "$(dirname "$SETTINGS")"
if [ -f "$SETTINGS" ]; then
    CURRENT="$(jq -r '.env.CLAUDE_CODE_PLUGIN_DIRS // ""' "$SETTINGS")"
else
    CURRENT=""
fi

NEW="$CURRENT"
for p in "${INSTALLED_PATHS[@]}"; do
    case ":$NEW:" in
        *":$p:"*) continue ;;
    esac
    NEW="${NEW:+$NEW:}$p"
done

if [ "$NEW" = "$CURRENT" ]; then
    printf '%s 已含上述路徑，不需改動。\n' "$SETTINGS"
else
    if [ -f "$SETTINGS" ]; then
        cp "$SETTINGS" "$SETTINGS.bak-$TS"
        printf '  settings 備份: %s\n' "$SETTINGS.bak-$TS"
        SRC_JSON="$SETTINGS"
    else
        SRC_JSON=""
    fi
    TMP="$SETTINGS.tmp.$$"
    if [ -n "$SRC_JSON" ]; then
        jq --arg v "$NEW" '.env = ((.env // {}) + {CLAUDE_CODE_PLUGIN_DIRS: $v})' "$SRC_JSON" > "$TMP"
    else
        jq -n --arg v "$NEW" '{env: {CLAUDE_CODE_PLUGIN_DIRS: $v}}' > "$TMP"
    fi
    jq -e . "$TMP" >/dev/null 2>&1 || { rm -f "$TMP"; die '產生的 settings.json 不合法，原檔未動'; }
    mv "$TMP" "$SETTINGS"
    printf '✅ %s 的 env.CLAUDE_CODE_PLUGIN_DIRS = %s\n' "$SETTINGS" "$NEW"
fi

printf '\n完成。mod 只在 session 開始時載入，請新開一個 Claude Code 對話，再輸入 /<mod 名稱> 確認。\n'
