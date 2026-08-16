#!/usr/bin/env bash
# Bottom Info Bar — 一键卸载脚本
# 用法：./uninstall.sh [--profile <name>]
#       卸载插件本体；ChatGPT 订阅由独立插件 dsh-chatgpt-subscription 负责，不在本脚本清理范围。
set -euo pipefail

PROFILE="web"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    -h|--help) echo "用法: ./uninstall.sh [--profile <name>]"; exit 0 ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
done

command -v dsh >/dev/null 2>&1 || { echo "错误：未找到 dsh CLI"; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "错误：未找到 pnpm"; exit 1; }

echo "==> 从 profile '$PROFILE' 卸载 dsh-bottom-info-bar"
if ! dsh plugin --profile "$PROFILE" remove dsh-bottom-info-bar; then
  echo "  ⚠ 插件移除失败（可能已卸载或 profile 不存在）"
  exit 1
fi

echo
echo "✔ 卸载完成。"
echo "  下一步：重启 DeepSeek Harness（dsh $PROFILE），原生统计栏自动恢复，无残留。"
