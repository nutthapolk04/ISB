import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import translationTH from './locales/th.json';
import translationEN from './locales/en.json';

const resources = {
  th: {
    translation: translationTH
  },
  en: {
    translation: translationEN
  }
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'th',
    // Do NOT set 'lng' here — let LanguageDetector read from localStorage
    // (key: i18nextLng) so the user's choice persists across reloads.
    interpolation: {
      escapeValue: false
    }
  });

export default i18n;
