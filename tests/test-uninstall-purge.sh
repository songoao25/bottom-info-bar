#!/usr/bin/env bash
# Bottom Info Bar — uninstall.sh --purge-codex 清理逻辑单测
# 只操作 mktemp 临时目录，绝不触碰真实 ~/.dsh 与 ~/.codex
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PURGE="$ROOT/scripts/purge-codex.py"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0; FAIL=0
pass() { PASS=$((PASS+1)); echo "PASS  $1"; }
fail() { FAIL=$((FAIL+1)); echo "FAIL  $1"; }
assert_contains()     { [[ "$3" == *"$2"* ]] && pass "$1" || fail "$1（未找到 [$2]）"; }
assert_not_contains() { [[ "$3" != *"$2"* ]] && pass "$1" || fail "$1（不应包含 [$2]）"; }
mode_of() { stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1" 2>/dev/null || echo "?"; }

# ---------- 场景 1：多 provider 并存，只移除 openai-codex，其余全保留 ----------
S1="$TMP/s1"; mkdir -p "$S1"
cat > "$S1/settings.yaml" <<'EOF'
ui-onboarding:
  welcomeNoticeVersion: 2026-08-13.1
llm-pi-ai:
  providers:
    openai-codex:
      apiKeyEnv: OPENAI_CODEX_API_KEY
      displayName: Codex
    deepseek:
      apiKeyEnv: DEEPSEEK_API_KEY
      displayName: DeepSeek
agent-default-model:
  provider: deepseek-official
  model: deepseek-v4-flash
EOF
cat > "$S1/.credentials.yaml" <<'EOF'
# DSH credentials（注释保留）
DEEPSEEK_API_KEY: sk-deepseek-test
OPENAI_CODEX_API_KEY: eyJ0est-token
EOF
chmod 600 "$S1/settings.yaml" "$S1/.credentials.yaml"
python3 "$PURGE" --settings "$S1/settings.yaml" --credentials "$S1/.credentials.yaml" >/dev/null
S1_SETTINGS="$(cat "$S1/settings.yaml")"; S1_CRED="$(cat "$S1/.credentials.yaml")"
assert_not_contains "s1 settings：openai-codex 段已移除" "openai-codex" "$S1_SETTINGS"
assert_contains     "s1 settings：deepseek provider 保留" "deepseek:" "$S1_SETTINGS"
assert_contains     "s1 settings：llm-pi-ai 段保留（还有别家）" "llm-pi-ai:" "$S1_SETTINGS"
assert_contains     "s1 settings：无关顶层键保留" "agent-default-model:" "$S1_SETTINGS"
assert_contains     "s1 settings：ui-onboarding 保留" "ui-onboarding:" "$S1_SETTINGS"
assert_not_contains "s1 credentials：OPENAI_CODEX_API_KEY 已移除" "OPENAI_CODEX_API_KEY" "$S1_CRED"
assert_contains     "s1 credentials：DEEPSEEK_API_KEY 保留" "DEEPSEEK_API_KEY: sk-deepseek-test" "$S1_CRED"
assert_contains     "s1 credentials：注释保留" "# DSH credentials（注释保留）" "$S1_CRED"
[[ "$(mode_of "$S1/settings.yaml")" == "600" ]] && pass "s1 settings 权限保持 0600" || fail "s1 settings 权限"
[[ "$(mode_of "$S1/.credentials.yaml")" == "600" ]] && pass "s1 credentials 权限保持 0600" || fail "s1 credentials 权限"
ls "$S1"/settings.yaml.bak-* >/dev/null 2>&1 && pass "s1 settings 已生成备份" || fail "s1 settings 未备份"
ls "$S1"/.credentials.yaml.bak-* >/dev/null 2>&1 && fail "s1 credentials 不应留备份（避免密钥多副本）" || pass "s1 credentials 无备份"

# ---------- 场景 2：llm-pi-ai 只有 openai-codex → 级联清空整段，无关键保留 ----------
S2="$TMP/s2"; mkdir -p "$S2"
cat > "$S2/settings.yaml" <<'EOF'
llm-pi-ai:
  providers:
    openai-codex:
      apiKeyEnv: OPENAI_CODEX_API_KEY
ui-onboarding:
  welcomeNoticeVersion: 2026-08-13.1
EOF
: > "$S2/.credentials.yaml"
python3 "$PURGE" --settings "$S2/settings.yaml" --credentials "$S2/.credentials.yaml" >/dev/null
S2_SETTINGS="$(cat "$S2/settings.yaml")"
assert_not_contains "s2：openai-codex 已移除" "openai-codex" "$S2_SETTINGS"
assert_not_contains "s2：空的 llm-pi-ai 段级联清除" "llm-pi-ai" "$S2_SETTINGS"
assert_contains     "s2：无关顶层键保留" "ui-onboarding:" "$S2_SETTINGS"

# ---------- 场景 3：幂等——再跑一次不改文件、不重复备份 ----------
S1_BEFORE="$(md5 -q "$S1/settings.yaml" 2>/dev/null || md5sum "$S1/settings.yaml" | cut -d' ' -f1)"
S1_OUT="$(python3 "$PURGE" --settings "$S1/settings.yaml" --credentials "$S1/.credentials.yaml")"
[[ "$S1_OUT" == *"无需清理"*"无需清理"* ]] && pass "s3 二次运行提示无需清理" || fail "s3 二次运行输出：$S1_OUT"
S1_AFTER="$(md5 -q "$S1/settings.yaml" 2>/dev/null || md5sum "$S1/settings.yaml" | cut -d' ' -f1)"
[[ "$S1_BEFORE" == "$S1_AFTER" ]] && pass "s3 文件内容未变" || fail "s3 文件被二次改动"
[[ "$(ls "$S1"/settings.yaml.bak-* 2>/dev/null | wc -l | tr -d ' ')" == "1" ]] && pass "s3 备份未重复生成" || fail "s3 备份数量异常"

# ---------- 场景 4：文件缺失 → 不报错、exit 0 ----------
S4="$TMP/s4"; mkdir -p "$S4"
python3 "$PURGE" --settings "$S4/nope.yaml" --credentials "$S4/nope-creds.yaml" >/dev/null \
  && pass "s4 文件缺失不报错" || fail "s4 文件缺失应 exit 0"

# ---------- 场景 5：配置里根本没有目标 → 其余内容原样保留 ----------
S5="$TMP/s5"; mkdir -p "$S5"
cp "$S1/settings.yaml" "$S5/settings.yaml"
printf 'DEEPSEEK_API_KEY: sk-only\n' > "$S5/.credentials.yaml"
python3 "$PURGE" --settings "$S5/settings.yaml" --credentials "$S5/.credentials.yaml" >/dev/null
assert_contains "s5 无目标时其余内容原样保留" "deepseek:" "$(cat "$S5/settings.yaml")"

# ---------- 场景 6：uninstall.sh 自身（不触碰任何真实配置） ----------
bash -n "$ROOT/uninstall.sh" && pass "s6 uninstall.sh 语法检查通过" || fail "s6 uninstall.sh 语法错误"
HELP="$(bash "$ROOT/uninstall.sh" --help 2>&1)"
[[ "$HELP" == *"--purge-codex"* ]] && pass "s6 --help 显示 --purge-codex" || fail "s6 --help 未包含 --purge-codex"
grep -q 'PURGE_CODEX=1' "$ROOT/uninstall.sh" && pass "s6 脚本含 --purge-codex 分支" || fail "s6 脚本缺 --purge-codex 分支"

echo
echo "---- 结果：$PASS 通过 / $FAIL 失败 ----"
[[ "$FAIL" -eq 0 ]]
