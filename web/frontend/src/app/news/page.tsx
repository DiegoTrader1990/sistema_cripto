'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000';

import Modal from '@/components/Modal';

type NewsItem = {
  ts: number;
  cat: string;
  feed: string;
  source: string;
  title: string;
  link: string;
  assets: string;
  score: number;
};

type NewsOpen = { ok: boolean; title: string; url: string; text: string; excerpt: string; assets: string; score: number };

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

export default function NewsPage() {
  const r = useRouter();
  const [cat, setCat] = useState('ALL');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<NewsItem[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [openItem, setOpenItem] = useState<NewsItem | null>(null);
  const [openData, setOpenData] = useState<NewsOpen | null>(null);
  const [openErr, setOpenErr] = useState<string | null>(null);
  const [openLoading, setOpenLoading] = useState(false);

  async function refresh() {
    setErr(null);
    try {
      const data = await apiGet(`/api/news?cat=${encodeURIComponent(cat)}&q=${encodeURIComponent(q)}&limit=60`);
      setItems(data.items || []);
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
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat]);

  const shown = useMemo(() => items, [items]);

  async function openNews(it: NewsItem) {
    setOpen(true);
    setOpenItem(it);
    setOpenErr(null);
    setOpenData(null);
    setOpenLoading(true);
    try {
      const data = await apiGet(`/api/news/open?url=${encodeURIComponent(it.link)}&title=${encodeURIComponent(it.title)}&assets=${encodeURIComponent(it.assets)}&score=${encodeURIComponent(String(it.score))}`);
      setOpenData(data);
    } catch (e: any) {
      setOpenErr(String(e?.message || e));
    } finally {
      setOpenLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold">News</h1>
        <a className="text-sm text-slate-400 hover:text-slate-200" href="/desk">Desk</a>
        <a className="text-sm text-slate-400 hover:text-slate-200" href="/altcoins">Altcoins</a>
      </div>

      <div className="mt-4 flex gap-3 items-center flex-wrap">
        <label className="text-sm text-slate-300">Categoria</label>
        <select className="bg-slate-900 border border-slate-800 rounded px-2 py-1" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="ALL">ALL</option>
          <option value="Crypto">Crypto</option>
          <option value="Macro">Macro</option>
        </select>

        <label className="text-sm text-slate-300">Filtro</label>
        <input className="bg-slate-900 border border-slate-800 rounded px-2 py-1 w-72" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ex: solana, fed, etf" />

        <button className="bg-blue-600 hover:bg-blue-500 rounded px-3 py-1" onClick={refresh}>
          Atualizar
        </button>
      </div>

      {err ? <div className="mt-4 text-sm text-red-400">{err}</div> : null}

      <div className="mt-6 grid gap-3">
        {shown.map((it, idx) => (
          <button
            key={idx}
            onClick={() => openNews(it)}
            className="text-left block bg-slate-900/40 border border-slate-800 rounded-xl p-4 hover:border-slate-600"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-slate-100">{it.title}</div>
              <div className="text-xs text-slate-400 whitespace-nowrap">score {it.score} · {it.assets}</div>
            </div>
            <div className="mt-1 text-xs text-slate-500">{it.cat} · {it.feed} · {it.source}</div>
          </button>
        ))}
      </div>

      <Modal
        open={open}
        title={openItem?.title || 'Notícia'}
        onClose={() => {
          setOpen(false);
          setOpenItem(null);
          setOpenData(null);
          setOpenErr(null);
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-slate-400">{openItem?.assets} · score {openItem?.score}</div>
          {openItem?.link ? (
            <a className="text-xs text-blue-400 hover:text-blue-300" href={openItem.link} target="_blank" rel="noreferrer">
              Abrir fonte original ↗
            </a>
          ) : null}
        </div>

        {openLoading ? <div className="mt-4 text-sm text-slate-300">Carregando…</div> : null}
        {openErr ? <div className="mt-4 text-sm text-red-400">{openErr}</div> : null}

        {openData ? (
          <>
            {openData.excerpt ? <div className="mt-4 text-sm text-slate-200">{openData.excerpt}</div> : null}
            <pre className="mt-4 whitespace-pre-wrap text-xs text-slate-300 bg-slate-900/40 border border-slate-800 rounded-xl p-4">
{openData.text}
            </pre>
          </>
        ) : null}
      </Modal>
    </main>
  );
}
