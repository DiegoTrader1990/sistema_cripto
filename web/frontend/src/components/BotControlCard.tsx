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

async function apiPost(path: string, body: any) {
  const tok = localStorage.getItem('token') || '';
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tok}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail || data?.error || 'request failed');
  return data;
}

export default function BotControlCard({ currency }: { currency: string }) {
  const [bot, setBot] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string>('');
  const [err, setErr] = useState<string>('');

  // form
  const [enabled, setEnabled] = useState(false);
  const [autoEntry, setAutoEntry] = useState(false);
  const [dteRangesExec, setDteRangesExec] = useState('1-2');
  const [wallRankMax, setWallRankMax] = useState(8);
  const [nearFlipPct, setNearFlipPct] = useState(1.2);
  const [atrMinPct, setAtrMinPct] = useState(0.35);
  const [atrTf, setAtrTf] = useState('15');
  const [cooldownSec, setCooldownSec] = useState(15);
  const [maxPositions, setMaxPositions] = useState(3);
  const [maxRiskUsd, setMaxRiskUsd] = useState(500);

  async function load() {
    try {
      setErr('');
      const s = await apiGet('/api/bot/status');
      setBot(s?.bot || null);
    } catch (e: any) {
      setErr(String(e?.message || e));
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!bot) return;
    setEnabled(!!bot.enabled);
    setAutoEntry(!!bot.auto_entry);
    setDteRangesExec(String(bot.dte_ranges_exec || '1-2'));
    setWallRankMax(Number(bot.wall_rank_max || 8));
    setNearFlipPct(Number(bot.near_flip_pct ?? 1.2));
    setAtrMinPct(Number(bot.atr_min_pct ?? 0.35));
    setAtrTf(String(bot.atr_tf || '15'));
    setCooldownSec(Number(bot.cooldown_sec || 15));
    setMaxPositions(Number(bot.max_positions || 3));
    setMaxRiskUsd(Number(bot.max_risk_usd || 500));
  }, [bot]);

  const payload = useMemo(() => {
    return {
      currency,
      cooldown_sec: cooldownSec,
      dte_ranges_exec: dteRangesExec,
      wall_rank_max: wallRankMax,
      near_flip_pct: nearFlipPct,
      atr_tf: atrTf,
      atr_n: 14,
      atr_min_pct: atrMinPct,
      max_positions: maxPositions,
      max_risk_usd: maxRiskUsd,
    };
  }, [currency, cooldownSec, dteRangesExec, wallRankMax, nearFlipPct, atrTf, atrMinPct, maxPositions, maxRiskUsd]);

  async function onToggle() {
    try {
      setSaving(true);
      setMsg('');
      setErr('');
      await apiPost('/api/bot/toggle', { enabled, auto_entry: autoEntry });
      await load();
      setMsg('Estado atualizado.');
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  async function onSaveConfig() {
    try {
      setSaving(true);
      setMsg('');
      setErr('');
      await apiPost('/api/bot/config', payload);
      await load();
      setMsg('Config salva.');
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-2xl overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
        <div className="text-xs font-semibold">Controle do Bot</div>
        <button className="text-[11px] text-slate-400 hover:text-slate-200" onClick={load} type="button">
          atualizar
        </button>
      </div>

      <div className="p-3 space-y-3">
        {err ? <div className="text-xs text-amber-300">{err}</div> : null}
        {msg ? <div className="text-xs text-emerald-300">{msg}</div> : null}

        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-xs text-slate-200">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Enabled
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-200">
            <input type="checkbox" checked={autoEntry} onChange={(e) => setAutoEntry(e.target.checked)} />
            Auto-entry
          </label>
          <button
            className="text-xs bg-slate-900/60 border border-slate-800 rounded px-3 py-2 hover:border-slate-600 disabled:opacity-50"
            onClick={onToggle}
            disabled={saving}
            type="button"
          >
            aplicar
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-[10px] text-slate-400">DTE exec (D1/D2)</div>
            <input className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-2 py-1 text-xs" value={dteRangesExec} onChange={(e) => setDteRangesExec(e.target.value)} />
          </div>
          <div>
            <div className="text-[10px] text-slate-400">Wall rank max</div>
            <input className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-2 py-1 text-xs" type="number" min={1} max={24} value={wallRankMax} onChange={(e) => setWallRankMax(Number(e.target.value || 0))} />
          </div>
          <div>
            <div className="text-[10px] text-slate-400">Near flip (%)</div>
            <input className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-2 py-1 text-xs" type="number" step={0.1} min={0} value={nearFlipPct} onChange={(e) => setNearFlipPct(Number(e.target.value || 0))} />
          </div>
          <div>
            <div className="text-[10px] text-slate-400">ATR min (%)</div>
            <input className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-2 py-1 text-xs" type="number" step={0.05} min={0} value={atrMinPct} onChange={(e) => setAtrMinPct(Number(e.target.value || 0))} />
          </div>
          <div>
            <div className="text-[10px] text-slate-400">ATR TF</div>
            <select className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-2 py-1 text-xs" value={atrTf} onChange={(e) => setAtrTf(e.target.value)}>
              <option value="1">1m</option>
              <option value="5">5m</option>
              <option value="15">15m</option>
              <option value="60">1h</option>
              <option value="240">4h</option>
              <option value="1D">1D</option>
            </select>
          </div>
          <div>
            <div className="text-[10px] text-slate-400">Cooldown (s)</div>
            <input className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-2 py-1 text-xs" type="number" min={0} value={cooldownSec} onChange={(e) => setCooldownSec(Number(e.target.value || 0))} />
          </div>
          <div>
            <div className="text-[10px] text-slate-400">Max positions</div>
            <input className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-2 py-1 text-xs" type="number" min={1} max={20} value={maxPositions} onChange={(e) => setMaxPositions(Number(e.target.value || 0))} />
          </div>
          <div>
            <div className="text-[10px] text-slate-400">Max risk (USD)</div>
            <input className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-2 py-1 text-xs" type="number" min={0} step={10} value={maxRiskUsd} onChange={(e) => setMaxRiskUsd(Number(e.target.value || 0))} />
          </div>
        </div>

        <button
          className="w-full text-xs bg-blue-600 hover:bg-blue-500 rounded-lg px-3 py-2 font-semibold disabled:opacity-50"
          onClick={onSaveConfig}
          disabled={saving}
          type="button"
        >
          salvar config
        </button>

        <div className="text-[11px] text-slate-500">
          Objetivo: poucos parâmetros, com gates de edge (flip/ATR/walls) + auditoria.
        </div>
      </div>
    </div>
  );
}
