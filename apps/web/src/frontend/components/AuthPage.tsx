import React, { useState } from 'react';
import { Database, Loader2, AlertCircle } from 'lucide-react';
import { useAuthStore } from '../store/authStore';

export const AuthPage: React.FC = () => {
  const { login, register, error, busy, clearError } = useAuthStore();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'login') login(email, password);
    else register(email, password);
  };

  const switchMode = (next: 'login' | 'register') => {
    clearError();
    setMode(next);
  };

  return (
    <div className="h-screen flex items-center justify-center bg-slate-950 text-slate-100 p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="bg-gradient-to-tr from-cyan-500 to-indigo-500 p-3 rounded-xl on-accent-fg shadow-lg shadow-cyan-500/10 mb-3">
            <Database className="w-7 h-7" />
          </div>
          <h1 className="text-xl font-bold">FoxSchema</h1>
          <p className="text-sm text-slate-400 mt-1">
            {mode === 'login' ? 'Sign in to your workspace' : 'Create your account'}
          </p>
        </div>

        <form onSubmit={submit} className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-md px-3 py-2 text-sm outline-none"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Password</label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'register' ? 'At least 8 characters' : '••••••••'}
              className="bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-md px-3 py-2 text-sm outline-none"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 text-xs text-rose-300 bg-rose-950/30 border border-rose-500/20 rounded-md px-3 py-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="flex items-center justify-center gap-2 accent-grad disabled:opacity-60 on-accent-fg font-bold rounded-md py-2.5 text-sm transition cursor-pointer"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>

          <p className="text-xs text-slate-500 text-center">
            {mode === 'login' ? (
              <>
                No account?{' '}
                <button type="button" onClick={() => switchMode('register')} className="text-cyan-400 hover:underline">
                  Sign up
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button type="button" onClick={() => switchMode('login')} className="text-cyan-400 hover:underline">
                  Sign in
                </button>
              </>
            )}
          </p>
        </form>
      </div>
    </div>
  );
};
