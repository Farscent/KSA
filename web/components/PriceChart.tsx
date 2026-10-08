"use client";

import { useEffect, useRef, useState } from "react";
import { AreaSeries, ColorType, createChart, HistogramSeries, LineStyle, type Time } from "lightweight-charts";

import type { PricePoint } from "@/lib/contract/types";
import { idr } from "@/lib/format";

const RANGES = [
  { label: "1M", sessions: 21 },
  { label: "3M", sessions: 63 },
  { label: "All", sessions: Infinity },
] as const;

interface PriceChartProps {
  points: PricePoint[];
  /** The user's average buy price, drawn as a dashed line when they hold the stock. */
  avgPrice?: number;
}

/**
 * Daily close (area) and volume (bars) from the ingested Sectors closes.
 * Close only — Sectors publishes no open/high/low, so there are no candles.
 * Sessions the provider omitted are absent, and a null volume draws no bar.
 * Rendered with TradingView's open-source lightweight-charts (Apache-2.0).
 */
export function PriceChart({ points, avgPrice }: PriceChartProps) {
  const container = useRef<HTMLDivElement>(null);
  const showRange = useRef<(sessions: number) => void>(() => {});
  const [range, setRange] = useState<(typeof RANGES)[number]["label"]>("All");

  useEffect(() => {
    const el = container.current;
    if (!el || points.length === 0) return;

    const chart = createChart(el, {
      height: 380,
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#7b8492", fontFamily: "inherit" },
      grid: { vertLines: { visible: false }, horzLines: { color: "#f0eeea" } },
      rightPriceScale: { borderColor: "#e4e2dd" },
      timeScale: { borderColor: "#e4e2dd" },
      localization: { priceFormatter: (v: number) => idr(v) },
    });

    const price = chart.addSeries(AreaSeries, {
      lineColor: "#2f5670",
      topColor: "rgba(47, 86, 112, 0.25)",
      bottomColor: "rgba(47, 86, 112, 0)",
      lineWidth: 2,
    });
    price.setData(points.map((p) => ({ time: p.trade_date as Time, value: p.close })));
    price.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.28 } });

    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      color: "rgba(123, 132, 146, 0.45)",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volume.setData(
      points.filter((p) => p.volume !== null).map((p) => ({ time: p.trade_date as Time, value: p.volume as number }))
    );

    if (avgPrice !== undefined) {
      price.createPriceLine({
        price: avgPrice,
        color: "#8a5a1e",
        lineStyle: LineStyle.Dashed,
        lineWidth: 1,
        title: "Your avg price",
      });
    }

    showRange.current = (sessions) => {
      if (!Number.isFinite(sessions) || sessions >= points.length) {
        chart.timeScale().fitContent();
      } else {
        chart.timeScale().setVisibleRange({
          from: points[points.length - sessions].trade_date as Time,
          to: points[points.length - 1].trade_date as Time,
        });
      }
    };
    chart.timeScale().fitContent();

    return () => {
      showRange.current = () => {};
      chart.remove();
    };
  }, [points, avgPrice]);

  if (points.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-md"
        style={{ height: 380, background: "var(--color-surface)", color: "var(--color-muted-2)" }}
      >
        <span className="font-mono text-[11px]">No price history ingested yet</span>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex gap-1">
        {RANGES.map((r) => (
          <button
            key={r.label}
            type="button"
            onClick={() => {
              setRange(r.label);
              showRange.current(r.sessions);
            }}
            className="rounded-md px-2.5 py-1 font-mono text-[11px] font-medium"
            style={{
              background: range === r.label ? "var(--color-accent-soft)" : "transparent",
              color: range === r.label ? "var(--color-accent)" : "var(--color-muted)",
            }}
          >
            {r.label}
          </button>
        ))}
      </div>
      <div ref={container} />
    </div>
  );
}
