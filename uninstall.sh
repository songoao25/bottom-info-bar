#!/usr/bin/env bash
# Bottom Info Bar — 一键卸载脚本
# 用法：./uninstall.sh [--profile <name>] [--purge-codex]
#       --purge-codex 额外清理 Codex 订阅桥接配置与凭据：
#       settings.yaml 的 llm-pi-ai.providers.openai-codex 段 +
#       .credentials.yaml 的 OPENAI_CODEX_API_KEY 行（先备份，其余配置保留）
set -euo pipefail

PROFILE="web"
PURGE_CODEX=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    --purge-codex) PURGE_CODEX=1; shift ;;
    -h|--help) echo "用法: ./uninstall.sh [--profile <name>] [--purge-codex]"; exit 0 ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
done

command -v dsh >/dev/null 2>&1 || { echo "错误：未找到 dsh CLI"; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "错误：未找到 pnpm"; exit 1; }

echo "==> 从 profile '$PROFILE' 卸载 bottom-info-bar"
if ! dsh plugin --profile "$PROFILE" remove bottom-info-bar; then
  echo "  ⚠ 插件移除失败（可能已卸载或 profile 不存在）"
  [[ "$PURGE_CODEX" == 1 ]] || exit 1
fi

if [[ "$PURGE_CODEX" == 1 ]]; then
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  echo "==> 清理 Codex 订阅桥接配置与凭据（llm-pi-ai.providers.openai-codex + OPENAI_CODEX_API_KEY）"
  if command -v python3 >/dev/null 2>&1; then
    python3 "$ROOT/scripts/purge-codex.py"
  else
    echo "⚠ 未找到 python3，无法自动清理。请手动操作："
    echo "  1) 删除 ~/.dsh/settings.yaml 中的 llm-pi-ai.providers.openai-codex 段"
    echo "  2) 删除 ~/.dsh/.credentials.yaml 中的 OPENAI_CODEX_API_KEY 行"
    echo "  3) 重启 DeepSeek Harness 生效"
  fi
fi

echo
echo "✔ 卸载完成。"
if [[ "$PURGE_CODEX" == 1 ]]; then
  echo "  ⚠ 运行中的 DeepSeek Harness 把配置/凭据保存在内存里——请重启 dsh $PROFILE 使清理生效。"
  echo "  ~/.codex/auth.json（codex CLI 自己的登录态）已保留，未做任何改动。"
fi
echo "  下一步：重启 DeepSeek Harness（dsh $PROFILE），原生统计栏自动恢复，无残留。"
