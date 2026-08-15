# Bottom Info Bar

**English** | [**中文**](README.zh-CN.md)

[![License: MIT](https://img.shields.io/github/license/songoao25/bottom-info-bar)](https://github.com/songoao25/bottom-info-bar/blob/main/LICENSE)
[![Release](https://img.shields.io/github/v/release/songoao25/bottom-info-bar)](https://github.com/songoao25/bottom-info-bar/releases)
[![Last commit](https://img.shields.io/github/last-commit/songoao25/bottom-info-bar)](https://github.com/songoao25/bottom-info-bar)
[![CI](https://img.shields.io/github/actions/workflow/status/songoao25/bottom-info-bar/ci.yml)](https://github.com/songoao25/bottom-info-bar/actions)

A single-line information bar for [DeepSeek Harness](https://github.com/deepseek-ai) that replaces the native stats row under the composer with **provider & model, live balance, peak/off-peak pricing, and real spend** — all in one glance. Install once; it activates automatically on every launch.

## Features

- **Drop-in replacement** — Replaces the native stats row while keeping its core original information (turns/steps, LLM latency, tool calls, cache hit rate, in/out tokens) with a native-consistent layout. Speed metrics (TTFT, tok/s) move to the hover tooltip so the row stays on a single line.
- **Provider & model detection** — Auto-detects and pretty-prints the active provider and model (DeepSeek V4 Flash, Kimi K3, GLM 4.6, …) with a bold provider name.
- **Live balance** — Fetches real balance from DeepSeek's `/user/balance` API, auto-refreshes every 60 s, and keeps the last known snapshot on failure so usage is never interrupted.
- **Peak / off-peak pricing** — Shows peak (amber, bold) and off-peak (green, bold) prices with a countdown to the next switch; hidden automatically for providers without tiered pricing.
- **Real spend tracking** — Records every `llm/stream` request (usage × unit price) and aggregates precisely by **this conversation / today / this month / all time**. Records are persisted to disk — nothing is lost on restart.
- **Bold numbers** — Balance, countdown, spend, and all stats are rendered with bold numerals for instant readability.
- **Full / compact toggle** — Click the bar to switch between two strict modes (debounced).
- **Low-balance alert** — Shows ⚠ when the balance drops below ¥20.

## Requirements

- [DeepSeek Harness](https://github.com/deepseek-ai) (`dsh` CLI) installed and used via the web interface (`dsh web`)
- [pnpm](https://pnpm.io/) (used by `dsh plugin`)

## Installation

### Option 1 — One-command script (recommended)

```bash
git clone https://github.com/songoao25/bottom-info-bar.git
cd bottom-info-bar
./install.sh                # installs to the "web" profile; use --profile <name> to override
```

### Option 2 — dsh plugin command

```bash
git clone https://github.com/songoao25/bottom-info-bar.git
dsh plugin --profile web add /path/to/bottom-info-bar/plugin
```

> **Restart `dsh web` after installing.** Plugins are composed when the host process starts; a page refresh alone is not enough.

For detailed installation, troubleshooting, and upgrade instructions, see [docs/INSTALL.md](docs/INSTALL.md).

## Usage

- **Hover** the bar for details: balance, per-token pricing, next price-switch time, and this-conversation spend (today / this month / all time).
- **Click** the bar to toggle between full and compact modes.

## Configuration

- **API key**: configure the DeepSeek API key under **Settings → Models** (environment variable `DEEPSEEK_API_KEY`). Without it, the plugin shows a hint and every other feature keeps working.
- **Data scope**: peak hours are 09:00–12:00 and 14:00–18:00 (Beijing time). Built-in pricing covers DeepSeek V4 models plus OpenAI reference prices; models not in the table are excluded from spend statistics.

### Data storage (plugin-owned directory)

All spend data lives in the plugin's own data directory, isolated from other plugins and DSH configuration:

```
~/.dsh/bottom-info-bar/
└── usage-records.json      # per-request usage ledger (persisted across restarts)
```

- **Location**: `~/.dsh/bottom-info-bar/` (directory mode `0700`, file mode `0600` — readable only by the current user).
- **Override**: set the environment variable `BOTTOM_INFO_BAR_DATA_DIR` to relocate the whole data directory (e.g. an external drive or a synced folder).
- **Contents**: one entry per `llm/stream` request (`ts / model / provider / sessionId / input / cacheRead / cacheWrite / output`). No conversation content and no API keys are ever stored.
- **Retention**: capped at 3,000 entries (oldest first).
- **Spend scope**: aggregated in the active provider's currency (CNY for DeepSeek, USD for the OpenAI reference prices); records in other currencies are not mixed in. Models absent from the pricing table are excluded.
- **Reset**: delete the file to clear all statistics. Uninstalling the plugin does not delete your data.

## Uninstall

```bash
cd bottom-info-bar
./uninstall.sh
# or: dsh plugin --profile web remove bottom-info-bar
```

After restarting, the native stats row returns automatically with no residue (the ledger file under `~/.dsh/bottom-info-bar/` is your data and is kept; remove it manually if you want to reset the statistics).

## FAQ

| Symptom | Fix |
|---|---|
| Bar does not appear after a page refresh | **Restart** `dsh web` (the host process loads plugins) |
| Balance shows "DEEPSEEK_API_KEY not configured" | Add the key under Settings → Models |
| Balance shows "⚠ refresh failed, showing last snapshot" | Transient network/key issue; retries automatically after 60 s |
| Want the original stats row back | Uninstall the plugin and restart |

## Development

- **Source**: `plugin/src/host.js` (host) + `plugin/src/client-bundle.js` (client)
- **Build**: `cd plugin && npm run build` (generates `lib/`)
- **Test**: `node tests/run-all.mjs`

## License

[MIT](LICENSE) © 2026 songoao25
