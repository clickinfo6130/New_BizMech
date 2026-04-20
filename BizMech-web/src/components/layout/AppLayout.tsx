import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

import { TopBar } from './TopBar';
import { CategorySidebar } from '@/components/category/CategorySidebar';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/utils/cn';

export function AppLayout() {
  const token = useAuthStore((s) => s.token);
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const restore = useAuthStore((s) => s.restore);
  useEffect(() => {
    void restore();
  }, [restore]);

  // Close the drawer on route change
  useEffect(() => setMobileOpen(false), [location.pathname]);

  if (!token) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gradient-to-br from-slate-50 via-surface-muted to-blue-50">
      <TopBar onMenuClick={() => setMobileOpen((v) => !v)} />

      <div className="flex flex-1 min-h-0">
        {/* Sidebar — desktop (independent scroll, main content stays put) */}
        <aside className="hidden w-72 shrink-0 overflow-hidden border-r border-surface-border bg-white/60 backdrop-blur-md lg:block">
          <CategorySidebar />
        </aside>

        {/* Sidebar — mobile drawer */}
        <div
          className={cn(
            'fixed inset-0 z-40 lg:hidden',
            mobileOpen ? 'pointer-events-auto' : 'pointer-events-none',
          )}
        >
          <div
            className={cn(
              'absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity',
              mobileOpen ? 'opacity-100' : 'opacity-0',
            )}
            onClick={() => setMobileOpen(false)}
          />
          <aside
            className={cn(
              'absolute left-0 top-0 h-full w-72 border-r border-surface-border bg-white shadow-elevated transition-transform',
              mobileOpen ? 'translate-x-0' : '-translate-x-full',
            )}
          >
            <div className="flex items-center justify-end px-2 py-2">
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="rounded-md p-2 text-slate-500 hover:bg-slate-100"
                aria-label="close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <CategorySidebar />
          </aside>
        </div>

        {/* Main content — own scroll context, never pushed off-screen by sidebar */}
        <main className="flex-1 min-w-0 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
