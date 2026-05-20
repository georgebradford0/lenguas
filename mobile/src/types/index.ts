export type Language = 'de' | 'nl' | 'fr' | 'es';

export const LANGUAGE_NAMES: Record<Language, string> = {
  de: 'German',
  nl: 'Dutch',
  fr: 'French',
  es: 'Spanish',
};

export function getLanguageName(language: Language): string {
  return LANGUAGE_NAMES[language] ?? language;
}
