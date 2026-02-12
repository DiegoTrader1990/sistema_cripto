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
    <main className="min-h-screen text-slate-100 flex items-center justify-center p-6 relative overflow-hidden bg-slate-950">
      {/* premium crypto background */}
      <div className="absolute inset-0">
        <div className="absolute -top-32 -left-32 w-[520px] h-[520px] rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="absolute -bottom-40 -right-32 w-[620px] h-[620px] rounded-full bg-fuchsia-500/15 blur-3xl" />
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[720px] h-[320px] rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(59,130,246,0.10),transparent_40%),radial-gradient(circle_at_80%_20%,rgba(168,85,247,0.10),transparent_40%),radial-gradient(circle_at_50%_90%,rgba(34,197,94,0.08),transparent_45%)]" />
        <div className="absolute inset-0 opacity-[0.18] bg-[linear-gradient(to_right,rgba(148,163,184,0.25)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.25)_1px,transparent_1px)] bg-[size:64px_64px]" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="w-full bg-slate-900/55 border border-slate-800 rounded-2xl p-7 backdrop-blur shadow-[0_0_0_1px_rgba(148,163,184,0.06)]">
          <h1 className="text-2xl font-bold">My Friend - Cripto</h1>
          <p className="text-sm text-slate-400 mt-1">Login</p>

          <form className="mt-6 space-y-4" onSubmit={submit}>
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
      </div>
    </main>
  );
}
