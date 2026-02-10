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
}: {
  ohlc: Ohlc | null;
  levels?: GexLevel[];
  onPickPrice?: (price: number) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const linesRef = useRef<any[]>([]);

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

    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    series.setData(data);
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    // clear existing lines
    for (const ln of linesRef.current) {
      try {
        series.removePriceLine(ln);
      } catch {
        // ignore
      }
    }
    linesRef.current = [];

    for (const lv of levels || []) {
      try {
        const ln = series.createPriceLine({
          price: Number(lv.price),
          color: lv.color || 'rgba(99, 102, 241, 0.75)',
          lineWidth: 2,
          lineStyle: 0,
          axisLabelVisible: true,
          title: lv.label || '',
        });
        linesRef.current.push(ln);
      } catch {
        // ignore
      }
    }
  }, [levels]);

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

  return <div ref={ref} className="w-full h-[440px]" />;
}
