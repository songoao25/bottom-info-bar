#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Bottom Info Bar — Codex 订阅桥接残留清理（由 uninstall.sh --purge-codex 调用）

安全移除（目标以外的内容逐字节保留）：
  1) ~/.dsh/settings.yaml 中的 llm-pi-ai.providers.openai-codex 段（空父段自动级联清除）
  2) ~/.dsh/.credentials.yaml 中的 OPENAI_CODEX_API_KEY 行

用法：python3 scripts/purge-codex.py [--settings PATH] [--credentials PATH]

行为：
  - 目标不存在时幂等跳过（exit 0），不写盘、不备份
  - 首次实际修改 settings.yaml 前生成同名 .bak-<时间戳> 备份（可回滚）
  - credentials.yaml 只删目标行、原子重写，不额外留备份（避免密钥多副本）
  - 保留原文件权限位（settings.yaml / .credentials.yaml 均为 0600）
  - 绝不读取或修改 ~/.codex/auth.json（那是 codex CLI 自己的登录态）
"""

import argparse
import os
import shutil
import sys
import time


def indent_of(line):
    s = line.rstrip("\n")
    return len(s) - len(s.lstrip(" "))


def key_of(line):
    """取行首的 map 键名（去引号）；非键行返回 None。"""
    s = line.lstrip()
    if not s or s.startswith("#") or ":" not in s:
        return None
    return s.split(":", 1)[0].strip().strip("\"'") or None


def is_blank_or_comment(line):
    s = line.strip()
    return s == "" or s.startswith("#")


def has_inline_value(line):
    s = line.lstrip()
    return ":" in s and s.split(":", 1)[1].strip() != ""


def content_level(lines):
    """第一个内容行的缩进；全空/注释返回 None。"""
    for line in lines:
        if not is_blank_or_comment(line):
            return indent_of(line)
    return None


def block_end(lines, start):
    """返回块 [start, end)：start 行 + 其后所有更深缩进的行与空行。"""
    level = indent_of(lines[start])
    j = start + 1
    n = len(lines)
    while j < n and (is_blank_or_comment(lines[j]) or indent_of(lines[j]) > level):
        j += 1
    return j


def remove_path(lines, names, level=None):
    """在当前 map 中删除 names 路径指向的块；返回 (新行列表, 是否删除)。

    只在缩进 == level 的层级匹配键名（避免误删嵌套同名键）；
    删除后若父块（无行内值）已无内容行，则级联删除父块头行。
    """
    if not names:
        return lines, False
    if level is None:
        level = content_level(lines)
    if level is None:
        return lines, False
    target = names[0]
    out = []
    removed = False
    i, n = 0, len(lines)
    while i < n:
        line = lines[i]
        if is_blank_or_comment(line):
            out.append(line)
            i += 1
            continue
        if indent_of(line) != level or key_of(line) != target:
            out.append(line)
            i += 1
            continue
        end = block_end(lines, i)
        if len(names) == 1:
            # 叶子：整块删除（含行内值场景）
            removed = True
            i = end
            continue
        body = lines[i + 1 : end]
        new_body, sub_removed = remove_path(body, names[1:])
        if sub_removed:
            removed = True
            if content_level(new_body) is None and not has_inline_value(line):
                i = end  # 父块已空 → 级联删除头行
                continue
            out.append(line)
            out.extend(new_body)
        else:
            out.append(line)
            out.extend(body)
        i = end
    return out, removed


def read_lines(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read().splitlines(True)


def write_lines_atomic(path, lines):
    """原子重写并保留原权限位（0600）。"""
    mode = os.stat(path).st_mode & 0o777
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.writelines(lines)
    os.chmod(tmp, mode)
    os.replace(tmp, path)


def purge_settings(path):
    """移除 llm-pi-ai.providers.openai-codex 段；返回 (是否改动, 说明)。"""
    if not os.path.isfile(path):
        return False, "settings.yaml 不存在（%s），跳过" % path
    new_lines, removed = remove_path(read_lines(path), ["llm-pi-ai", "providers", "openai-codex"])
    if not removed:
        return False, "settings.yaml 未包含 llm-pi-ai.providers.openai-codex，无需清理"
    bak = path + ".bak-" + time.strftime("%Y%m%d%H%M%S")
    shutil.copy2(path, bak)
    write_lines_atomic(path, new_lines)
    return True, "settings.yaml 已移除 openai-codex 段（修改前备份：%s）" % bak


def purge_credentials(path):
    """移除 OPENAI_CODEX_API_KEY 行；返回 (是否改动, 说明)。"""
    if not os.path.isfile(path):
        return False, ".credentials.yaml 不存在（%s），跳过" % path
    lines = read_lines(path)
    out = [line for line in lines if key_of(line) != "OPENAI_CODEX_API_KEY"]
    removed = len(lines) - len(out)
    if removed == 0:
        return False, ".credentials.yaml 未包含 OPENAI_CODEX_API_KEY，无需清理"
    write_lines_atomic(path, out)
    return True, ".credentials.yaml 已移除 %d 行 OPENAI_CODEX_API_KEY 凭据" % removed


def main():
    ap = argparse.ArgumentParser(description="Bottom Info Bar --purge-codex：清理 Codex 桥接配置与凭据")
    ap.add_argument("--settings", default=os.path.expanduser("~/.dsh/settings.yaml"),
                    help="settings.yaml 路径（默认 ~/.dsh/settings.yaml）")
    ap.add_argument("--credentials", default=os.path.expanduser("~/.dsh/.credentials.yaml"),
                    help=".credentials.yaml 路径（默认 ~/.dsh/.credentials.yaml）")
    args = ap.parse_args()
    for changed, msg in (purge_settings(args.settings), purge_credentials(args.credentials)):
        print(("✔ " if changed else "· ") + msg)
    print("提示：运行中的 DeepSeek Harness 把配置/凭据保存在内存里，改动需重启 DSH 后生效；"
          "~/.codex/auth.json（codex CLI 自己的登录态）未做任何改动。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
