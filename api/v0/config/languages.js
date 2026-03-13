const LANGUAGE_CONFIG = {
  de: {
    name: 'German',
    levels: {
      A1: 'a1_vocabulary.json',
      A2: 'a2_vocabulary.json',
      B1: 'b1_vocabulary.json',
    },
    tts: { VoiceId: 'Daniel', Engine: 'generative', LanguageCode: 'de-DE' },
    parsePlurals: true,
  },
  nl: {
    name: 'Dutch',
    levels: {
      A1: 'nl_a1_vocabulary.json',
      A2: 'nl_a2_vocabulary.json',
      B1: 'nl_b1_vocabulary.json',
    },
    tts: { VoiceId: 'Ruben', Engine: 'standard', LanguageCode: 'nl-NL' },
    parsePlurals: false,
    articlePrompt: 'This word is a noun with no article. Also determine the correct Dutch article (de or het) and prefix your response with it followed by a pipe character, e.g. "het|house" or "de|street".',
    normalizeArticle: (raw) => raw.toLowerCase() === 'het' ? 'het' : 'de',
  },
  fr: {
    name: 'French',
    levels: {
      A1: 'fr_a1_vocabulary.json',
      A2: 'fr_a2_vocabulary.json',
      B1: 'fr_b1_vocabulary.json',
    },
    tts: { VoiceId: 'Remi', Engine: 'generative', LanguageCode: 'fr-FR' },
    parsePlurals: false,
    articlePrompt: "This word is a French noun with no article. Also determine the correct French article (le, la, or l') and prefix your response with it followed by a pipe character, e.g. \"le|cat\" or \"la|house\" or \"l'|school\".",
    normalizeArticle: (raw) => {
      const r = raw.toLowerCase().replace(/['']/g, "'");
      if (r === "l'") return "l'";
      if (r === 'la') return 'la';
      return 'le';
    },
  },
  es: {
    name: 'Spanish',
    levels: {
      A1: 'es_a1_vocabulary.json',
      A2: 'es_a2_vocabulary.json',
      B1: 'es_b1_vocabulary.json',
    },
    tts: { VoiceId: 'Sergio', Engine: 'neural', LanguageCode: 'es-ES' },
    parsePlurals: false,
    normalizeArticle: (raw) => {
      const r = raw.toLowerCase();
      if (r === 'la' || r === 'las') return r;
      if (r === 'los') return 'los';
      return 'el';
    },
  },
};

module.exports = { LANGUAGE_CONFIG };
