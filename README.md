# Bottom Info Bar

**English** | [**中文**](README.zh-CN.md)

[![License: MIT](https://img.shields.io/github/license/songoao25/dsh-bottom-info-bar)](https://github.com/songoao25/dsh-bottom-info-bar/blob/main/LICENSE)
[![Release](https://img.shields.io/github/v/release/songoao25/dsh-bottom-info-bar)](https://github.com/songoao25/dsh-bottom-info-bar/releases)
[![Last commit](https://img.shields.io/github/last-commit/songoao25/dsh-bottom-info-bar)](https://github.com/songoao25/dsh-bottom-info-bar)
[![CI](https://img.shields.io/github/actions/workflow/status/songoao25/dsh-bottom-info-bar/ci.yml)](https://github.com/songoao25/dsh-bottom-info-bar/actions)

A single-line information bar for [DeepSeek Harness](https://github.com/deepseek-ai) that replaces the native stats row under the composer with **provider & model, live balance, peak/off-peak pricing, and real spend** — all in one glance. Install once; it activates automatically on every launch.

## Features

- **Dual-mode billing bar** — Auto-detects whether the active provider is subscription-based (Codex / OpenCode Go) or balance-based. The two modes replace each other, never overlap; balance mode stays exactly as before.
- **Subscription quota display (ChatGPT & OpenCode Go)** — When the active provider is a subscription service, the bar shows the **subscription service + model** (e.g. `OpenCode Go · V4 Flash`), the **5-hour / weekly / monthly quota remaining** per window (remaining = 100 − used, bold and color-coded: **green when >20% remaining**, **amber when ≤20%**), and a **countdown to the next reset** (e.g. `距重置 1d 21h`). In compact mode the shortest-duration window is shown (5-hour preferred; falls back to weekly/monthly if unavailable); in full mode all three windows appear. A ⚠ alert appears when any window drops to 20% or less remaining. Quota is pulled from **two subscription sources**:
  - **ChatGPT / Codex** — reads your ChatGPT subscription quota (Plus / Pro / Team / Enterprise) read-only from `~/.codex/auth.json`. Binding, token refresh and the `openai-codex` model route are **not part of this plugin** — install the companion plugin [**dsh-chatgpt-subscription**](https://github.com/songoao25) (separate repo) to bind your ChatGPT account; this bar only reads the token to display quota. Missing/expired token → "not bound / re-bind" hint instead of an error. **Hover over "⚠ refresh failed"** for details on auto-retry behavior.
  - **OpenCode Go** — reads quota from `opencode.ai/zen/go/v1/usage` via `OPENCODE_GO_API_KEY` (Settings → Models) or the opencode CLI login (`~/.local/share/opencode/auth.json`); missing key → "not configured" hint instead of an error.
  Both sources show the remaining quota and the **reset time** for each of the 5-hour / weekly / monthly windows, so you always know when your quota renews. **Quota and countdown always match** — both come from the same window.
- **Drop-in replacement** — Replaces the native stats row while keeping its core original information (turns/steps, LLM latency, tool calls, cache hit rate, in/out tokens) with a native-consistent layout. Speed metrics (TTFT, tok/s) move to the hover tooltip so the row stays on a single line.
- **Provider & model detection** — Shows the provider and model names exactly as in the model switcher (from the DSH LLM catalog, e.g. `DeepSeek-V4-Flash`); the provider name is bold, and is omitted when it is already a prefix of the model name.
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
git clone https://github.com/songoao25/dsh-bottom-info-bar.git
cd dsh-bottom-info-bar
./install.sh                # installs to the "web" profile; use --profile <name> to override
```

### Option 2 — dsh plugin command

```bash
git clone https://github.com/songoao25/dsh-bottom-info-bar.git
dsh plugin --profile web add /path/to/dsh-bottom-info-bar/plugin
```

> **Restart `dsh web` after installing.** Plugins are composed when the host process starts; a page refresh alone is not enough.

For detailed installation, troubleshooting, and upgrade instructions, see [docs/INSTALL.md](docs/INSTALL.md).

## Usage

- **Hover** the bar for details: balance, per-token pricing, next price-switch time, and this-conversation spend (today / this month / all time).
- **Click** the bar to toggle between full and compact modes.

## Configuration

- **API key**: configure the DeepSeek API key under **Settings → Models** (environment variable `DEEPSEEK_API_KEY`). Without it, the plugin shows a hint and every other feature keeps working.
- **Data scope**: peak hours are 09:00–12:00 and 14:00–18:00 (Beijing time). Built-in pricing covers DeepSeek V4 models plus OpenAI reference prices; models not in the table are excluded from spend statistics.
- **Mode**: the bar switches automatically between balance mode and subscription mode based on the active provider (`codex` / `chatgpt` / `opencode-go` / `opencode` / `openai-codex` → subscription; everything else → balance). An internal `billingMode: 'auto' | 'balance' | 'subscription'` setting (default `auto`) allows forcing a mode.
- **Subscription sources**:
  - **ChatGPT (Codex)**: install the companion plugin [**dsh-chatgpt-subscription**](https://github.com/songoao25) (separate repo) and bind your ChatGPT account once — it maintains the token in `~/.codex/auth.json` (mode `0600`) and registers the ChatGPT models. This bar only **reads** that token to fetch quota (`chatgpt.com/backend-api/wham/usage`); it never refreshes, writes back, or injects credentials. Without a token the bar shows a "not bound — install dsh-chatgpt-subscription to authorize" hint; an expired token shows a "re-bind" hint.
  - **OpenCode Go**: set `OPENCODE_GO_API_KEY` under **Settings → Models**, or log in with the opencode CLI (writes the `opencode-go` entry in `~/.local/share/opencode/auth.json`). Without a key the bar shows a "not configured" hint instead of an error.

#### ChatGPT subscription: known limitations

- The `chatgpt.com` backend is an **undocumented interface** — it may change or stop working at any time; failures degrade gracefully (last snapshot kept, auto-retry), never a crash.
- Available models depend on your subscription plan; model access is provided by the companion plugin **dsh-chatgpt-subscription**.

### Data storage (plugin-owned directory)

All spend data lives in the plugin's own data directory, isolated from other plugins and DSH configuration:

```
~/.dsh/dsh-bottom-info-bar/
└── usage-records.json      # per-request usage ledger (persisted across restarts)
```

- **Location**: `~/.dsh/dsh-bottom-info-bar/` (directory mode `0700`, file mode `0600` — readable only by the current user).
- **Override**: set the environment variable `DSH_BOTTOM_INFO_BAR_DATA_DIR` to relocate the whole data directory (e.g. an external drive or a synced folder).
- **Contents**: one entry per `llm/stream` request (`ts / model / provider / sessionId / input / cacheRead / cacheWrite / output`). No conversation content and no API keys are ever stored.
- **Retention**: capped at 3,000 entries (oldest first).
- **Spend scope**: aggregated in the active provider's currency (CNY for DeepSeek, USD for the OpenAI reference prices); records in other currencies are not mixed in. Models absent from the pricing table are excluded.
- **Reset**: delete the file to clear all statistics. Uninstalling the plugin does not delete your data.

## Uninstall

```bash
cd dsh-bottom-info-bar
./uninstall.sh                       # remove the plugin only
# or: dsh plugin --profile web remove dsh-bottom-info-bar
```

ChatGPT subscription (binding & token maintenance) is owned by the separate plugin `dsh-chatgpt-subscription`; uninstalling this info bar does not touch it.

After restarting, the native stats row returns automatically with no residue (the ledger file under `~/.dsh/dsh-bottom-info-bar/` is your data and is kept; remove it manually if you want to reset the statistics).

## FAQ

| Symptom | Fix |
|---|---|
| Bar does not appear after a page refresh | **Restart** `dsh web` (the host process loads plugins) |
| Balance shows "DEEPSEEK_API_KEY not configured" | Add the key under Settings → Models |
| Balance shows "⚠ refresh failed, showing last snapshot" | Transient network/key issue; retries automatically after 60 s. The last successful data is kept so the bar never goes blank. **Hover over the warning** for a detailed explanation and retry timing. |
| Shows "OpenCode Go not configured" | Add `OPENCODE_GO_API_KEY` under Settings → Models, or configure OpenCode Go in the opencode CLI |
| How do I bind my ChatGPT subscription? | Install the companion plugin **dsh-chatgpt-subscription** and authorize on the official page — it maintains the token this bar reads for quota display |
| ChatGPT quotas look wrong or empty | The wham endpoint is undocumented and may change; failures keep the last snapshot and retry every 60 s. Hover over "⚠ refresh failed" to see the retry explanation. |
| Why does compact mode show a different window? | Compact mode prioritizes the shortest-duration window (5-hour > weekly > monthly) because it refreshes fastest. If the 5-hour window is unavailable, it falls back to weekly or monthly. **Quota and countdown always match** — both come from the same window. |
| Why is the model's reasoning process not shown? | DSH does not render the model's internal reasoning in the UI — a DSH interface-layer limitation, not the plugin's |
| Want the original stats row back | Uninstall the plugin and restart |

## Development

- **Source**: `plugin/src/host.js` (host) + `plugin/src/client-bundle.js` (client)
- **Build**: `cd plugin && npm run build` (generates `lib/`)
- **Test**: `node tests/run-all.mjs`

## License

[MIT](LICENSE) © 2026 songoao25
