'use client';

import { useEffect, useMemo, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000';

type BotStatusResp = { ok: boolean; bot: any; paper_open?: number; ts?: number };

type BotAuditResp = { ok: boolean; rows: any[]; ts?: number };

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

function explainBlock(reason: string, block: any) {
  const r = String(reason || '').toUpperCase();
  if (!r) return '—';

  if (r === 'DISABLED') return 'Bot desligado.';
  if (r === 'AUTO_ENTRY_OFF') return 'Auto-entry desligado (bot não entra sozinho).';
  if (r === 'OUT_OF_WINDOW') return 'Fora da janela de operação (horário).';
  if (r === 'COOLDOWN') return 'Em cooldown (aguardando tempo mínimo entre entradas).';
  if (r === 'NO_EXPIRIES') return 'Sem expiries configuradas.';
  if (r === 'NO_EXPIRIES_EXEC') return 'Não achei expiries D1/D2 para executar (DTE).';
  if (r === 'NO_SPOT') return 'Sem spot (ticker do perp falhou).';
  if (r === 'NO_WALLS') return 'Sem walls (GEX não retornou walls válidas).';
  if (r === 'NO_TOUCH') return 'Não tocou nenhuma wall elegível ainda.';
  if (r === 'FAR_FROM_FLIP') {
    const dist = block?.dist_pct;
    const lim = block?.near_flip_pct;
    return `Longe do gamma flip (${dist?.toFixed?.(2) ?? dist}% > ${lim?.toFixed?.(2) ?? lim}%).`;
  }
  if (r === 'ATR_TOO_LOW') {
    const atr = block?.atr_pct;
    const lim = block?.min;
    return `Volatilidade baixa (ATR ${atr?.toFixed?.(2) ?? atr}% < ${lim?.toFixed?.(2) ?? lim}%).`;
  }
  if (r === 'ATR_UNAVAILABLE') return 'ATR indisponível (falha ao buscar candles do perp).';
  if (r === 'MAX_POSITIONS') return 'Limite de posições abertas atingido.';
  if (r === 'MAX_RISK') return 'Limite de risco total (USD) atingido.';
  if (r === 'RISK_WOULD_EXCEED') return 'Entrada ultrapassaria o risco máximo permitido.';
  if (r === 'DUP_STRIKE') return 'Já existe posição nesse strike+expiry (evita duplicar).';
  if (r === 'NO_CHAIN_ROW') return 'Não encontrei strike na chain (sem cotação para esse K).';
  if (r === 'NO_INSTRUMENTS') return 'Instrumentos call/put inválidos para esse strike.';
  if (r === 'NO_ENTRY_EXECUTED') return 'Tentou executar, mas foi bloqueado em D1/D2 (ver detalhes).';

  return `Bloqueado: ${reason}`;
}

export default function BotDecisionCard({ currency }: { currency: string }) {
  const [bot, setBot] = useState<any>(null);
  const [audit, setAudit] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    try {
      setErr(null);
      const [s, a] = await Promise.all([
        apiGet('/api/bot/status') as Promise<BotStatusResp>,
        apiGet('/api/bot/audit?limit=10') as Promise<BotAuditResp>,
      ]);
      setBot(s?.bot || null);
      setAudit(a?.rows || []);
    } catch (e: any) {
      setErr(String(e?.message || e));
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const status = useMemo(() => {
    const enabled = !!bot?.enabled;
    const auto = !!bot?.auto_entry;
    const lastBlockReason = String(bot?.last_block_reason || '');
    const lastBlock = bot?.last_block || {};

    const headline = enabled ? (auto ? 'ATIVO' : 'Ligado (manual)') : 'DESLIGADO';
    const explain = enabled && auto ? explainBlock(lastBlockReason, lastBlock) : explainBlock(enabled ? 'AUTO_ENTRY_OFF' : 'DISABLED', lastBlock);

    return { enabled, auto, headline, explain, lastBlockReason, lastBlock };
  }, [bot]);

  const lastEntry = useMemo(() => {
    const row = (audit || []).find((r) => String(r?.event || '') === 'ENTRY_OPEN');
    if (!row) return null;
    return row;
  }, [audit]);

  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-2xl overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
        <div className="text-xs font-semibold">Decisão do Bot (GEX)</div>
        <div className="text-[11px] text-slate-500">{currency}</div>
      </div>

      <div className="p-3">
        {err ? <div className="text-xs text-amber-300">{err}</div> : null}

        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold">
            {status.headline}{' '}
            {status.enabled && status.auto ? <span className="text-emerald-300">(auto)</span> : <span className="text-slate-400">(sem auto)</span>}
          </div>
          <div className="text-[11px] text-slate-500">open: {bot?.paper_open ?? '—'}</div>
        </div>

        <div className="mt-2 text-xs text-slate-300">
          <div className="text-slate-400">Agora:</div>
          <div className="mt-1 rounded-xl border border-slate-800 bg-slate-950/30 p-2">
            {status.explain}
          </div>
        </div>

        {lastEntry ? (
          <div className="mt-3 text-xs text-slate-300">
            <div className="text-slate-400">Última entrada:</div>
            <div className="mt-1 text-slate-200">
              strike <span className="font-semibold">{Number(lastEntry.strike).toFixed(0)}</span> · expiry{' '}
              <span className="font-semibold">{String(lastEntry.expiry || '')}</span> · cost <span className="font-semibold">${Number(lastEntry.cost || 0).toFixed(2)}</span>
            </div>
          </div>
        ) : null}

        <div className="mt-3 text-[11px] text-slate-500">
          Dica: clique em “Report” para ver o log (audit) completo.
        </div>
      </div>
    </div>
  );
}
