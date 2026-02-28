"""
Parse Dutch NT2 A0-A1 vocabulary list from NUMO.
Source: https://assets.numo.nl/wp/Woordenlijst-nt2.pdf

Format: 4-column table (row-by-row in extracted text)
  Woord | Vaardigheid | Oefening | Woordsoort

Dutch POS (Woordsoort) values:
  zelfstandig naamwoord -> noun
  werkwoord             -> verb
  bijvoeglijk naamwoord -> adjective
  bijwoord              -> adverb
  (all others filtered out)

Note: Dutch word lists do not include articles (de/het) for nouns.
"""
import json
import re

KEEP_POS = {
    'zelfstandig naamwoord': 'noun',
    'werkwoord': 'verb',
    'bijvoeglijk naamwoord': 'adjective',
    'bijwoord': 'adverb',
}

SKIP_LINES = {
    'Woord', 'Vaardigheid', 'Oefening', 'Woordsoort',
    'NT2 A0-A1', 'WOORDENLIJST', 'NT2-MODULES A0-A1',
    'Inhoud', 'Totaal aanbod van woorden \u2013 op alfabet',
    'Woorden in de module Woordenschat \u2013 per oefening',
    'Woorden in de Startmodule \u2013 per oefening',
    'Woorden in de module Grammatica \u2013 per oefening',
    'Woorden in de module Lezen \u2013 per oefening',
}

# Grammatical meta-terms that appear in language exercises but aren't vocabulary
METALINGUISTIC_KEYWORDS = [
    'voornaamwoord', 'naamwoord', 'werkwoord', 'lidwoord',
    'achtervoegsel', 'voorvoegsel', 'deelwoord', 'bijvoeglijk',
    'bijwoord', 'telwoord', 'adjectief', 'adverbium', 'affix',
]


def is_metalinguistic(word):
    """Filter grammatical meta-terms and malformed entries."""
    if word[0].isdigit():
        return True
    w = word.lower()
    for kw in METALINGUISTIC_KEYWORDS:
        if kw in w:
            return True
    # Contrastive pairs like "actief - passief"
    if ' - ' in word:
        return True
    return False


def is_skip(line):
    if line in SKIP_LINES:
        return True
    if 'Numo \u2013 Woordenlijst' in line:
        return True
    if line.isdigit():
        return True
    if re.match(r'^\d+$', line):
        return True
    return False


def parse(input_file):
    with open(input_file, encoding='utf-8') as f:
        lines = [l.rstrip('\n') for l in f]

    # Collect non-blank, non-skip lines after the column headers
    in_data = False
    data_lines = []
    for line in lines:
        stripped = line.strip()
        if not in_data:
            if stripped == 'Woordsoort':
                in_data = True
            continue
        if not stripped:
            continue
        if is_skip(stripped):
            continue
        data_lines.append(stripped)

    # Group into rows of 4: [word, skill, exercise, pos]
    entries = []
    seen = set()
    i = 0
    while i + 3 < len(data_lines):
        word = data_lines[i]
        skill = data_lines[i + 1]
        exercise = data_lines[i + 2]
        raw_pos = data_lines[i + 3]
        i += 4

        pos = KEEP_POS.get(raw_pos)
        if not pos:
            continue

        if is_metalinguistic(word):
            continue

        key = (word.lower(), pos)
        if key in seen:
            continue
        seen.add(key)

        entries.append({
            'word': word,
            'article': '',
            'pos': pos,
            'full_entry': word,
        })

    return entries


def main():
    entries = parse('nl_a1_extracted.txt')

    pos_counts = {}
    for e in entries:
        pos_counts[e['pos']] = pos_counts.get(e['pos'], 0) + 1

    print(f'Total: {len(entries)} entries')
    print('POS distribution:')
    for pos, count in sorted(pos_counts.items(), key=lambda x: -x[1]):
        print(f'  {pos:15} {count:4} ({100*count/len(entries):.1f}%)')

    with open('nl_a1_vocabulary.json', 'w', encoding='utf-8') as f:
        json.dump(entries, f, ensure_ascii=False, indent=2)
    print('Written to nl_a1_vocabulary.json')

    print('\nSample entries:')
    for pos in ['noun', 'verb', 'adjective', 'adverb']:
        sample = [e for e in entries if e['pos'] == pos][:3]
        if sample:
            print(f'  {pos}: {[e["word"] for e in sample]}')


if __name__ == '__main__':
    main()
