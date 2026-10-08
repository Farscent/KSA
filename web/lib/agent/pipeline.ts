import "server-only";

/**
 * The research pipeline: a declarative list of steps, run in order, yielding
 * an event per step.
 *
 * It is an AsyncGenerator on purpose. Part 2 drains it and saves the result;
 * Part 3's streaming route will consume the very same generator and forward
 * each event to the browser, so the live step log becomes a thin route
 * handler rather than a second implementation of this logic.
 *
 * Failure policy: a step that throws marks itself `failed` and the run
 * continues. The headline broker-flow section reads from Supabase and needs no
 * Sectors call, so the report still has its most important section even if the
 * Sectors API is entirely unreachable.
 */

import { fetchComponents, fetchFlowSeries, fetchPositions } from "@/lib/data/results";
import { fetchHoldings } from "@/lib/holdings/data";
import { SHARES_PER_LOT } from "@/lib/holdings/units";
import { computeVerdict } from "@/lib/verdict";
import { getAlert } from "@/lib/data/source";
import { CreditLedger, CreditCeilingError, SectorsError } from "@/lib/sectors/cache";
import {
  companyReport,
  corporateActions,
  filings,
  news,
  subsectorReport,
} from "@/lib/sectors/endpoints";
import {
  projectDividend,
  projectFinancials,
  projectFuture,
  projectIdentity,
  projectNearbyContext,
  projectPeers,
  projectSubsector,
  projectValuation,
} from "@/lib/research/project";
import { unavailable } from "@/lib/research/types";
import { peerMetrics, positionMetrics, valuationMetrics } from "@/lib/agent/metrics";
import type { ResearchPackage, StepStatus, StepTrace } from "@/lib/agent/package";
import type { ServeComponentsRecord, ServeFlowSeriesRecord } from "@/lib/contract/types";

export interface StepEvent {
  type: "step";
  id: string;
  label: string;
  status: "running" | StepStatus;
  detail?: string;
  credits?: number;
  duration_ms?: number;
}

export interface DoneEvent {
  type: "done";
  package: ResearchPackage;
}

export type PipelineEvent = StepEvent | DoneEvent;

/** Mutable state threaded through the steps. */
interface Context {
  symbol: string;
  ledger: CreditLedger;
  pkg: ResearchPackage;
  /** Raw payloads a later step needs; kept out of the package itself. */
  raw: Record<string, unknown>;
}

interface Step {
  id: string;
  label: string;
  /** Returns the detail line shown in the step log. */
  run(ctx: Context): Promise<string>;
}

function emptyPackage(symbol: string): ResearchPackage {
  const none = { value: null, value_status: "UNAVAILABLE" as const, reason_codes: ["NOT_RUN"] };
  return {
    symbol,
    trade_date: "",
    verdict: "Healthy",
    flow: { components: null, series: [] },
    position: {
      lots: none, shares: none, average_price: none, cost_basis: none, last_close: none,
      market_value: none, unrealised_pl: none, unrealised_pl_pct: none, portfolio_weight_pct: none,
    },
    identity: unavailable("NOT_RUN"),
    valuation: unavailable("NOT_RUN"),
    valuation_metrics: {
      last_close: none, forward_pe: none, sectors_intrinsic_value: none,
      close_vs_intrinsic_pct: none, latest_pe: none, latest_pe_peer_avg: none, latest_valuation_year: none,
    },
    financials: unavailable("NOT_RUN"),
    future: unavailable("NOT_RUN"),
    dividend: unavailable("NOT_RUN"),
    peers: unavailable("NOT_RUN"),
    peer_metrics: {
      screened: none, eligible: none, excluded: [], self: null,
      peer_median_pe: none, peer_median_pb: none, self_pe_percentile: none, self_pb_percentile: none,
      pe_vs_peer_median: none, pb_vs_peer_median: none, subsector_median_pe: none,
    },
    subsector: unavailable("NOT_RUN"),
    context: unavailable("NOT_RUN"),
    // Declared, not omitted: there is no search provider configured, and a
    // macro figure without a source URL must never be stated.
    macro: unavailable("NO_SEARCH_PROVIDER"),
    provenance: [],
    steps: [],
    credits_used: 0,
  };
}

