const LANGUAGE_CONFIG = {
  de: {
    name: 'German',
    tts: { VoiceId: 'Daniel', Engine: 'generative', LanguageCode: 'de-DE' },
  },
  nl: {
    name: 'Dutch',
    tts: { VoiceId: 'Ruben', Engine: 'standard', LanguageCode: 'nl-NL' },
  },
  fr: {
    name: 'French',
    tts: { VoiceId: 'Remi', Engine: 'generative', LanguageCode: 'fr-FR' },
  },
  es: {
    name: 'Spanish',
    tts: { VoiceId: 'Sergio', Engine: 'neural', LanguageCode: 'es-ES' },
  },
};

module.exports = { LANGUAGE_CONFIG };
