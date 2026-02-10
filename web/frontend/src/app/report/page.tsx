'use client';

import { useEffect, useMemo, useState } from 'react';

const LS_KEY = 'paperbox.v1';

type PaperTrade = {
  id: string;
  ts: number;
  expiry: string;
  strike: number;
  spot: number;
  targetPct: number;
  pricing: 'MARK' | 'MID';
  callPremUsd: number;
  putPremUsd: number;
  totalCostUsd: number;
  note?: string;
  closedTs?: number;
  closeSpot?: number;
  pnlUsd?: number;
};

export default function ReportPage() {
  const [cash0, setCash0] = useState<number>(0);
  const [riskUsd, setRiskUsd] = useState<number>(0);
  const [pricing, setPricing] = useState<'MARK' | 'MID'>('MARK');
  const [trades, setTrades] = useState<PaperTrade[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      if (typeof obj?.cash0 === 'number') setCash0(obj.cash0);
      if (typeof obj?.riskUsd === 'number') setRiskUsd(obj.riskUsd);
      if (obj?.pricing === 'MID') setPricing('MID');
      if (Array.isArray(obj?.trades)) setTrades(obj.trades);
    } catch {
      // ignore
    }
  }, []);

  const closed = useMemo(() => trades.filter((t) => t.closedTs), [trades]);
  const open = useMemo(() => trades.filter((t) => !t.closedTs), [trades]);

  const pnl = useMemo(() => closed.reduce((a, t) => a + Number(t.pnlUsd || 0), 0), [closed]);
  const equity = useMemo(() => (cash0 || 0) + pnl, [cash0, pnl]);

  const stats = useMemo(() => {
    const n = closed.length;
    if (!n) return { n: 0, win: 0, winrate: 0, avg: 0, sum: 0, best: 0, worst: 0 };
    const wins = closed.filter((t) => Number(t.pnlUsd || 0) > 0).length;
    const sum = closed.reduce((a, t) => a + Number(t.pnlUsd || 0), 0);
    const avg = sum / n;
    const best = Math.max(...closed.map((t) => Number(t.pnlUsd || 0)));
    const worst = Math.min(...closed.map((t) => Number(t.pnlUsd || 0)));
    return { n, win: wins, winrate: (wins / n) * 100, avg, sum, best, worst };
  }, [closed]);

  function exportCsv() {
    const rows = [
      ['id', 'open_ts', 'expiry', 'strike', 'spot_open', 'cost_usd', 'pricing', 'targetPct', 'close_ts', 'spot_close', 'pnl_usd'],
      ...trades.map((t) => [
        t.id,
        new Date(t.ts).toISOString(),
        t.expiry,
        String(t.strike),
        String(t.spot),
        String(t.totalCostUsd),
        t.pricing,
        String(t.targetPct),
        t.closedTs ? new Date(t.closedTs).toISOString() : '',
        t.closeSpot ? String(t.closeSpot) : '',
        t.pnlUsd != null ? String(t.pnlUsd) : '',
      ]),
    ];

    const csv = rows.map((r) => r.map((x) => String(x).replaceAll('"', '""')).map((x) => `"${x}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'paperbox_report.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">Relatório (Paper Trading)</h1>
          <div className="text-xs text-slate-500">Dados locais (localStorage) — por enquanto.</div>
        </div>
        <div className="flex items-center gap-2">
          <a className="text-sm text-slate-300 hover:text-white" href="/desk">Desk</a>
          <button className="text-sm bg-slate-900 border border-slate-800 rounded px-3 py-1 hover:border-slate-600" onClick={exportCsv}>
            Export CSV
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-3">
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4">
          <div className="text-[11px] text-slate-400">Equity (realizado)</div>
          <div className="text-lg font-semibold">${equity.toFixed(2)}</div>
          <div className="text-xs text-slate-400">PnL: {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}</div>
        </div>
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4">
          <div className="text-[11px] text-slate-400">Trades</div>
          <div className="text-sm">Abertas: <span className="font-semibold">{open.length}</span></div>
          <div className="text-sm">Fechadas: <span className="font-semibold">{closed.length}</span></div>
        </div>
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4">
          <div className="text-[11px] text-slate-400">Winrate</div>
          <div className="text-lg font-semibold">{stats.winrate.toFixed(1)}%</div>
          <div className="text-xs text-slate-400">wins: {stats.win}/{stats.n}</div>
        </div>
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4">
          <div className="text-[11px] text-slate-400">Config</div>
          <div className="text-xs text-slate-400">cash0: {cash0}</div>
          <div className="text-xs text-slate-400">riskUsd: {riskUsd}</div>
          <div className="text-xs text-slate-400">pricing: {pricing}</div>
        </div>
      </div>

      <div className="mt-6 bg-slate-900/40 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <div className="text-sm font-semibold">Operações</div>
          <div className="text-xs text-slate-500">(mais KPIs e filtros em breve)</div>
        </div>
        <div className="overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-950 border-b border-slate-800">
              <tr>
                <th className="text-left p-3">Abertura</th>
                <th className="text-left p-3">Expiry</th>
                <th className="text-left p-3">Strike</th>
                <th className="text-left p-3">Spot (in)</th>
                <th className="text-left p-3">Custo</th>
                <th className="text-left p-3">Spot (out)</th>
                <th className="text-left p-3">PnL</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.id} className="border-b border-slate-900">
                  <td className="p-3 text-slate-300">{new Date(t.ts).toLocaleString()}</td>
                  <td className="p-3">{t.expiry}</td>
                  <td className="p-3 font-semibold">{t.strike}</td>
                  <td className="p-3">{Number(t.spot).toFixed(0)}</td>
                  <td className="p-3">${Number(t.totalCostUsd).toFixed(2)} ({t.pricing})</td>
                  <td className="p-3">{t.closeSpot ? Number(t.closeSpot).toFixed(0) : '—'}</td>
                  <td className={`p-3 ${t.pnlUsd != null ? (t.pnlUsd >= 0 ? 'text-emerald-300' : 'text-rose-300') : 'text-slate-500'}`}>
                    {t.pnlUsd != null ? `${t.pnlUsd >= 0 ? '+' : ''}${Number(t.pnlUsd).toFixed(2)}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
