import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { AppLanguage } from '../types/domain.ts';
import de from './locales/de.json' with { type: 'json' };
import en from './locales/en.json' with { type: 'json' };

export const LANGUAGE_STORAGE_KEY = 'agrovera_lang';

function readInitialLanguage(): AppLanguage {
  if (typeof window === 'undefined') return 'en';
  try {
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved === 'de' || saved === 'en') {
      return saved;
    }
  } catch {
    // Ignore localStorage access restrictions in sandboxed contexts
  }
  return 'en';
}

function syncDocumentMetadata(lang: AppLanguage): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang;
  document.title =
    lang === 'de'
      ? 'AgroVera — Intelligenter Anbau. Geprüfte Entscheidungen.'
      : 'AgroVera — Smarter Farming. Verified Decisions.';
}

const initialLanguage = readInitialLanguage();

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    de: { translation: de },
  },
  lng: initialLanguage,
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
});

syncDocumentMetadata(initialLanguage);

i18n.on('languageChanged', (lng) => {
  const normalized: AppLanguage = lng === 'de' ? 'de' : 'en';
  syncDocumentMetadata(normalized);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, normalized);
    } catch {
      // Ignore storage errors
    }
  }
});

export function setAppLanguage(lang: AppLanguage): void {
  void i18n.changeLanguage(lang);
}

export default i18n;
