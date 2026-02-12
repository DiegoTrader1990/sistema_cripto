'use client';

import { useEffect, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000';

async function apiGet(path: string) {
  const tok = localStorage.getItem('token') || '';
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${tok}` },
    cache: 'no-store',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || 'request failed');
  return data;
}

export default function ReportMiniCard({ currency }: { currency: 'BTC' | 'ETH' }) {
  const [bot, setBot] = useState<any>(null);
  const [mtm, setMtm] = useState<any>(null);
  const [open, setOpen] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ts, setTs] = useState<number>(0);

  useEffect(() => {
    let alive = true;
    let t: any;

    async function tick() {
      try {
        setErr(null);
        const [b, m, o] = await Promise.all([
          apiGet('/api/bot/status'),
          apiGet(`/api/paper/mtm?currency=${encodeURIComponent(currency)}`),
          apiGet(`/api/paper/open_enriched?currency=${encodeURIComponent(currency)}`),
        ]);
        if (!alive) return;
        setBot(b);
        setMtm(m);
        setOpen(o?.positions || o?.open || []);
        setTs(Date.now());
      } catch (e: any) {
        if (!alive) return;
        setErr(String(e?.message || e));
      }
    }

    tick();
    t = setInterval(tick, 2500);
    return () => {
      alive = false;
      if (t) clearInterval(t);
    };
  }, [currency]);

  const on = Boolean(bot?.enabled ?? bot?.bot_on ?? bot?.on);
  const lastBlock = bot?.last_block_reason || bot?.block_reason || bot?.last_block || '';
  const lastTouch = bot?.last_touch || bot?.last_action_ts || bot?.last_ts || '';

  return (
    <div className="h-full">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs text-slate-500">Bot + Relatório (mini)</div>
        <div className={`text-xs font-semibold ${on ? 'text-emerald-300' : 'text-slate-400'}`}>{on ? 'ON' : 'OFF'}</div>
      </div>

      {err ? <div className="mt-2 text-xs text-amber-300">{err}</div> : null}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-2">
          <div className="text-[11px] text-slate-400">MTM / PnL</div>
          <div className="text-sm font-semibold text-slate-200">{(mtm?.pnl_usd ?? mtm?.pnl ?? '—').toString()}</div>
          <div className="text-[11px] text-slate-500">open={open?.length ?? 0}</div>
        </div>
        <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-2">
          <div className="text-[11px] text-slate-400">Último bloqueio</div>
          <div className="text-[11px] text-slate-200 break-words">{lastBlock || '—'}</div>
          <div className="text-[11px] text-slate-500">ts: {lastTouch || (ts ? new Date(ts).toLocaleTimeString() : '—')}</div>
        </div>
      </div>

      <div className="mt-3">
        <div className="text-[11px] text-slate-400">Últimas posições (paper)</div>
        <div className="mt-1 text-[11px] text-slate-500 max-h-[120px] overflow-auto border border-slate-800 rounded-xl p-2 bg-slate-950/30">
          {open?.length ? (
            <ul className="space-y-1">
              {open.slice(0, 8).map((p: any, i: number) => (
                <li key={i}>
                  <span className="text-slate-300">{p.instrument || p.symbol || '—'}</span>
                  <span className="text-slate-500"> · {p.side || p.dir || ''}</span>
                  <span className="text-slate-500"> · px={p.entry_price ?? p.price ?? p.entry ?? '—'}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div>—</div>
          )}
        </div>
      </div>
    </div>
  );
}
