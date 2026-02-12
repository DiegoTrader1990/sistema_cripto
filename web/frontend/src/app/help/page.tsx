'use client';

import { useMemo } from 'react';

function Section({ title, children }: { title: string; children: any }) {
  return (
    <section className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5">
      <h2 className="text-lg font-bold">{title}</h2>
      <div className="mt-2 text-sm text-slate-200 leading-relaxed">{children}</div>
    </section>
  );
}

function Bullet({ children }: { children: any }) {
  return <li className="ml-5 list-disc text-slate-200">{children}</li>;
}

export default function HelpPage() {
  const updated = useMemo(() => new Date().toLocaleString(), []);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Tutorial / Help (Mesa GEX + Straddle D1/D2)</h1>
          <div className="text-xs text-slate-500 mt-1">Atualizado: {updated}</div>
        </div>
        <div className="flex items-center gap-2">
          <a className="text-sm bg-slate-900 border border-slate-800 rounded px-3 py-1 hover:border-slate-600" href="/desk">← Desk</a>
          <a className="text-sm bg-slate-900 border border-slate-800 rounded px-3 py-1 hover:border-slate-600" href="/news">News</a>
          <a className="text-sm bg-slate-900 border border-slate-800 rounded px-3 py-1 hover:border-slate-600" href="/report">Relatório</a>
        </div>
      </div>

      <div className="mt-6 grid gap-4">
        <Section title="1) Objetivo do sistema (o que estamos medindo)">
          <ul className="space-y-2">
            <Bullet>
              Identificar <b>walls de GEX</b> (strikes com concentração de gamma) e usar isso como mapa de “zonas importantes” do preço.
            </Bullet>
            <Bullet>
              Montar operações de <b>BUY CALL + BUY PUT no mesmo strike (straddle)</b> usando vencimento <b>D1</b> ou <b>D2</b>.
            </Bullet>
            <Bullet>
              Acompanhar a operação com <b>mark-to-market</b> (tempo real) e medir consistência no <b>Relatório</b>.
            </Bullet>
          </ul>
        </Section>

        <Section title="2) Conceitos rápidos: GEX / Walls / Flip">
          <ul className="space-y-2">
            <Bullet>
              <b>GEX (Gamma Exposure)</b>: medida agregada do impacto do gamma das opções. Na prática, ajuda a enxergar “onde está a força”.
            </Bullet>
            <Bullet>
              <b>Walls</b>: strikes com |GEX| alto. No Desk, as walls são rankeadas (#1, #2…) por força.
            </Bullet>
            <Bullet>
              <b>Flip</b>: região onde o sinal/efeito do gamma tende a mudar. É um nível que você acompanha como referência.
            </Bullet>
          </ul>
          <div className="mt-3 text-xs text-slate-400">
            Importante: o sistema mostra distâncias (%) do spot até a wall para facilitar timing.
          </div>
        </Section>

        <Section title="3) Fluxo operacional (passo a passo profissional)">
          <ol className="space-y-2">
            <li className="ml-5 list-decimal">
              No <b>Desk</b>, selecione o instrumento (BTC/ETH) e TF (para contexto do preço).
            </li>
            <li className="ml-5 list-decimal">
              Ative <b>GEX</b>. As linhas no gráfico mostram: <b>rank</b>, <b>distância %</b> e <b>força</b> (k/M).
            </li>
            <li className="ml-5 list-decimal">
              Clique numa wall (linha) ou num strike na chain para definir o <b>Strike selecionado</b>.
            </li>
            <li className="ml-5 list-decimal">
              No card <b>Estratégia/Planner</b>, escolha <b>D1</b> ou <b>D2</b> e o tipo de preço (<b>MARK</b> ou <b>MID</b>).
            </li>
            <li className="ml-5 list-decimal">
              Analise:
              <ul className="mt-1 space-y-1">
                <Bullet><b>Premium total</b> (custo) vs alvo (ex: ≥ 1.5%)</Bullet>
                <Bullet><b>Spread</b> (bid/ask) — se estiver largo, a entrada tende a piorar</Bullet>
                <Bullet><b>Breakevens</b> — use como “mapa” do que precisa acontecer</Bullet>
              </ul>
            </li>
            <li className="ml-5 list-decimal">
              Clique em <b>Entrar (paper)</b> no card <b>Caixa/Simulador</b> para registrar a operação.
            </li>
            <li className="ml-5 list-decimal">
              Acompanhe a operação aberta: o sistema calcula <b>MTM</b> pelo ticker das opções em tempo real.
            </li>
            <li className="ml-5 list-decimal">
              Feche manualmente (Fechar posição) ou use <b>Auto TP/SL</b>.
            </li>
            <li className="ml-5 list-decimal">
              Vá em <b>Relatório</b> para avaliar consistência: PnL, winrate, export CSV.
            </li>
          </ol>
        </Section>

        <Section title="4) Regras (checklist) para qualidade da entrada">
          <ul className="space-y-2">
            <Bullet><b>Liquidez</b>: prefira strikes com bid/ask decente. Spread muito aberto = pior edge.</Bullet>
            <Bullet><b>Distância</b>: quanto mais perto do nível “de interesse”, mais sentido o timing (evitar muito longe).</Bullet>
            <Bullet><b>Custo vs movimento</b>: se o premium é alto, o movimento necessário para lucro aumenta.</Bullet>
            <Bullet><b>D1/D2</b>: é mais sensível a IV/spread. Use D2 quando D1 estiver muito caro/espalhado.</Bullet>
          </ul>
        </Section>

        <Section title="5) Glossário (o que cada card faz)">
          <ul className="space-y-2">
            <Bullet><b>Chart</b>: candles + linhas das walls rankeadas (força + distância %).</Bullet>
            <Bullet><b>Chain</b>: CALL | STRIKE | PUT + NetGEX por strike (base para clique/seleção).</Bullet>
            <Bullet><b>Operacional</b>: seleção rápida das top walls (rank + % + força).</Bullet>
            <Bullet><b>Estratégia/Planner</b>: SuperDOM em tempo real + custo/risco/breakevens.</Bullet>
            <Bullet><b>Caixa/Simulador</b>: entra/fecha, acompanha MTM, Auto TP/SL e envia pro relatório.</Bullet>
          </ul>
        </Section>

        <Section title="6) Roadmap (próximos upgrades)">
          <ul className="space-y-2">
            <Bullet><b>GEX ALL expiries</b> como força real (ranking) + execução D1/D2.</Bullet>
            <Bullet><b>ARMADO/DISPARO</b> por distância do spot à wall (processo repetível).</Bullet>
            <Bullet><b>Relatório avançado</b>: drawdown, profit factor, distribuição de retornos.</Bullet>
            <Bullet><b>Persistência em banco</b> por usuário (pra virar SaaS).</Bullet>
          </ul>
        </Section>
      </div>
    </main>
  );
}