const STEPS: Step[] = [
  {
    id: "position",
    label: "Reading your position",
    async run(ctx) {
      const [positions, holdings] = await Promise.all([fetchPositions(), fetchHoldings()]);
      const position = positions.find((p) => p.symbol === ctx.symbol) ?? null;
      const holding = holdings.find((h) => h.sym === ctx.symbol) ?? null;
      const close = position?.value_status === "AVAILABLE" ? position.close : null;

      // Portfolio market value, for this position's weight. Only computable
      // when every held symbol has a close — same rule as computeTotals.
      const bySymbol = new Map(positions.map((p) => [p.symbol, p]));
      let portfolioValue: number | null = 0;
      for (const h of holdings) {
        const p = bySymbol.get(h.sym);
        if (!p || p.value_status !== "AVAILABLE" || p.close === null) {
          portfolioValue = null;
          break;
        }
        portfolioValue += h.lots * SHARES_PER_LOT * p.close;
      }

      ctx.pkg.position = positionMetrics(
        holding ? { lots: holding.lots, avg: holding.avg } : null,
        close,
        portfolioValue
      );
      // A provisional date, so the package is never dateless; the flow step
      // overwrites it with the scored trade date when components exist.
      if (position?.close_date) ctx.pkg.trade_date = position.close_date;
      return holding
        ? `${holding.lots} lots at avg ${holding.avg}`
        : "not currently held — reviewing anyway";
    },
  },
  {
    id: "flow",
    label: "Loading broker-flow structure",
    async run(ctx) {
      const [components, series] = await Promise.all([
        fetchComponents([ctx.symbol]) as Promise<ServeComponentsRecord[]>,
        fetchFlowSeries([ctx.symbol]) as Promise<ServeFlowSeriesRecord[]>,
      ]);
      const record = components[0] ?? null;
      ctx.pkg.flow = { components: record, series };
      if (record?.trade_date) ctx.pkg.trade_date = record.trade_date;
      ctx.pkg.verdict = computeVerdict(getAlert(ctx.symbol), record ?? undefined);

      if (!record) return "no scored components yet — run the Python batch";
      const parts: string[] = [];
      if (record.concentration.value_status === "AVAILABLE") {
        parts.push(`CR3 ${record.concentration.share} vs baseline ${record.concentration.baseline_share}`);
      }
      if (record.breadth.value_status === "AVAILABLE") {
        parts.push(`${record.breadth.changed}/${record.breadth.active} brokers changed side`);
      }
      if (record.persistence.value_status === "AVAILABLE") {
        parts.push(`${record.persistence.same_direction}/${record.persistence.of_sessions} sessions`);
      }
      return parts.join(" · ") || "components present but not measurable";
    },
  },
  {
    id: "identity",
    label: "Fetching company profile",
    async run(ctx) {
      const { payload } = await companyReport(ctx.symbol, ["overview"], ctx.ledger);
      ctx.pkg.identity = projectIdentity(payload);
      const data = ctx.pkg.identity.data;
      return data ? `${data.company_name ?? ctx.symbol} · ${data.sub_sector ?? "unknown subsector"}` : "no overview";
    },
  },
  {
    id: "financials",
    label: "Reading financials",
    async run(ctx) {
      const { payload } = await companyReport(ctx.symbol, ["financials"], ctx.ledger);
      ctx.pkg.financials = projectFinancials(payload);
      // Deliberately annual-only. `quarterlyFinancials` exists in
      // lib/sectors/endpoints.ts but is not called here: it bills 1 credit per
      // quarter, and the report's growth figures already come from this
      // section's own `yoy_quarter_*` fields and annual series. Wire it in only
      // if a section actually needs quarter-by-quarter line items.
      const data = ctx.pkg.financials.data;
      if (!data) return "no financials section";
      const years = data.historical_financials.length;
      return `${years} annual periods${data.roe !== null ? ` · ROE ${(data.roe * 100).toFixed(1)}%` : ""}`;
    },
  },
  {
    id: "valuation",
    label: "Fetching valuation and forecasts",
    async run(ctx) {
      const { payload } = await companyReport(ctx.symbol, ["valuation", "future", "dividend"], ctx.ledger);
      ctx.pkg.valuation = projectValuation(payload);
      ctx.pkg.future = projectFuture(payload);
      ctx.pkg.dividend = projectDividend(payload);
      ctx.pkg.valuation_metrics = valuationMetrics(ctx.pkg.valuation);
      const v = ctx.pkg.valuation.data;
      const rating = ctx.pkg.future.data?.analyst_rating_breakdown;
      const bits: string[] = [];
      if (v?.forward_pe != null) bits.push(`forward P/E ${v.forward_pe.toFixed(2)}`);
      if (rating?.n_analyst != null) bits.push(`${rating.n_analyst} analysts`);
      return bits.join(" · ") || "valuation section empty";
    },
  },
  {
    id: "peers",
    label: "Screening peers",
    async run(ctx) {
      const { payload } = await companyReport(ctx.symbol, ["peers"], ctx.ledger);
      ctx.pkg.peers = projectPeers(payload);

      // The subsector slug comes from the peers payload itself, so no extra
      // lookup call is needed. Cached by slug, so the demo universe's four
      // banks pay for this once between them.
      const slug =
        ctx.pkg.identity.data?.sub_sector_slug ??
        (ctx.pkg.peers.data?.sub_sector
          ? ctx.pkg.peers.data.sub_sector.toLowerCase().replace(/[^a-z0-9]+/g, "-")
          : null);
      if (slug) {
        try {
          const sub = await subsectorReport(slug, ["statistics", "valuation", "growth"], ctx.ledger);
          ctx.pkg.subsector = projectSubsector(sub.payload);
        } catch (err) {
          ctx.pkg.subsector = unavailable(
            err instanceof SectorsError ? err.reason_code : "SUBSECTOR_FETCH_FAILED"
          );
        }
      } else {
        ctx.pkg.subsector = unavailable("NO_SUBSECTOR_SLUG");
      }

      ctx.pkg.peer_metrics = peerMetrics(ctx.pkg.peers, ctx.pkg.subsector);
      const m = ctx.pkg.peer_metrics;
      return `${m.screened.value ?? 0} screened · ${m.excluded.length} excluded · ${m.eligible.value ?? 0} comparable`;
    },
  },
  {
    id: "context",
    label: "Gathering nearby context",
    async run(ctx) {
      // Settled, not all-or-nothing: a missing filings feed should not cost us
      // the news list. Context is suppression evidence, never a cause.
      const [newsRes, filingsRes, actionsRes] = await Promise.allSettled([
        news(ctx.symbol, ctx.ledger),
        filings(ctx.symbol, ctx.ledger),
        corporateActions(ctx.symbol, ctx.ledger),
      ]);
      const value = (r: PromiseSettledResult<{ payload: unknown }>) =>
        r.status === "fulfilled" ? r.value.payload : null;

      ctx.pkg.context = projectNearbyContext(value(newsRes), value(filingsRes), value(actionsRes));
      const data = ctx.pkg.context.data;
      if (!data) return "no nearby context found";
      return `${data.news.length} news · ${data.filings.length} filings · ${data.corporate_actions.length} corporate actions`;
    },
  },
];

