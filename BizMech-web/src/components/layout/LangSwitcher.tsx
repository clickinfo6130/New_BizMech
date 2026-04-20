import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';
import { SUPPORTED_LANGS, type SupportedLang } from '@/i18n';

export function LangSwitcher() {
  const { i18n, t } = useTranslation();
  const current = (i18n.resolvedLanguage ?? 'ko') as SupportedLang;

  return (
    <label className="flex items-center gap-1.5 text-slate-600">
      <Languages className="h-4 w-4" />
      <select
        value={current}
        onChange={(e) => i18n.changeLanguage(e.target.value)}
        className="bg-transparent text-sm font-medium focus:outline-none cursor-pointer"
        aria-label="language"
      >
        {SUPPORTED_LANGS.map((lng) => (
          <option key={lng} value={lng}>
            {t(`lang.${lng}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
