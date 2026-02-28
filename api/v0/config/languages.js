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
    tts: { VoiceId: 'Laura', Engine: 'neural', LanguageCode: 'nl-NL' },
    parsePlurals: false,
  },
};

module.exports = { LANGUAGE_CONFIG };
