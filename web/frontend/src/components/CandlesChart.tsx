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

export type GexLevel = { price: number; label?: string; color?: string; width?: number; style?: number };

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
        handleScroll: {
          mouseWheel: true,
          pressedMouseMove: true,
          horzTouchDrag: true,
          vertTouchDrag: true,
        },
        handleScale: {
          axisPressedMouseMove: true,
          mouseWheel: true,
          pinch: true,
        },
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
    const reapply = () => {
      try {
        const { width: w2, height: h2 } = el.getBoundingClientRect();
        chart.applyOptions({ width: Math.floor(w2), height: Math.floor(h2) });
      } catch {
        // ignore
      }
    };

    setTimeout(reapply, 120);
    // also reapply after first user interaction edge-cases
    setTimeout(reapply, 450);

    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;

    // Preserve the user's current viewport to avoid "jumping" candles on refresh.
    // Only auto-fit once on the initial load.
    let logical: any = null;
    let rightOffset: number | null = null;
    try {
      // Prefer logical range (more stable across updates)
      // @ts-ignore
      logical = chart.timeScale().getVisibleLogicalRange?.() || null;
      // @ts-ignore
      rightOffset = typeof chart.timeScale().getRightOffset === 'function' ? Number(chart.timeScale().getRightOffset()) : null;
    } catch {
      logical = null;
      rightOffset = null;
    }

    // Heuristic: if user is at the right edge, keep following real-time; otherwise preserve the manual viewport.
    const followRealTime = rightOffset != null && rightOffset <= 2;

    series.setData(data);

    if (!fittedRef.current) {
      fittedRef.current = true;
      chart.timeScale().fitContent();
      return;
    }

    if (followRealTime) {
      try {
        chart.timeScale().scrollToRealTime();
        return;
      } catch {
        // ignore
      }
    }

    if (logical) {
      try {
        // @ts-ignore
        chart.timeScale().setVisibleLogicalRange?.(logical);
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
          // lightweight-charts LineWidth is restricted (commonly 1..4). Keep within range for TS + runtime.
          lineWidth: Math.max(1, Math.min(4, Number(lv.width || 2))) as any,
          lineStyle: typeof lv.style === 'number' ? lv.style : 0,
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
            // lightweight-charts LineWidth is restricted (commonly 1..4). Keep within range for TS + runtime.
            lineWidth: Math.max(1, Math.min(4, Number(lv.width || 2))) as any,
            // @ts-ignore
            lineStyle: typeof lv.style === 'number' ? lv.style : 0,
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
  }, [onPickPrice, levels?.length]);

  return <div ref={ref} className={className || "w-full h-[440px]"} style={{ touchAction: 'none' }} />;
}
