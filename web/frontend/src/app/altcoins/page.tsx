'use client';

import CandlesChart, { type Ohlc } from '@/components/CandlesChart';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

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

export default function AltcoinsPage() {
  const r = useRouter();
  const [symbols, setSymbols] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [symbol, setSymbol] = useState('SOLUSDT');
  const [tf, setTf] = useState('15');
  const [candles, setCandles] = useState(300);
  const [ohlc, setOhlc] = useState<Ohlc | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function loadSymbols() {
    setErr(null);
    try {
      const data = await apiGet(`/api/alt/symbols?limit=5000`);
      setSymbols(data.symbols || []);
    } catch (e: any) {
      const msg = String(e?.message || e);
      setErr(msg);
      if (msg.includes('unauthorized')) {
        localStorage.removeItem('token');
        r.push('/login');
      }
    }
  }

  async function refresh() {
    setErr(null);
    try {
      const data = await apiGet(`/api/alt/ohlc?symbol=${encodeURIComponent(symbol)}&tf=${encodeURIComponent(tf)}&candles=${candles}`);
      setOhlc(data.ohlc);
    } catch (e: any) {
      const msg = String(e?.message || e);
      setErr(msg);
      if (msg.includes('unauthorized')) {
        localStorage.removeItem('token');
        r.push('/login');
      }
    }
  }

  useEffect(() => {
    loadSymbols();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, tf, candles]);

  const visible = useMemo(() => {
    const q = filter.trim().toUpperCase();
    if (!q) return symbols;
    return symbols.filter((s) => s.includes(q));
  }, [symbols, filter]);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold">Altcoins</h1>
        <a className="text-sm text-slate-400 hover:text-slate-200" href="/desk">Desk</a>
        <a className="text-sm text-slate-400 hover:text-slate-200" href="/news">News</a>
      </div>

      <div className="mt-4 flex gap-3 items-center flex-wrap">
        <label className="text-sm text-slate-300">Filtro</label>
        <input className="bg-slate-900 border border-slate-800 rounded px-2 py-1 w-48" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="ex: SOL, PEPE" />

        <label className="text-sm text-slate-300">Símbolo</label>
        <select className="bg-slate-900 border border-slate-800 rounded px-2 py-1" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
          {visible.slice(0, 300).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <label className="text-sm text-slate-300">TF</label>
        <select className="bg-slate-900 border border-slate-800 rounded px-2 py-1" value={tf} onChange={(e) => setTf(e.target.value)}>
          <option value="1">1</option>
          <option value="5">5</option>
          <option value="15">15</option>
          <option value="60">60</option>
          <option value="240">240</option>
          <option value="1D">1D</option>
        </select>

        <label className="text-sm text-slate-300">Candles</label>
        <input className="bg-slate-900 border border-slate-800 rounded px-2 py-1 w-28" type="number" min={120} max={1500} value={candles} onChange={(e) => setCandles(parseInt(e.target.value || '300', 10))} />

        <button className="bg-blue-600 hover:bg-blue-500 rounded px-3 py-1" onClick={refresh}>
          Atualizar
        </button>

        <button className="bg-slate-800 hover:bg-slate-700 rounded px-3 py-1" onClick={loadSymbols}>
          Recarregar lista
        </button>

        <div className="text-xs text-slate-500">Mostrando {Math.min(visible.length, 300)} de {symbols.length}</div>
      </div>

      {err ? <div className="mt-4 text-sm text-red-400">{err}</div> : null}

      <div className="mt-6 bg-slate-900/40 border border-slate-800 rounded-xl p-4">
        <CandlesChart ohlc={ohlc} />
      </div>
    </main>
  );
}
