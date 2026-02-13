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

function fmtUsd(x: number) {
  const v = Number(x || 0);
  const s = v >= 0 ? '+' : '';
  return `${s}$${Math.abs(v).toFixed(2)}`;
}

export default function PositionsPnlCard({ currency }: { currency: string }) {
  const [open, setOpen] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    try {
      setErr(null);
      const o = await apiGet(`/api/paper/open_enriched?limit=12`);
      const rows = (o?.open || []) as any[];
      setOpen(rows.filter((x) => String(x?.currency || '').toUpperCase() === String(currency || '').toUpperCase()));
    } catch (e: any) {
      setErr(String(e?.message || e));
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency]);

  const totals = useMemo(() => {
    let cost = 0;
    let value = 0;
    let pnl = 0;
    for (const t of open || []) {
      cost += Number(t?.entry_cost_usd || 0);
      const mtm = t?.mtm || {};
      value += Number(mtm?.value_usd || 0);
      pnl += Number(mtm?.pnl_usd || 0);
    }
    const pct = cost ? (pnl / cost) * 100 : 0;
    return { cost, value, pnl, pct };
  }, [open]);

  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-2xl overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
        <div className="text-xs font-semibold">Posições (paper) · PnL</div>
        <div className="text-[11px] text-slate-500">{currency}</div>
      </div>
      <div className="p-3">
        {err ? <div className="text-xs text-amber-300">{err}</div> : null}

        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-2">
            <div className="text-[10px] text-slate-400">Custo</div>
            <div className="text-sm font-semibold text-slate-100">${totals.cost.toFixed(2)}</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-2">
            <div className="text-[10px] text-slate-400">Valor</div>
            <div className="text-sm font-semibold text-slate-100">${totals.value.toFixed(2)}</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-2">
            <div className="text-[10px] text-slate-400">PnL</div>
            <div className={totals.pnl >= 0 ? 'text-sm font-semibold text-emerald-300' : 'text-sm font-semibold text-rose-300'}>
              {fmtUsd(totals.pnl)} ({totals.pct >= 0 ? '+' : ''}{totals.pct.toFixed(2)}%)
            </div>
          </div>
        </div>

        <div className="mt-3">
          <div className="text-[11px] text-slate-400">Abertas</div>
          <div className="mt-1 border border-slate-800 rounded-xl bg-slate-950/30 overflow-hidden">
            <div className="max-h-[160px] overflow-auto">
              {open?.length ? (
                <table className="w-full text-[11px]">
                  <thead className="text-slate-500">
                    <tr className="border-b border-slate-800">
                      <th className="text-left px-2 py-1 font-medium">Expiry</th>
                      <th className="text-right px-2 py-1 font-medium">K</th>
                      <th className="text-right px-2 py-1 font-medium">PnL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {open.slice(0, 10).map((t: any, i: number) => {
                      const mtm = t?.mtm || {};
                      const pnl = Number(mtm?.pnl_usd || 0);
                      return (
                        <tr key={i} className="border-b border-slate-900/60">
                          <td className="px-2 py-1 text-slate-300">{String(t?.expiry || '—')}</td>
                          <td className="px-2 py-1 text-right text-slate-100 font-semibold">{Number(t?.strike || 0).toFixed(0)}</td>
                          <td className={pnl >= 0 ? 'px-2 py-1 text-right text-emerald-300 font-semibold' : 'px-2 py-1 text-right text-rose-300 font-semibold'}>
                            {fmtUsd(pnl)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="p-2 text-[11px] text-slate-500">Nenhuma posição aberta.</div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-2 text-[11px] text-slate-500">
          Isso é paper trading (simulação). Quando migrar pra real, manteremos o mesmo painel.
        </div>
      </div>
    </div>
  );
}
