'use client';

import { useEffect, useMemo, useState } from 'react';
import CandlesChart, { type Ohlc } from '@/components/CandlesChart';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000';

type OhlcWithVol = Ohlc & { v?: number[] };

type SymResp = { ok: boolean; symbols: string[]; warning?: string };

type AltOhlcResp = { ok: boolean; exchange: string; symbol: string; tf: string; candles: number; ohlc: OhlcWithVol; warning?: string };

async function apiGet(path: string) {
  const tok = localStorage.getItem('token') || '';
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${tok}` },
    cache: 'no-store',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail || data?.error || 'request failed');
  return data;
}

function pct(a: number, b: number) {
  if (!b) return 0;
  return (a / b - 1) * 100;
}

function sma(xs: number[], n: number) {
  if (xs.length < n) return null;
  const w = xs.slice(-n);
  const s = w.reduce((a, x) => a + Number(x || 0), 0);
  return s / n;
}

function atr(h: number[], l: number[], c: number[], n: number) {
  if (c.length < n + 1) return null;
  const tr: number[] = [];
  for (let i = 1; i < c.length; i++) {
    const hi = Number(h[i] || 0);
    const lo = Number(l[i] || 0);
    const pc = Number(c[i - 1] || 0);
    tr.push(Math.max(hi - lo, Math.abs(hi - pc), Math.abs(lo - pc)));
  }
  if (tr.length < n) return null;
  const w = tr.slice(-n);
  return w.reduce((a, x) => a + x, 0) / n;
}

export default function AltcoinsPage() {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [symbol, setSymbol] = useState<string>('SOLUSDT');
  const [tf, setTf] = useState<string>('15');
  const [candles, setCandles] = useState<number>(400);
  const [ohlc, setOhlc] = useState<OhlcWithVol | null>(null);
  const [exchange, setExchange] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    setErr(null);
    try {
      const data = (await apiGet(`/api/alt/ohlc?symbol=${encodeURIComponent(symbol)}&tf=${encodeURIComponent(tf)}&candles=${encodeURIComponent(String(candles))}`)) as AltOhlcResp;
      setOhlc(data.ohlc);
      setExchange(data.exchange || '');
    } catch (e: any) {
      setErr(String(e?.message || e));
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const s = (await apiGet('/api/alt/symbols')) as SymResp;
        const list = (s.symbols || []).map((x) => String(x || '').toUpperCase()).filter(Boolean);
        setSymbols(list);
        if (list.length && !list.includes(symbol)) setSymbol(list[0]);
      } catch {
        // ignore
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, tf, candles]);

  const last = useMemo(() => {
    if (!ohlc?.c?.length) return null;
    return Number(ohlc.c[ohlc.c.length - 1] || 0);
  }, [ohlc]);

  const stats = useMemo(() => {
    const c = (ohlc?.c || []).map((x) => Number(x || 0));
    const h = (ohlc?.h || []).map((x) => Number(x || 0));
    const l = (ohlc?.l || []).map((x) => Number(x || 0));
    if (c.length < 30) return null;
    const r1 = pct(c[c.length - 1], c[c.length - 2]);
    const r20 = pct(c[c.length - 1], c[c.length - 21]);
    const sma20 = sma(c, 20);
    const sma50 = sma(c, 50);
    const a14 = atr(h, l, c, 14);
    return { r1, r20, sma20, sma50, a14 };
  }, [ohlc]);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-7xl mx-auto p-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-lg font-semibold">Altcoins · Análise</h1>
          <div className="text-xs text-slate-500">{exchange ? `fonte: ${exchange}` : ''}</div>
        </div>

        <div className="mt-4 flex gap-2 flex-wrap items-center">
          <select className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            {(symbols.length ? symbols : [symbol]).slice(0, 400).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <select className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs" value={tf} onChange={(e) => setTf(e.target.value)}>
            <option value="1">1m</option>
            <option value="5">5m</option>
            <option value="15">15m</option>
            <option value="60">1h</option>
            <option value="240">4h</option>
            <option value="1D">1D</option>
          </select>

          <input
            className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs w-[110px]"
            type="number"
            value={candles}
            min={120}
            max={1500}
            onChange={(e) => setCandles(Number(e.target.value || 0))}
          />

          <button className="text-xs bg-slate-900/60 border border-slate-800 rounded px-3 py-2 hover:border-slate-600" onClick={refresh}>
            atualizar
          </button>
        </div>

        {err ? <div className="mt-3 text-sm text-amber-300">{err}</div> : null}

        <div className="mt-4 grid grid-cols-12 gap-4">
          <div className="col-span-12 lg:col-span-8 bg-slate-900/40 border border-slate-800 rounded-2xl overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
              <div className="text-xs font-semibold">Chart</div>
              <div className="text-xs text-slate-500">{symbol} · tf={tf}</div>
            </div>
            <div className="p-3">
              <CandlesChart ohlc={ohlc} levels={[]} />
            </div>
          </div>

          <div className="col-span-12 lg:col-span-4 space-y-4">
            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
                <div className="text-xs font-semibold">Resumo</div>
                <div className="text-xs text-slate-500">{last ? last.toFixed(6) : '—'}</div>
              </div>
              <div className="p-3 text-xs text-slate-300 space-y-2">
                {!stats ? (
                  <div className="text-slate-500">Carregando…</div>
                ) : (
                  <>
                    <div>Retorno 1 candle: <span className={stats.r1 >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{stats.r1 >= 0 ? '+' : ''}{stats.r1.toFixed(2)}%</span></div>
                    <div>Retorno 20 candles: <span className={stats.r20 >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{stats.r20 >= 0 ? '+' : ''}{stats.r20.toFixed(2)}%</span></div>
                    <div>SMA20: <span className="text-slate-200">{stats.sma20?.toFixed?.(6) ?? '—'}</span></div>
                    <div>SMA50: <span className="text-slate-200">{stats.sma50?.toFixed?.(6) ?? '—'}</span></div>
                    <div>ATR14: <span className="text-slate-200">{stats.a14?.toFixed?.(6) ?? '—'}</span></div>
                    <div className="text-[11px] text-slate-500">Ideia: usar SMA20/50 como regime e ATR para sizing/stop.</div>
                  </>
                )}
              </div>
            </div>

            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
                <div className="text-xs font-semibold">Checklist (MVP)</div>
              </div>
              <div className="p-3 text-xs text-slate-300 space-y-2">
                <div>• Tendência: SMA20 vs SMA50</div>
                <div>• Volatilidade: ATR14</div>
                <div>• Alvo: +0.6% a +1.5% (ajustar)</div>
                <div>• Stop: 1×ATR (ajustar)</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
