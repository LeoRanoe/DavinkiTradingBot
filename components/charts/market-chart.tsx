"use client";

import { useEffect, useRef } from "react";
import { CandlestickSeries, ColorType, HistogramSeries, LineSeries, createChart } from "lightweight-charts";
import type { ChartCandle } from "@/lib/analytics/chart-data";

export function MarketChart({ candles, height = 420 }: { candles: ChartCandle[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || candles.length === 0) return;
    const chart = createChart(ref.current, { height, width: ref.current.clientWidth, layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#94a3b8" }, grid: { vertLines: { color: "rgba(148,163,184,.08)" }, horzLines: { color: "rgba(148,163,184,.08)" } }, rightPriceScale: { borderColor: "rgba(148,163,184,.18)" }, timeScale: { borderColor: "rgba(148,163,184,.18)", timeVisible: true } });
    const price = chart.addSeries(CandlestickSeries, { upColor: "#34a879", downColor: "#d45b5b", borderVisible: false, wickUpColor: "#34a879", wickDownColor: "#d45b5b" });
    price.setData(candles.map((candle) => ({ time: Math.floor(candle.time / 1000) as never, open: candle.open, high: candle.high, low: candle.low, close: candle.close })));
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "" });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    volume.setData(candles.map((candle) => ({ time: Math.floor(candle.time / 1000) as never, value: candle.volume, color: candle.close >= candle.open ? "rgba(52,168,121,.4)" : "rgba(212,91,91,.4)" })));
    const latest = candles.at(-1);
    const marker = chart.addSeries(LineSeries, { color: "rgba(96,165,250,.65)", lineWidth: 1, priceLineVisible: true, lastValueVisible: true });
    marker.setData(latest ? [{ time: Math.floor(latest.time / 1000) as never, value: latest.close }] : []);
    chart.timeScale().fitContent();
    const observer = new ResizeObserver(() => chart.applyOptions({ width: ref.current?.clientWidth ?? 0 }));
    observer.observe(ref.current);
    return () => { observer.disconnect(); chart.remove(); };
  }, [candles, height]);
  return <div ref={ref} className="w-full overflow-hidden" />;
}