/**
 * Runs the research pipeline for one symbol, yielding an event per step.
 *
 * Consume with `for await`. The final event is `{type: "done"}` carrying the
 * assembled package.
 */
export async function* runPipeline(symbol: string): AsyncGenerator<PipelineEvent> {
  const ctx: Context = { symbol, ledger: new CreditLedger(), pkg: emptyPackage(symbol), raw: {} };
  let ceilingHit = false;

  for (const step of STEPS) {
    if (ceilingHit) {
      const trace: StepTrace = {
        id: step.id,
        label: step.label,
        status: "skipped",
        detail: "credit ceiling reached",
        credits: 0,
        duration_ms: 0,
      };
      ctx.pkg.steps.push(trace);
      yield { type: "step", ...trace };
      continue;
    }

    yield { type: "step", id: step.id, label: step.label, status: "running" };
    const started = Date.now();
    const creditsBefore = ctx.ledger.used;
    let status: StepStatus = "done";
    let detail: string;

    try {
      detail = await step.run(ctx);
    } catch (err) {
      if (err instanceof CreditCeilingError) {
        ceilingHit = true;
        status = "skipped";
        detail = err.message;
      } else {
        status = "failed";
        detail =
          err instanceof SectorsError
            ? `${err.reason_code}: ${err.message}`
            : err instanceof Error
              ? err.message
              : "step failed";
      }
    }

    const trace: StepTrace = {
      id: step.id,
      label: step.label,
      status,
      detail,
      credits: ctx.ledger.used - creditsBefore,
      duration_ms: Date.now() - started,
    };
    ctx.pkg.steps.push(trace);
    yield { type: "step", ...trace };
  }

  ctx.pkg.provenance = ctx.ledger.provenance;
  ctx.pkg.credits_used = ctx.ledger.used;
  if (!ctx.pkg.trade_date) ctx.pkg.trade_date = new Date().toISOString().slice(0, 10);

  yield { type: "done", package: ctx.pkg };
}

/** Drains the pipeline for callers that do not stream (the current server action). */
export async function runResearch(symbol: string): Promise<ResearchPackage> {
  let pkg: ResearchPackage | null = null;
  for await (const event of runPipeline(symbol)) {
    if (event.type === "done") pkg = event.package;
  }
  if (!pkg) throw new Error("pipeline produced no package");
  return pkg;
}
