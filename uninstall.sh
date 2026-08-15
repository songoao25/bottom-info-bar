#!/usr/bin/env bash
# Bottom Info Bar — 一键卸载脚本
# 用法：./uninstall.sh [--profile <name>]   （默认卸载 web profile）
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

echo "==> 从 profile '$PROFILE' 卸载 bottom-info-bar"
dsh plugin --profile "$PROFILE" remove bottom-info-bar

echo
echo "✔ 卸载完成。"
echo "  下一步：重启 DeepSeek Harness（dsh $PROFILE），原生统计栏自动恢复，无残留。"
