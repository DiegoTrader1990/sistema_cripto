'use client';

import { createChart, CrosshairMode, IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import { useEffect, useMemo, useRef } from 'react';

export type Ohlc = { t: number[]; o: number[]; h: number[]; l: number[]; c: number[] };

function toCandles(ohlc: Ohlc) {
  const out: { time: UTCTimestamp; open: number; high: number; low: number; close: number }[] = [];
  const n = Math.min(ohlc.t.length, ohlc.o.length, ohlc.h.length, ohlc.l.length, ohlc.c.length);
  for (let i = 0; i < n; i++) {
    // backend returns seconds (float sometimes)
    const ts = Math.floor(Number(ohlc.t[i]));
    out.push({
      time: ts as UTCTimestamp,
      open: Number(ohlc.o[i]),
      high: Number(ohlc.h[i]),
      low: Number(ohlc.l[i]),
      close: Number(ohlc.c[i]),
    });
  }
  return out;
}

export type GexLevel = { price: number; label?: string; color?: string };

export default function CandlesChart({
  ohlc,
  levels,
  onPickPrice,
  className,
}: {
  ohlc: Ohlc | null;
  levels?: GexLevel[];
  onPickPrice?: (price: number) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const linesRef = useRef<any[]>([]);
  const overlayRef = useRef<any[]>([]);
  const fittedRef = useRef<boolean>(false);

  const data = useMemo(() => (ohlc ? toCandles(ohlc) : []), [ohlc]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Create once
    if (!chartRef.current) {
      const chart = createChart(el, {
        layout: {
          background: { color: 'transparent' },
          textColor: '#cbd5e1',
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial',
        },
        grid: {
          vertLines: { color: 'rgba(148, 163, 184, 0.08)' },
          horzLines: { color: 'rgba(148, 163, 184, 0.08)' },
        },
        rightPriceScale: {
          borderColor: 'rgba(148, 163, 184, 0.15)',
        },
        leftPriceScale: { visible: false },
        timeScale: {
          borderColor: 'rgba(148, 163, 184, 0.15)',
          timeVisible: true,
          secondsVisible: false,
        },
        crosshair: {
          mode: CrosshairMode.Normal,
        },
        handleScroll: true,
        handleScale: true,
      });

      const series = chart.addCandlestickSeries({
        upColor: '#25d695',
        downColor: '#ff4d6d',
        borderVisible: false,
        wickUpColor: '#25d695',
        wickDownColor: '#ff4d6d',
      });

      chartRef.current = chart;
      seriesRef.current = series;
    }

    const chart = chartRef.current!;

    const ro = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect();
      chart.applyOptions({ width: Math.floor(width), height: Math.floor(height) });
    });
    ro.observe(el);

    // initial size
    const { width, height } = el.getBoundingClientRect();
    chart.applyOptions({ width: Math.floor(width), height: Math.floor(height) });

    // Some layouts (grid/resize) finalize after paint; apply size again to avoid "stuck" interactions.
    setTimeout(() => {
      try {
        const { width: w2, height: h2 } = el.getBoundingClientRect();
        chart.applyOptions({ width: Math.floor(w2), height: Math.floor(h2) });
      } catch {
        // ignore
      }
    }, 120);

    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;

    // Preserve the user's current viewport to avoid "jumping" candles on refresh.
    // Only auto-fit once on the initial load.
    let vr: any = null;
    try {
      // @ts-ignore
      vr = chart.timeScale().getVisibleRange?.() || null;
    } catch {
      vr = null;
    }

    series.setData(data);

    if (!fittedRef.current) {
      fittedRef.current = true;
      chart.timeScale().fitContent();
      return;
    }

    if (vr) {
      try {
        // @ts-ignore
        chart.timeScale().setVisibleRange?.(vr);
      } catch {
        // ignore
      }
    }
  }, [data]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;

    // 1) Try native price lines
    for (const ln of linesRef.current) {
      try {
        series.removePriceLine(ln);
      } catch {
        // ignore
      }
    }
    linesRef.current = [];

    let nativeOk = true;
    for (const lv of levels || []) {
      try {
        const ln = series.createPriceLine({
          price: Number(lv.price),
          color: lv.color || 'rgba(99, 102, 241, 0.85)',
          lineWidth: 2,
          lineStyle: 0,
          axisLabelVisible: true,
          title: lv.label || '',
        });
        linesRef.current.push(ln);
      } catch {
        nativeOk = false;
        break;
      }
    }

    // 2) Fallback: overlay line series (always visible)
    for (const s of overlayRef.current) {
      try {
        chart.removeSeries(s);
      } catch {
        // ignore
      }
    }
    overlayRef.current = [];

    if (!nativeOk && (levels || []).length && data.length >= 2) {
      const t0 = data[0].time;
      const t1 = data[data.length - 1].time;
      for (const lv of levels || []) {
        try {
          // @ts-ignore
          const ls = chart.addLineSeries({
            color: lv.color || 'rgba(99, 102, 241, 0.85)',
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false,
          });
          ls.setData([
            { time: t0, value: Number(lv.price) },
            { time: t1, value: Number(lv.price) },
          ]);
          overlayRef.current.push(ls);
        } catch {
          // ignore
        }
      }
    }
  }, [levels, data]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series || !onPickPrice) return;

    const handler = (param: any) => {
      // v4: use click point -> price
      const y = param?.point?.y;
      if (typeof y !== 'number') return;
      // @ts-ignore
      const price = Number(series.coordinateToPrice(y));
      if (price > 0) onPickPrice(price);
    };

    // @ts-ignore
    chart.subscribeClick(handler);
    return () => {
      // @ts-ignore
      chart.unsubscribeClick(handler);
    };
  }, [onPickPrice]);

  return <div ref={ref} className={className || "w-full h-[440px]"} />;
}
