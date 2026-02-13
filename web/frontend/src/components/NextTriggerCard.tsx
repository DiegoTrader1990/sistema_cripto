'use client';

import { useEffect, useMemo, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000';

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

function fmtPct(x: number) {
  const v = Number(x || 0);
  const s = v >= 0 ? '+' : '';
  return `${s}${v.toFixed(2)}%`;
}

export default function NextTriggerCard({ currency }: { currency: string }) {
  const [bot, setBot] = useState<any>(null);
  const [walls, setWalls] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    try {
      setErr(null);
      const s = await apiGet('/api/bot/status');
      const b = s?.bot || null;
      setBot(b);

      const strikeRangePct = Math.max(8, Number(b?.strike_range_pct || 8));
      const dteRanges = encodeURIComponent(String(b?.dte_ranges_exec || '1-2'));
      const path = `/api/desk/walls?currency=${encodeURIComponent(currency)}&mode=all&strike_range_pct=${encodeURIComponent(String(strikeRangePct))}&dte_ranges=${dteRanges}&max_expiries=0&min_dte_days=0&max_dte_days=9999`;
      const w = await apiGet(path);
      setWalls(w);
    } catch (e: any) {
      setErr(String(e?.message || e));
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency]);

  const spot = useMemo(() => Number(walls?.spot || 0), [walls]);
  const flip = useMemo(() => Number(walls?.flip || 0), [walls]);
  const items = useMemo(() => (walls?.walls || []).slice(0, 5), [walls]);

  const flipDistPct = useMemo(() => {
    if (!spot || !flip) return null;
    return (Math.abs(spot - flip) / spot) * 100;
  }, [spot, flip]);

  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-2xl overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
        <div className="text-xs font-semibold">Próximo gatilho</div>
        <div className="text-[11px] text-slate-500">spot {spot ? spot.toFixed(0) : '—'}</div>
      </div>
      <div className="p-3">
        {err ? <div className="text-xs text-amber-300">{err}</div> : null}

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-2">
            <div className="text-[10px] text-slate-400">Gamma flip</div>
            <div className="text-sm font-semibold text-slate-100">{flip ? flip.toFixed(0) : '—'}</div>
            <div className="mt-1 text-[11px] text-slate-400">
              dist: {flipDistPct == null ? '—' : fmtPct(flipDistPct)} · gate: {Number(bot?.near_flip_pct ?? 0).toFixed(2)}%
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-2">
            <div className="text-[10px] text-slate-400">Regras ativas</div>
            <div className="mt-1 text-[11px] text-slate-300 space-y-1">
              <div>• DTE: <span className="text-slate-100 font-semibold">{String(bot?.dte_ranges_exec || '1-2')}</span></div>
              <div>• Walls: top <span className="text-slate-100 font-semibold">{Number(bot?.wall_rank_max || 8)}</span></div>
              <div>• ATR min: <span className="text-slate-100 font-semibold">{Number(bot?.atr_min_pct ?? 0).toFixed(2)}%</span> (tf {String(bot?.atr_tf || '15')})</div>
            </div>
          </div>
        </div>

        <div className="mt-3">
          <div className="text-[11px] text-slate-400">Walls (top 5)</div>
          <div className="mt-1 border border-slate-800 rounded-xl bg-slate-950/30 overflow-hidden">
            <div className="max-h-[150px] overflow-auto">
              {items?.length ? (
                <table className="w-full text-[11px]">
                  <thead className="text-slate-500">
                    <tr className="border-b border-slate-800">
                      <th className="text-left px-2 py-1 font-medium">Strike</th>
                      <th className="text-right px-2 py-1 font-medium">Dist%</th>
                      <th className="text-right px-2 py-1 font-medium">|GEX|</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((w: any, i: number) => {
                      const k = Number(w?.strike || 0);
                      const g = Number(w?.gex || 0);
                      const d = spot ? ((k / spot - 1) * 100) : 0;
                      return (
                        <tr key={i} className="border-b border-slate-900/60">
                          <td className="px-2 py-1 text-slate-100 font-semibold">{k ? k.toFixed(0) : '—'}</td>
                          <td className="px-2 py-1 text-right text-slate-300">{spot ? fmtPct(d) : '—'}</td>
                          <td className="px-2 py-1 text-right text-slate-400">{Math.abs(g).toExponential(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="p-2 text-[11px] text-slate-500">—</div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-2 text-[11px] text-slate-500">
          Interpretação: o bot só entra quando tocar uma dessas walls (top-N) e os gates (flip/ATR/janela) estiverem OK.
        </div>
      </div>
    </div>
  );
}
