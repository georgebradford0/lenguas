export type Language = 'de' | 'nl' | 'fr' | 'es' | 'la';

export const LANGUAGE_NAMES: Record<Language, string> = {
  de: 'German',
  nl: 'Dutch',
  fr: 'French',
  es: 'Spanish',
  la: 'Latin',
};

export function getLanguageName(language: Language): string {
  return LANGUAGE_NAMES[language] ?? language;
}
