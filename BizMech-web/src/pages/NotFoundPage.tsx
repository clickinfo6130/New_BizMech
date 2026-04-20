import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-slate-600">
      <div className="text-5xl font-black text-brand-700">404</div>
      <div className="text-sm">Page not found</div>
      <Link to="/" className="text-xs text-brand-600 underline">
        go home
      </Link>
    </div>
  );
}
