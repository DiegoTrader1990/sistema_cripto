'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import CandlesChart, { type Ohlc } from '@/components/CandlesChart';
import PaperBoxCard from '@/components/PaperBoxCard';
import ResponsiveDeskLayout from '@/components/ResponsiveDeskLayout';
import DeskLayoutControls from '@/components/DeskLayoutControls';
import StrategyPlannerCard from '@/components/StrategyPlannerCard';
import SpotPulseCard from '@/components/SpotPulseCard';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000';

type OhlcWithVol = Ohlc & { v?: number[] };

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

export default function DeskPage() {
  const r = useRouter();
  const [instrument, setInstrument] = useState('BTC-PERPETUAL');
  const [tf, setTf] = useState('60');
  const [candles, setCandles] = useState(900);
  const [liveOn, setLiveOn] = useState<boolean>(true);
  const [liveSec, setLiveSec] = useState<number>(8);
  const [chartCfgOpen, setChartCfgOpen] = useState<boolean>(false);
  const [ohlc, setOhlc] = useState<OhlcWithVol | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [bootLoading, setBootLoading] = useState<boolean>(true);
  const [bootMsg, setBootMsg] = useState<string>('Carregando…');
  const [bootPct, setBootPct] = useState<number>(10);

  // responsive
  const [view, setView] = useState<'DESKTOP' | 'TABLET' | 'MOBILE'>('DESKTOP');
  const [mobileTab, setMobileTab] = useState<'CHART' | 'CHAIN' | 'PLANNER' | 'PAPER' | 'OPS'>('CHART');

  // options/gex
  const [expiry, setExpiry] = useState<string>('');
  const [expiries, setExpiries] = useState<string[]>([]);
  const [gexOn, setGexOn] = useState<boolean>(true);
  const [gexMode, setGexMode] = useState<'ALL' | 'EXPIRY'>('ALL');
  const [gexN, setGexN] = useState<number>(24); // number of expiries aggregated when mode=ALL
  const [gexMinDte, setGexMinDte] = useState<number>(0);
  const [gexMaxDte, setGexMaxDte] = useState<number>(9999);
  const [gexRanges, setGexRanges] = useState<{ key: string; label: string; a: number; b: number; on: boolean }[]>([
    { key: 'd1', label: '1DTE', a: 1, b: 1, on: true },
    { key: 'd2', label: '2DTE', a: 2, b: 2, on: true },
    { key: 'd3_5', label: '3–5', a: 3, b: 5, on: false },
    { key: 'd6_10', label: '6–10', a: 6, b: 10, on: false },
    { key: 'd11_30', label: '11–30', a: 11, b: 30, on: false },
  ]);
  const [gexLevels, setGexLevels] = useState<{ strike: number; gex: number }[]>([]);
  const [wallsN, setWallsN] = useState<number>(18);
  const [gexExpSel, setGexExpSel] = useState<string[]>([]); // explicit expiries selection for GEX ALL
  const [gexAudit, setGexAudit] = useState<string>('');
  const [flip, setFlip] = useState<number | null>(null);
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);
  const [planTargetPct, setPlanTargetPct] = useState<number>(1.5);
  // chain state removed (unused)
  const [perStrike, setPerStrike] = useState<any[]>([]);
  const [strikeRangePct, setStrikeRangePct] = useState<number>(5);

  const [optErr, setOptErr] = useState<string | null>(null);

  async function refresh() {
    setErr(null);
    setOptErr(null);

    try {
      if (bootLoading) {
        setBootMsg('Carregando gráfico…');
        setBootPct(20);
      }
      const data = await apiGet(
        `/api/desk/ohlc?instrument=${encodeURIComponent(instrument)}&tf=${encodeURIComponent(tf)}&candles=${candles}`
      );
      setOhlc(data.ohlc);
    } catch (e: any) {
      setErr(String(e?.message || e));
      if (String(e?.message || '').includes('unauthorized')) {
        localStorage.removeItem('token');
        r.push('/login');
      }
      setBootLoading(false);
      return;
    }

    // options/gex
    try {
      if (bootLoading) {
        setBootMsg('Carregando vencimentos (expiries)…');
        setBootPct(40);
      }
      const ex = await apiGet(`/api/desk/expiries?currency=${instrument.startsWith('ETH') ? 'ETH' : 'BTC'}`);
      const exs = (ex.expiries || []) as string[];
      setExpiries(exs);

      // Default explicit expiries selection for GEX ALL: first 2 (D1/D2) if empty.
      if (!gexExpSel.length && exs.length) {
        setGexExpSel(exs.slice(0, 2));
      }

      const chosen = expiry || exs[0] || '';
      setExpiry(chosen);
      if (chosen) {
        const currency = instrument.startsWith('ETH') ? 'ETH' : 'BTC';

        // 1) Chain (execution pricing) is per-expiry (D1/D2/manual)
        if (bootLoading) {
          setBootMsg('Carregando chain (opções)…');
          setBootPct(60);
        }
        const cg = await apiGet(`/api/desk/chain?currency=${currency}&expiry=${encodeURIComponent(chosen)}`);
        setFlip(cg.flip ?? null);
        const chainRows = cg.chain || [];

        // 2) Walls strength: ALL expiries (user requested)
        try {
          if (gexMode === 'ALL') {
            if (bootLoading) {
              setBootMsg('Carregando walls (GEX ALL)…');
              setBootPct(85);
            }
            const ranges = (gexRanges || []).filter((r) => r.on).map((r) => `${r.a}-${r.b}`).join(',');
            const expCsv = (gexExpSel || []).join(',');
            const all = await apiGet(
              `/api/desk/walls?currency=${currency}&mode=all&strike_range_pct=${encodeURIComponent(String(Math.max(8, strikeRangePct)))}&max_expiries=${encodeURIComponent(String(gexN || 0))}&min_dte_days=${encodeURIComponent(String(gexMinDte || 0))}&max_dte_days=${encodeURIComponent(String(gexMaxDte || 9999))}&dte_ranges=${encodeURIComponent(ranges)}&expiries_csv=${encodeURIComponent(expCsv)}`
            );
            setGexLevels((all.walls || []).map((w: any) => ({ strike: Number(w.strike), gex: Number(w.gex) })));
            setWallsN((all.walls || []).length || 18);
            setGexAudit(`expiries_used=${(all.expiries_used_n ?? (all.expiries_used?.length ?? '—'))} | dte_ranges=${all.dte_ranges || ''} | max_expiries=${all.max_expiries || ''}`);
            setOptErr(null);
          } else {
            setGexLevels((cg.walls || []).map((w: any) => ({ strike: Number(w.strike), gex: Number(w.gex) })));
            setWallsN((cg.walls || []).length || 18);
          }
        } catch {
          // fallback to expiry walls
          setGexLevels((cg.walls || []).map((w: any) => ({ strike: Number(w.strike), gex: Number(w.gex) })));
          setWallsN((cg.walls || []).length || 18);
        }

        const ps = (cg.per_strike || []) as any[];
        if (ps && ps.length) {
          setPerStrike(ps);
        } else {
          const m = new Map<number, any>();
          for (const row of chainRows) {
            const k = Number(row.strike);
            if (!m.has(k)) m.set(k, { strike: k, call: null, put: null, net_gex: 0, call_gex: 0, put_gex: 0 });
            const it = m.get(k);
            if (row.option_type === 'call') it.call = row;
            if (row.option_type === 'put') it.put = row;
          }
          setPerStrike(Array.from(m.values()).sort((a, b) => a.strike - b.strike));
        }
      }
    } catch (e: any) {
      setOptErr(String(e?.message || e));
    } finally {
      if (bootLoading) {
        setBootMsg('Pronto.');
        setBootPct(100);
        // small delay so user sees 100%
        setTimeout(() => setBootLoading(false), 250);
      } else {
        setBootLoading(false);
      }
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instrument, tf, candles]);

  // ESC closes config panel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setChartCfgOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const calc = () => {
      const w = window.innerWidth || 1200;
      if (w < 640) return setView('MOBILE');
      if (w < 1024) return setView('TABLET');
      return setView('DESKTOP');
    };
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, []);

  useEffect(() => {
    // When config panel is open, pause live refresh so the UI doesn't "fight" touch/click.
    if (!liveOn) return;
    if (chartCfgOpen) return;
    const ms = Math.max(3000, Math.min(60000, Number(liveSec || 8) * 1000));
    const t = setInterval(() => {
      refresh();
    }, ms);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveOn, liveSec, instrument, tf, candles, expiry, gexOn, chartCfgOpen]);

  const last = useMemo(() => {
    if (!ohlc?.c?.length) return null;
    return ohlc.c[ohlc.c.length - 1];
  }, [ohlc]);

  const byStrike = useMemo(() => {
    const m = new Map<number, any>();
    for (const rr of perStrike || []) m.set(Number(rr.strike), rr);
    return m;
  }, [perStrike]);

  const strikeRows = useMemo(() => {
    const spot = Number(last || 0);
    const center = Number(selectedStrike || 0) || spot;
    if (!center) return Array.from(byStrike.values());
    const lo = center * (1 - strikeRangePct / 100);
    const hi = center * (1 + strikeRangePct / 100);
    return Array.from(byStrike.values()).filter((rr) => Number(rr.strike) >= lo && Number(rr.strike) <= hi);
  }, [byStrike, last, strikeRangePct, selectedStrike]);

  const selected = useMemo(() => {
    if (!selectedStrike) return null;
    return byStrike.get(Number(selectedStrike)) || null;
  }, [byStrike, selectedStrike]);

  const maxAbsWall = useMemo(() => {
    let m = 0;
    for (const w of gexLevels || []) m = Math.max(m, Math.abs(Number(w.gex || 0)));
    return m || 1;
  }, [gexLevels]);

  return (
    <main className="min-h-screen text-slate-100 p-6 relative overflow-hidden bg-slate-950">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 -left-40 w-[680px] h-[680px] rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="absolute -bottom-48 -right-48 w-[720px] h-[720px] rounded-full bg-fuchsia-500/10 blur-3xl" />
        <div className="absolute inset-0 opacity-[0.12] bg-[radial-gradient(circle_at_30%_20%,rgba(59,130,246,0.12),transparent_40%),radial-gradient(circle_at_80%_30%,rgba(168,85,247,0.10),transparent_45%),radial-gradient(circle_at_50%_85%,rgba(34,197,94,0.06),transparent_50%)]" />
      </div>
      <div className="relative">

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl font-bold">My Friend Cripto</h1>
          <nav className="flex items-center gap-2">
            <a className="text-sm text-slate-400 hover:text-slate-200" href="/news">News</a>
            <a className="text-sm text-slate-400 hover:text-slate-200" href="/report">Relatório</a>
            <a className="text-sm text-slate-400 hover:text-slate-200" href="/help">Tutorial</a>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <DeskLayoutControls />
          <a className="text-sm bg-slate-900 border border-slate-800 rounded px-3 py-1 hover:border-slate-600" href="/login">Trocar login</a>
        </div>
      </div>

      {err ? <div className="mt-4 text-sm text-red-400">{err}</div> : null}

      {bootLoading ? (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 w-[min(520px,90vw)]">
            <div className="text-lg font-bold">Aguarde My Friend…</div>
            <div className="mt-2 text-sm text-slate-300">{bootMsg}</div>
            <div className="mt-4 h-2 rounded bg-slate-800 overflow-hidden">
              <div className="h-2 bg-blue-600 transition-all duration-300" style={{ width: `${Math.max(5, Math.min(100, bootPct))}%` }} />
            </div>
            <div className="mt-2 text-xs text-slate-400">{bootPct.toFixed(0)}%</div>
            <div className="mt-3 text-xs text-slate-500">Se demorar, pode ser o Render “acordando”.</div>
          </div>
        </div>
      ) : null}

      {/* Nodes for responsive layouts */}
      {(() => {
        const chartNode = (
          <div className="aspect-square relative">
            <div className="absolute left-2 top-2 z-20">
              <button
                className="bg-slate-950/70 backdrop-blur border border-slate-800 rounded-xl px-2 py-2 hover:border-slate-600"
                onClick={() => setChartCfgOpen((v) => !v)}
                title="Configurações"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" stroke="rgba(226,232,240,0.9)" strokeWidth="1.6" />
                  <path d="M19.4 15a7.9 7.9 0 0 0 .1-1l2-1.5-2-3.5-2.4.6a8 8 0 0 0-.8-.6l-.3-2.4h-4l-.3 2.4-.8.6-2.4-.6-2 3.5 2 1.5a7.9 7.9 0 0 0 .1 1l-2 1.5 2 3.5 2.4-.6c.2.2.5.4.8.6l.3 2.4h4l.3-2.4c.3-.2.6-.4.8-.6l2.4.6 2-3.5-2-1.5Z" stroke="rgba(226,232,240,0.55)" strokeWidth="1.4" />
                </svg>
              </button>

              {chartCfgOpen ? (
                <>
                  <div className="fixed inset-0 z-[79] bg-black/40" onClick={() => setChartCfgOpen(false)} />
                  <div className="fixed left-6 top-20 z-[80] bg-slate-950/90 backdrop-blur border border-slate-800 rounded-2xl px-3 py-3 shadow-[0_0_0_1px_rgba(148,163,184,0.06)] w-[min(560px,92vw)] max-h-[74vh] overflow-auto">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-slate-200">Configurações</div>
                    <button className="text-xs text-slate-400 hover:text-slate-200" onClick={() => setChartCfgOpen(false)}>
                      fechar
                    </button>
                  </div>

                  <div className="mt-3 pr-1 space-y-3">
                    <div>
                      <div className="text-[10px] text-slate-400">Instrument</div>
                      <select className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-2 py-1 text-xs" value={instrument} onChange={(e) => setInstrument(e.target.value)}>
                        <option>BTC-PERPETUAL</option>
                        <option>ETH-PERPETUAL</option>
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="text-[10px] text-slate-400">TF</div>
                        <select className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-2 py-1 text-xs" value={tf} onChange={(e) => setTf(e.target.value)}>
                          <option value="1">1m</option>
                          <option value="5">5m</option>
                          <option value="15">15m</option>
                          <option value="60">1h</option>
                          <option value="240">4h</option>
                          <option value="1D">1D</option>
                        </select>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400">Candles</div>
                        <input className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-2 py-1 text-xs" type="number" min={120} max={3000} value={candles} onChange={(e) => setCandles(parseInt(e.target.value || '900', 10))} />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="text-[10px] text-slate-400">Expiry (execução)</div>
                        <select className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-2 py-1 text-xs" value={expiry} onChange={(e) => setExpiry(e.target.value)}>
                          {expiries.map((e) => (
                            <option key={e} value={e}>
                              {e}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400">Range%</div>
                        <input className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-2 py-1 text-xs" type="number" min={1} max={30} step={1} value={strikeRangePct} onChange={(e) => setStrikeRangePct(parseFloat(e.target.value || '5'))} />
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-[10px] text-slate-400">Live</div>
                        <div className="flex items-center gap-2">
                          <input type="checkbox" checked={liveOn} onChange={(e) => setLiveOn(e.target.checked)} />
                          <select className="bg-slate-900/60 border border-slate-700 rounded-lg px-2 py-1 text-xs" value={liveSec} onChange={(e) => setLiveSec(parseInt(e.target.value || '8', 10))}>
                            <option value={4}>4s</option>
                            <option value={8}>8s</option>
                            <option value={15}>15s</option>
                          </select>
                        </div>
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Last: <span className="text-slate-200 font-semibold">{last ?? '—'}</span>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-800 bg-slate-950/25 p-2">
                      <div className="flex items-center justify-between">
                        <div className="text-[10px] text-slate-400">GEX</div>
                        <div className="flex items-center gap-2">
                          <label className="flex items-center gap-2 text-[11px] text-slate-200">
                            <input type="checkbox" checked={gexOn} onChange={(e) => setGexOn(e.target.checked)} />
                            ON
                          </label>
                          <select className="bg-slate-900/60 border border-slate-700 rounded-lg px-2 py-1 text-xs" value={gexMode} onChange={(e) => setGexMode(e.target.value as any)}>
                            <option value="ALL">ALL</option>
                            <option value="EXPIRY">EXPIRY</option>
                          </select>
                        </div>
                      </div>

                      {gexMode === 'ALL' ? (
                        <div className="mt-2 space-y-2">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <div className="text-[10px] text-slate-400">Top expiries (N)</div>
                              <select className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-2 py-1 text-xs" value={gexN} onChange={(e) => setGexN(parseInt(e.target.value || '24', 10))}>
                                <option value={1}>1</option>
                                <option value={2}>2</option>
                                <option value={3}>3</option>
                                <option value={5}>5</option>
                                <option value={10}>10</option>
                                <option value={24}>24</option>
                                <option value={0}>ALL</option>
                              </select>
                            </div>
                            <div>
                              <div className="text-[10px] text-slate-400">DTE manual (min/max)</div>
                              <div className="grid grid-cols-2 gap-2">
                                <input className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-2 py-1 text-xs" type="number" min={0} step={1} value={gexMinDte} onChange={(e) => setGexMinDte(parseInt(e.target.value || '0', 10))} />
                                <input className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-2 py-1 text-xs" type="number" min={1} step={1} value={gexMaxDte} onChange={(e) => setGexMaxDte(parseInt(e.target.value || '9999', 10))} />
                              </div>
                            </div>
                          </div>

                          <div>
                            <div className="text-[10px] text-slate-400">Vencimentos no cálculo (checkbox)</div>
                            <div className="mt-1 flex flex-wrap gap-2">
                              <button className="text-[11px] bg-slate-900/60 border border-slate-800 rounded-lg px-2 py-1 hover:border-slate-600" onClick={() => setGexExpSel(expiries.slice(0, 2))} type="button">
                                D1/D2
                              </button>
                              <button className="text-[11px] bg-slate-900/60 border border-slate-800 rounded-lg px-2 py-1 hover:border-slate-600" onClick={() => setGexExpSel(expiries.slice(0, Math.max(1, gexN || 24)))} type="button">
                                Top N
                              </button>
                              <button className="text-[11px] bg-slate-900/60 border border-slate-800 rounded-lg px-2 py-1 hover:border-slate-600" onClick={() => setGexExpSel([])} type="button" title="Limpa seleção explícita (volta a usar filtros max_expiries + DTE)">
                                Usar filtros
                              </button>
                              <div className="text-[10px] text-slate-500 self-center">Sel: <span className="text-slate-200 font-semibold">{gexExpSel.length || 0}</span></div>
                            </div>

                            <div className="mt-2 max-h-[140px] overflow-auto border border-slate-800 rounded-xl p-2 bg-slate-950/20">
                              <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                                {expiries.slice(0, 30).map((e) => {
                                  const on = gexExpSel.includes(e);
                                  return (
                                    <label key={e} className="flex items-center gap-2 text-[11px] text-slate-200">
                                      <input
                                        type="checkbox"
                                        checked={on}
                                        onChange={(ev) => {
                                          const ck = ev.target.checked;
                                          if (ck) setGexExpSel(Array.from(new Set([...gexExpSel, e])));
                                          else setGexExpSel(gexExpSel.filter((x) => x !== e));
                                        }}
                                      />
                                      {e}
                                    </label>
                                  );
                                })}
                              </div>
                              <div className="mt-1 text-[10px] text-slate-500">Se Sel &gt; 0, sobrescreve DTE/max_expiries</div>
                            </div>
                          </div>

                          <div>
                            <div className="text-[10px] text-slate-400">Buckets (checkbox)</div>
                            <div className="mt-1 flex flex-wrap gap-2">
                              {gexRanges.map((rr) => (
                                <label key={rr.key} className="flex items-center gap-2 text-[11px] text-slate-200 bg-slate-900/40 border border-slate-800 rounded-lg px-2 py-1">
                                  <input
                                    type="checkbox"
                                    checked={rr.on}
                                    onChange={(e) => {
                                      const on = e.target.checked;
                                      setGexRanges(gexRanges.map((x) => (x.key === rr.key ? { ...x, on } : x)));
                                    }}
                                  />
                                  {rr.label}
                                </label>
                              ))}
                            </div>
                            {gexAudit ? <div className="mt-1 text-[10px] text-slate-500">{gexAudit}</div> : null}
                          </div>

                          <div className="flex items-center gap-2">
                            <button className="flex-1 bg-blue-600 hover:bg-blue-500 rounded-lg px-2 py-2 text-xs font-semibold" onClick={refresh}>
                              Aplicar
                            </button>
                            <button className="flex-1 bg-slate-900/60 border border-slate-700 hover:border-slate-500 rounded-lg px-2 py-2 text-xs font-semibold" onClick={() => setGexRanges(gexRanges.map((x) => ({ ...x, on: false })))}>
                              Limpar
                            </button>
                          </div>
                        </div>
                      ) : null}

                      <div className="text-[10px] text-slate-500 mt-2">{gexLevels.length} walls</div>
                    </div>

                    <div className="flex items-center justify-end pt-1">
                      <button className="bg-blue-600 hover:bg-blue-500 rounded-lg px-3 py-2 text-xs font-semibold" onClick={refresh}>
                        Sync
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <CandlesChart
              className="w-full h-full"
              ohlc={ohlc}
              levels={
                gexOn
                  ? [
                      ...(flip ? [{ price: Number(flip), label: 'FLIP', color: 'rgba(34, 197, 94, 0.75)' }] : []),
                      ...(selectedStrike
                        ? [{ price: Number(selectedStrike), label: 'SEL', color: 'rgba(59, 130, 246, 0.90)' }]
                        : []),
                      ...[...gexLevels]
                        .sort((a, b) => Math.abs(Number(b.gex || 0)) - Math.abs(Number(a.gex || 0)))
                        .slice(0, wallsN || 18)
                        .map((x, idx) => {
                          const s = Number(x.strike);
                          const sp = Number(last || 0);
                          const d = sp ? ((s / sp - 1) * 100) : 0;
                          const tag = sp ? `${d >= 0 ? '+' : ''}${d.toFixed(2)}%` : '';
                          const g = Number(x.gex || 0);
                          const strength = Math.min(1, Math.abs(g) / maxAbsWall);
                          const alpha = 0.35 + 0.55 * strength;
                          const gShort =
                            Math.abs(g) >= 1e6
                              ? `${(g / 1e6).toFixed(1)}M`
                              : Math.abs(g) >= 1e3
                                ? `${(g / 1e3).toFixed(1)}k`
                                : g.toFixed(0);
                          const w = 1 + Math.round(4 * strength);
                          const style = strength < 0.35 ? 2 : 0; // dashed for weak walls
                          return { price: s, label: `#${idx + 1} ${tag} ${gShort}`.trim(), color: `rgba(168, 85, 247, ${alpha.toFixed(2)})`, width: w, style };
                        }),
                    ]
                  : []
              }
              onPickPrice={(p) => {
                if (!gexLevels.length) return;
                let best = gexLevels[0];
                let bestD = Math.abs(p - best.strike);
                for (const lv of gexLevels) {
                  const d = Math.abs(p - lv.strike);
                  if (d < bestD) {
                    best = lv;
                    bestD = d;
                  }
                }
                setSelectedStrike((prev) => (Number(prev) === Number(best.strike) ? null : best.strike));
              }}
            />
          </div>
        );

        const chainNode = (
          <>
            <div className="text-xs text-slate-500 mb-2">Rows: {strikeRows.length} (range ±{strikeRangePct}%)</div>
            <div className="overflow-auto max-h-[380px] border border-slate-800 rounded-xl">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-950 border-b border-slate-800">
                  <tr>
                    <th className="text-left p-2">Call (bid/ask · IV · OI)</th>
                    <th className="text-left p-2">Strike</th>
                    <th className="text-left p-2">Put (bid/ask · IV · OI)</th>
                    <th className="text-left p-2">NetGEX</th>
                  </tr>
                </thead>
                <tbody>
                  {strikeRows.map((rr: any) => (
                    <tr
                      key={rr.strike}
                      className={`border-b border-slate-900 hover:bg-slate-900/40 cursor-pointer ${selectedStrike === rr.strike ? 'bg-slate-900/50' : ''}`}
                      onClick={() => setSelectedStrike((prev) => (Number(prev) === Number(rr.strike) ? null : Number(rr.strike)))}
                    >
                      <td className="p-2 text-slate-200">
                        {rr.call?.bid_price ?? '—'} / {rr.call?.ask_price ?? '—'} · {rr.call?.mark_iv ?? '—'} · {rr.call?.open_interest ?? '—'}
                      </td>
                      <td className="p-2 text-slate-100 font-semibold">{Number(rr.strike).toFixed(0)}</td>
                      <td className="p-2 text-slate-200">
                        {rr.put?.bid_price ?? '—'} / {rr.put?.ask_price ?? '—'} · {rr.put?.mark_iv ?? '—'} · {rr.put?.open_interest ?? '—'}
                      </td>
                      <td className="p-2 text-slate-400">{Number(rr.net_gex || 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        );

        const opsNode = (
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-slate-500">Seleção: <span className="text-slate-200 font-semibold">{selectedStrike ?? '—'}</span></div>
              <button
                type="button"
                className="text-xs bg-slate-900/60 border border-slate-800 rounded px-2 py-1 hover:border-slate-600"
                onClick={() => setSelectedStrike(null)}
                title="Limpar seleção"
              >
                Limpar
              </button>
            </div>
            <SpotPulseCard spot={Number(last || 0)} selectedStrike={selectedStrike} flip={flip} targetPct={planTargetPct} />
            <div className="mt-3 text-xs text-slate-500">
              Clique no gráfico para selecionar o nível GEX mais próximo. Se o clique não funcionar, use a lista de níveis abaixo.
            </div>
            {optErr ? <div className="mt-2 text-xs text-amber-400">GEX/Chain: {optErr}</div> : null}

            <div className="mt-3">
              <div className="text-xs text-slate-400">Níveis (walls):</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {[...gexLevels]
                  .sort((a, b) => Math.abs(Number(b.gex || 0)) - Math.abs(Number(a.gex || 0)))
                  .slice(0, 10)
                  .map((lv, idx) => {
                    const sp = Number(last || 0);
                    const s = Number(lv.strike);
                    const d = sp ? ((s / sp - 1) * 100) : 0;
                    const g = Number(lv.gex || 0);
                    const gShort =
                      Math.abs(g) >= 1e6
                        ? `${(g / 1e6).toFixed(1)}M`
                        : Math.abs(g) >= 1e3
                          ? `${(g / 1e3).toFixed(1)}k`
                          : g.toFixed(0);
                    return (
                      <button
                        key={lv.strike}
                        className={`text-xs bg-slate-950/40 border border-slate-800 rounded px-2 py-1 hover:border-slate-600 ${selectedStrike === s ? 'border-blue-500/60' : ''}`}
                        onClick={() => setSelectedStrike((prev) => (Number(prev) === Number(s) ? null : s))}
                        title={`rank #${idx + 1} |gex|=${Math.abs(g).toFixed(2)} dist=${d.toFixed(2)}%`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold">#{idx + 1}</span>
                          <span className="text-slate-300">{s.toFixed(0)}</span>
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-slate-500">
                          <span>
                            {d >= 0 ? '+' : ''}
                            {d.toFixed(2)}%
                          </span>
                          <span>{gShort}</span>
                        </div>
                      </button>
                    );
                  })}
              </div>
            </div>
          </div>
        );

        const paperNode = (
          <PaperBoxCard
            selected={selectedStrike ? { strike: Number(selectedStrike), ...(selected || {}) } : null}
            expiry={expiry}
            spot={Number(last || 0)}
            targetPct={planTargetPct}
          />
        );

        const plannerNode = (
          <StrategyPlannerCard
            selectedStrike={selectedStrike}
            selected={selectedStrike ? { strike: Number(selectedStrike), ...(selected || {}) } : null}
            expiry={expiry}
            expiries={expiries}
            setExpiry={setExpiry}
            spot={Number(last || 0)}
            targetPct={planTargetPct}
            setTargetPct={setPlanTargetPct}
          />
        );

        return (
          <ResponsiveDeskLayout
            view={view}
            mobileTab={mobileTab}
            setMobileTab={setMobileTab}
            chart={chartNode}
            chain={chainNode}
            ops={opsNode}
            paper={paperNode}
            planner={plannerNode}
          />
        );
      })()}

      </div>
    </main>
  );
}
