// Test plural parsing function

function parsePluralForm(fullEntry) {
  const match = fullEntry.match(/^(der|die|das)\s+([^,]+),\s*(.+)$/i);

  if (!match) {
    return { singular: fullEntry, plural: null };
  }

  const article = match[1];
  const word = match[2].trim();
  let pluralMarker = match[3].trim();

  // Handle cases like "ä, er" or "-ü, e" where umlaut and ending are separate
  pluralMarker = pluralMarker.replace(/^([-]?[äöüÄÖÜ]),?\s*/, '-$1');

  let pluralForm = 'die ';
  let umlautedWord = word;

  // Check for umlaut markers
  const hasUmlautA = /[-]?[äÄ]/.test(pluralMarker);
  const hasUmlautO = /[-]?[öÖ]/.test(pluralMarker);
  const hasUmlautU = /[-]?[üÜ]/.test(pluralMarker);

  // Apply umlaut if present (case-insensitive replacement)
  if (hasUmlautA) {
    // Replace last 'a' or 'A' with corresponding umlaut, preserving case
    umlautedWord = word.replace(/a([^aA]*)$/i, (match, p1) => {
      const wasUpper = /A/.test(match.charAt(0));
      return (wasUpper ? 'Ä' : 'ä') + p1;
    });
    pluralMarker = pluralMarker.replace(/[-]?[äÄ]/, '');
  } else if (hasUmlautO) {
    umlautedWord = word.replace(/o([^oO]*)$/i, (match, p1) => {
      const wasUpper = /O/.test(match.charAt(0));
      return (wasUpper ? 'Ö' : 'ö') + p1;
    });
    pluralMarker = pluralMarker.replace(/[-]?[öÖ]/, '');
  } else if (hasUmlautU) {
    umlautedWord = word.replace(/u([^uU]*)$/i, (match, p1) => {
      const wasUpper = /U/.test(match.charAt(0));
      return (wasUpper ? 'Ü' : 'ü') + p1;
    });
    pluralMarker = pluralMarker.replace(/[-]?[üÜ]/, '');
  }

  pluralMarker = pluralMarker.replace(/^[,\s-]+/, '').trim();

  if (!pluralMarker || pluralMarker === '–' || pluralMarker === '-') {
    pluralForm += umlautedWord;
  } else {
    // Special case: if word ends in 'e' and marker is 'en', only add 'n'
    if (umlautedWord.endsWith('e') && pluralMarker === 'en') {
      pluralForm += umlautedWord + 'n';
    } else {
      pluralForm += umlautedWord + pluralMarker;
    }
  }

  return { singular: `${article} ${word}`, plural: pluralForm };
}

// Test cases
const testCases = [
  "die Adresse,-en",
  "das Angebot, -e",
  "der Apfel, -Ä",
  "das Haus, -ä, er",
  "der Ehemann, ä, er",
  "das Auto, -s",
  "der Computer, –",
  "der Bruder, -ü",
  "das Buch, -ü, er",
];

console.log("Plural Parsing Tests:\n");
testCases.forEach(test => {
  const result = parsePluralForm(test);
  const formatted = result.plural ?
    `${result.singular} (pl: ${result.plural})` :
    result.singular;
  console.log(`Input:  ${test}`);
  console.log(`Output: ${formatted}\n`);
});
