import { useAppStore } from '../store/useAppStore';
import { en } from './en';
import { ja } from './ja';
import { ko, type MessageKey } from './ko';

export const LANGUAGES = ['ko', 'en', 'ja'] as const;
export type Language = (typeof LANGUAGES)[number];
export const LANGUAGE_NAMES: Record<Language, string> = { ko: '한국어', en: 'English', ja: '日本語' };

const dictionaries: Record<Language, Record<MessageKey, string>> = { ko, en, ja };

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export function translate(language: Language, key: MessageKey, params?: Record<string, string | number>): string {
  const text = dictionaries[language][key] ?? ko[key];
  return params ? text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m)) : text;
}

/** Returns `t` for the language chosen in Settings; re-renders when it changes. */
export function useT(): Translate {
  const language = useAppStore((s) => s.language);
  return (key, params) => translate(language, key, params);
}

export type { MessageKey };
