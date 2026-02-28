"""
Parse Dutch NT2 A1-A2 vocabulary list from NUMO.
Source: https://assets.numo.nl/wp/Woordenlijst-nt2-modules-A1-A2.pdf

Format: 3-column table (column-by-column per page in extracted text)
  woord | rubriek(en) | categorie

Each page: [Numo header] [page number] [words...] [rubrics...] [categories...]
The three columns are equal length within each page.

Only section 1 of the extracted file is used (stops before the second
"categorie" header which marks the exercise-section repetition).

Dutch POS (categorie) values mapped:
  werkwoord                          -> verb
  zelfstandig naamwoord              -> noun
  beroep - zelfstandig naamwoord     -> noun
  bijvoeglijk naamwoord              -> adjective
  bijvoeglijk naamwoord (tegenw...)  -> adjective
  bijwoord                           -> adverb
  (all others filtered out)

Note: Dutch word lists do not include articles (de/het) for nouns.
"""
import json

METALINGUISTIC_KEYWORDS = [
    'voornaamwoord', 'naamwoord', 'werkwoord', 'lidwoord',
    'achtervoegsel', 'voorvoegsel', 'deelwoord', 'bijvoeglijk',
    'bijwoord', 'telwoord', 'adjectief', 'adverbium', 'affix',
]


def is_metalinguistic(word):
    if word[0].isdigit():
        return True
    w = word.lower()
    for kw in METALINGUISTIC_KEYWORDS:
        if kw in w:
            return True
    if ' - ' in word:
        return True
    return False


KEEP_POS = {
    'werkwoord': 'verb',
    'zelfstandig naamwoord': 'noun',
    'beroep - zelfstandig naamwoord': 'noun',
    'bijvoeglijk naamwoord': 'adjective',
    'bijvoeglijk naamwoord (tegenw. deelwoord)': 'adjective',
    'bijwoord': 'adverb',
}

NUMO_MARKER = 'Numo \u2013 Woordenlijst NT2-modules A1-A2'


def parse(input_file, a1_words=None):
    """Parse the A1-A2 list. Optionally pass a set of A1 words to exclude."""
    with open(input_file, encoding='utf-8') as f:
        lines = [l.rstrip('\n') for l in f]

    # Only process section 1: stop at second 'categorie' header
    categorie_count = 0
    section1_lines = []
    for line in lines:
        if line.strip() == 'categorie':
            categorie_count += 1
            if categorie_count == 2:
                break
        section1_lines.append(line)

    # Split into pages by NUMO_MARKER
    pages = []
    current_page = []
    for line in section1_lines:
        if NUMO_MARKER in line.strip():
            if current_page:
                pages.append(current_page)
            current_page = []
        else:
            current_page.append(line)
    if current_page:
        pages.append(current_page)

    entries = []
    seen = set()

    for page_lines in pages:
        # Strip the page number (first non-blank line after marker)
        non_blank = [l.strip() for l in page_lines if l.strip()]

        # Remove page number and section headers
        content = []
        for line in non_blank:
            if (line.isdigit()
                    or line == 'woord'
                    or line.startswith('rubriek')
                    or line == 'categorie'
                    or line.startswith('NT2 A1-A2')
                    or line == 'WOORDENLIJST'
                    or line.startswith('NT2-MODULES')):
                continue
            content.append(line)

        if not content:
            continue

        # Three equal columns: words, rubrics, categories
        col_size = len(content) // 3
        if col_size == 0:
            continue

        words = content[:col_size]
        categories = content[col_size * 2:col_size * 3]

        for word, raw_pos in zip(words, categories):
            pos = KEEP_POS.get(raw_pos)
            if not pos:
                continue

            if is_metalinguistic(word):
                continue

            # Skip entries in the A1 list if provided
            if a1_words and word.lower() in a1_words:
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
    # Load A1 words to avoid duplicates between levels
    try:
        import os
        a1_path = 'nl_a1_vocabulary.json'
        if os.path.exists(a1_path):
            a1_data = json.load(open(a1_path, encoding='utf-8'))
            a1_words = {e['word'].lower() for e in a1_data}
            print(f'Loaded {len(a1_words)} A1 words to exclude')
        else:
            a1_words = None
            print('No A1 list found, not filtering duplicates')
    except Exception as e:
        a1_words = None
        print(f'Could not load A1 list: {e}')

    entries = parse('nl_a2_extracted.txt', a1_words=a1_words)

    pos_counts = {}
    for e in entries:
        pos_counts[e['pos']] = pos_counts.get(e['pos'], 0) + 1

    print(f'Total: {len(entries)} entries')
    print('POS distribution:')
    for pos, count in sorted(pos_counts.items(), key=lambda x: -x[1]):
        print(f'  {pos:15} {count:4} ({100*count/len(entries):.1f}%)')

    with open('nl_a2_vocabulary.json', 'w', encoding='utf-8') as f:
        json.dump(entries, f, ensure_ascii=False, indent=2)
    print('Written to nl_a2_vocabulary.json')

    print('\nSample entries:')
    for pos in ['noun', 'verb', 'adjective', 'adverb']:
        sample = [e for e in entries if e['pos'] == pos][:3]
        if sample:
            print(f'  {pos}: {[e["word"] for e in sample]}')


if __name__ == '__main__':
    main()
