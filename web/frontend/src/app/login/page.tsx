'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000';

export default function LoginPage() {
  const r = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok || !data?.token) {
        setErr(data?.error || 'login failed');
        return;
      }
      localStorage.setItem('token', data.token);
      r.push('/desk');
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-slate-900/60 border border-slate-800 rounded-2xl p-7 shadow-[0_0_0_1px_rgba(148,163,184,0.06)]">
        <div className="text-xs tracking-widest text-slate-400">MY FRIEND</div>
        <h1 className="text-2xl font-bold mt-1">My Friend - Cripto</h1>
        <p className="text-sm text-slate-400 mt-1">Acesso ao terminal (demo)</p>

        <form className="mt-6 space-y-4" onSubmit={submit}>
          <div className="text-xs text-slate-500">
            Dica: se não tiver usuário/senha, peça para quem enviou o link.
          </div>
          <div>
            <label className="text-sm text-slate-300">User</label>
            <input
              className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-800 p-2"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div>
            <label className="text-sm text-slate-300">Senha</label>
            <input
              type="password"
              className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-800 p-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {err ? <div className="text-sm text-red-400">{err}</div> : null}

          <button
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 p-2 font-semibold"
            type="submit"
          >
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </main>
  );
}
