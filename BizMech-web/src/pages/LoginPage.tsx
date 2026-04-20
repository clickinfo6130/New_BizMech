import { FormEvent, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Cog, LogIn } from 'lucide-react';

import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { LangSwitcher } from '@/components/layout/LangSwitcher';
import { useAuthStore } from '@/store/authStore';

interface LocationState {
  from?: string;
}

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { login, loading, error } = useAuthStore();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const ok = await login({ username, password });
    if (ok) {
      const from = (location.state as LocationState | null)?.from ?? '/';
      navigate(from, { replace: true });
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950">
      {/* background gradient blobs */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,#1b36b0_0%,transparent_45%),radial-gradient(circle_at_80%_80%,#0891b2_0%,transparent_45%)] opacity-70" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,transparent,rgba(2,6,23,0.75))]" />

      <div className="absolute right-4 top-4 text-slate-200">
        <LangSwitcher />
      </div>

      <div className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-8 shadow-elevated backdrop-blur-xl">
        <div className="mb-6 flex flex-col items-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-accent-500 shadow-lg">
            <Cog className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-xl font-bold text-white">{t('login.title')}</h1>
          <p className="mt-1 text-xs text-slate-300">{t('login.subtitle')}</p>
        </div>

        <form className="space-y-3" onSubmit={handleSubmit}>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">
              {t('login.username')}
            </label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              autoComplete="username"
              required
              className="bg-white/90"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">
              {t('login.password')}
            </label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
              className="bg-white/90"
            />
          </div>

          {error && (
            <div className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-200">
              {t('login.error')}: {error}
            </div>
          )}

          <Button type="submit" className="mt-2 w-full" size="lg" disabled={loading}>
            <LogIn className="h-4 w-4" />
            {t('login.submit')}
          </Button>
        </form>

        <p className="mt-4 text-center text-[11px] text-slate-400">{t('login.mockHint')}</p>
      </div>
    </div>
  );
}
