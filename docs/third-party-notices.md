# Third-party notices

The analyst report's format and checks were informed by three open-source
stock-research projects found under the GitHub `stock-research` topic. **No
source code was copied.** Those projects are Python and Markdown; this app is
TypeScript. What was taken is a method, reimplemented in our own code, and each
is credited here.

| Project | Licence | What informed our code |
| --- | --- | --- |
| [nixiakT/ticker-dossier](https://github.com/nixiakT/ticker-dossier) | MIT | The number-grounding check (`research/debate/orchestrator.py`: `_numbers_grounded`, `_redact_ungrounded_numbers`) → `web/lib/llm/grounding.ts`. The confirmed / gaps / next-checks shape of the research quality gate (`research/analysis/quality.py`) → `web/lib/agent/coverage.ts`. Per-field formatting by type (`research/reporting.py`) → `web/lib/agent/display.ts`. |
| [pppop00/Equity-Research-Company](https://github.com/pppop00/Equity-Research-Company) | Apache-2.0 | Cash-flow and leverage formulas and the controlled "improved / stable / deteriorated / not applicable" vocabulary (`references/financial_metrics.md`) → `qualityMetrics` in `web/lib/agent/metrics.ts` and the status labels in `display.ts`. The style-guide rule that a conclusion leads and figures carry units and periods (`references/report_style_guide_en.md`). |
| [prof-little-bear/cc-equity-research](https://github.com/prof-little-bear/cc-equity-research) | Apache-2.0 | Free cash flow against net income as a forensic check (`community-skills/analyze/financial-forensics.md`, pattern 1). The dated category/description table for nearby events (`community-skills/monitor/event-radar.md`) → `contextRows` in `display.ts`. The "quantify everything, state the period, list sources" rules (`FORMAT.md`). |
| [tradingview/lightweight-charts](https://github.com/tradingview/lightweight-charts) | Apache-2.0 | Used as an npm dependency (not copied) to draw the price and volume chart in `web/components/PriceChart.tsx`. The licence requires crediting TradingView on the page, so the library's built-in attribution link is left on. |

## Considered and not used

[YuzeJ21/Stock-Analysis](https://github.com/YuzeJ21/Stock-Analysis) was read for
its readiness-first design, but its licence ("Controlled Portfolio Demo
License", all rights reserved) forbids using its code, data structure or
documentation in another product. Nothing was taken from it.

Ideas deliberately **not** adopted from any of them, because they conflict with
`CLAUDE.md`'s "Not the product": bull/bear debate with a judge score, investor
framework scores, backtests, price indicators, prediction waterfalls, and
buy / hold / sell style ratings.
