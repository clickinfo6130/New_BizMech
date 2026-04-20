import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import ko from './locales/ko.json';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zh from './locales/zh.json';

export const SUPPORTED_LANGS = ['ko', 'en', 'ja', 'zh'] as const;
export type SupportedLang = (typeof SUPPORTED_LANGS)[number];

const defaultLng =
  (import.meta.env.VITE_DEFAULT_LANG as SupportedLang | undefined) ?? 'ko';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      ko: { common: ko },
      en: { common: en },
      ja: { common: ja },
      zh: { common: zh },
    },
    fallbackLng: 'ko',
    lng: defaultLng,
    ns: ['common'],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'bizmech.lang',
      caches: ['localStorage'],
    },
  });

export default i18n;
