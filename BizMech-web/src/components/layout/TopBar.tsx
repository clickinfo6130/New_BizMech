import { NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Cog, LogOut, Search, Menu, User } from 'lucide-react';

import { LangSwitcher } from './LangSwitcher';
import { FontSizeSwitcher } from './FontSizeSwitcher';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/utils/cn';

interface Props {
  onMenuClick?: () => void;
}

export function TopBar({ onMenuClick }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between border-b border-surface-border bg-white/85 px-4 backdrop-blur-md lg:px-6">
      {/* Left */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onMenuClick}
          className="rounded-md p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
          aria-label="menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-2.5">
          <span className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-600 via-brand-500 to-accent-500 text-white shadow-[0_4px_12px_rgba(52,97,245,0.35)]">
            <Cog className="h-4 w-4 animate-[spin_6s_linear_infinite]" />
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_0_2px_#fff]" />
          </span>
          <div className="leading-tight">
            <div className="text-[15px] font-black tracking-tight text-slate-900">
              Biz<span className="text-brand-600">Mech</span>
            </div>
            <div className="hidden text-[10px] font-medium text-slate-500 sm:block">
              {t('app.tagline')}
            </div>
          </div>
        </div>

        <nav className="ml-5 hidden items-center gap-1 md:flex">
          <NavItem to="/" label={t('nav.browse')} />
          <NavItem to="/search" label={t('nav.search')} icon={<Search className="h-3.5 w-3.5" />} />
        </nav>
      </div>

      {/* Right */}
      <div className="flex items-center gap-2">
        <FontSizeSwitcher />
        <LangSwitcher />
        {user && (
          <>
            <div className="mx-1 hidden h-5 w-px bg-slate-200 sm:block" />
            <div className="hidden items-center gap-2 rounded-full bg-slate-50 pl-2 pr-3 py-1 ring-1 ring-slate-200 sm:flex">
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-accent-500 text-white">
                <User className="h-3 w-3" />
              </div>
              <span className="text-[11px] font-medium text-slate-700">{user.name}</span>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold text-slate-500 transition hover:bg-red-50 hover:text-red-600"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t('nav.logout')}</span>
            </button>
          </>
        )}
      </div>
    </header>
  );
}

function NavItem({ to, label, icon }: { to: string; label: string; icon?: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        cn(
          'relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition',
          isActive
            ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-100'
            : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800',
        )
      }
    >
      {icon}
      {label}
    </NavLink>
  );
}
