# 定价来源与复核规则

最后复核：2026-08-22（北京时间）

信息栏中的价格用于展示与本地花费估算，不替代服务商账单。每次调整 `plugin/src/host.js` 的 `PRICING` 前，必须先人工复核相应服务商的正式价格页面，并在提交中同步更新本文件的复核日期和映射说明。

## 来源

- DeepSeek 价格页：<https://api-docs.deepseek.com/quick_start/pricing>
- OpenAI API 价格页：<https://openai.com/api/pricing/>

## 当前映射

- `deepseek-v4-flash-vision-exp` 是当前 DSH 目录中的视觉实验模型。本插件按已确认的产品规则复用 `deepseek-v4-flash` 的峰谷价格；服务商若为该实验模型公布独立价格，必须改为独立条目，不能继续推定复用。
- 未收录的模型不显示峰谷价格，且不应凭名称猜测价格。

定价可能随服务商更新而变化；发布新版本前应重新打开上述正式页面并核对。
