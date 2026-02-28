"""
Parse Dutch NT2 B1 vocabulary - Staatsexamen NT2 Aanvullende Woordenlijst.
Source: 2032_CvTE_NT2_woordenlijst-2023-nieuw_toeg.pdf

Format: simple alphabetical word list, one word per line.
Letter headers (a, b, c ...) separate sections.
No POS labels - uses Dutch-specific heuristics to classify.

To regenerate from PDF:
  pdftotext 2032_CvTE_NT2_woordenlijst-2023-nieuw_toeg.pdf nl_b1_extracted.txt
"""
import json
import os
import re

# ── Dutch POS heuristics ────────────────────────────────────────────────────

VERB_ENDINGS = (
    'elen', 'eren', 'enen', 'anen', 'inen', 'onen', 'unen',
    'aien', 'oien', 'uien',
    'ssen', 'tten', 'ppen', 'kken', 'mmen', 'nnen', 'llen',
    'ijden', 'eiden', 'inden', 'anden', 'onden', 'enden',
    'assen', 'essen', 'issen', 'ossen', 'ussen',
)

ADJ_ENDINGS = (
    'lijk', 'elijk',                # vriendelijk, verschrikkelijk
    'ig',                           # verdrietig, bezorgd - handled separately
    'isch',                         # digitaal pattern covered by aal
    'baar',                         # betaalbaar
    'loos',                         # werkloos
    'achtig',                       # roodachtig
    'ief', 'eel', 'aal', 'ieel',    # actief, digitaal
    'ant', 'ent',                   # interessant
    'erd', 'erd',
)

KNOWN_ADJECTIVES = {
    'actief', 'afwezig', 'aanwezig', 'beleefd', 'benieuwd', 'beter', 'bezorgd',
    'bruin', 'dichtbij', 'digitaal', 'dun', 'eenzaam', 'eerste', 'gemiddeld',
    'gewond', 'glad', 'geel', 'grijs', 'groen', 'internationaal', 'jaarlijks',
    'leeg', 'licht', 'lokaal', 'los', 'mager', 'maximaal', 'moe', 'nat',
    'nieuw', 'online', 'openbaar', 'oud', 'rood', 'roze', 'snel', 'steil',
    'veilig', 'verbaasd', 'verdrietig', 'volgend', 'vrijwillig',
    'vriendelijk', 'verschrikkelijk', 'werkloos', 'zwaar',
    # ordinals
    'tweede', 'derde', 'vierde', 'vijfde', 'zesde', 'zevende',
}

KNOWN_ADVERBS = {
    'dichtbij', 'jaarlijks', 'later', 'naartoe', 'plotseling', 'tevoren',
    'vanmiddag', 'vanmorgen', 'vannacht',
}

KNOWN_VERBS = {
    'afmelden', 'afzeggen', 'bezorgen', 'deelnemen', 'dansen', 'drogen',
    'lopen', 'meegaan', 'snijden', 'starten', 'stelen', 'tillen', 'timmeren',
    'toelichten', 'trainen', 'uitzoeken', 'verplegen', 'voorlezen',
    'waaien', 'waarschuwen', 'wassen',
}

KNOWN_NOUNS = {
    'abonnement', 'evenement', 'hersenen', 'kampioen', 'metalen', 'morgen',
    'personeel', 'schoen', 'seizoen', 'spullen', 'vrachtwagen',
}

# Words to exclude entirely (interjections, grammar terms, phrases)
EXCLUDE = {'sorry', 'alsjeblieft'}  # interjections


def classify_pos(word):
    w = word.lower()

    if w in KNOWN_NOUNS:
        return 'noun'
    if w in KNOWN_ADVERBS:
        return 'adverb'
    if w in KNOWN_ADJECTIVES:
        return 'adjective'
    if w in KNOWN_VERBS:
        return 'verb'

    # Past participles used as adjectives (-d ending after root)
    # e.g. beleefd, benieuwd, bezorgd, verbaasd
    if w.endswith('d') and len(w) > 5 and not w.endswith('nd'):
        # Past participle pattern: verb-stem + d
        # Heuristic: if removing 'd' gives something verb-like
        stem = w[:-1]
        if stem.endswith(('eel', 'aag', 'eer', 'eur', 'auw', 'ang', 'eng', 'org', 'elg')):
            return 'adjective'

    # Adjective endings
    for ending in ADJ_ENDINGS:
        if w.endswith(ending) and len(w) > len(ending) + 2:
            return 'adjective'

    # -zaam adjective ending (e.g. eenzaam, zorgzaam)
    if w.endswith('zaam') and len(w) > 5:
        return 'adjective'

    # -ig adjective ending (but not -tig for numerals)
    if w.endswith('ig') and len(w) > 4 and not w.endswith('tig'):
        return 'adjective'

    # Verb: Dutch infinitives end in -en
    if w.endswith('en') and len(w) > 4:
        # Exclude clear nouns: reden, weken, etc. that end in -en
        # If it also matches verb-specific endings, confident verb
        for ending in VERB_ENDINGS:
            if w.endswith(ending):
                return 'verb'
        # General -en rule - likely verb
        return 'verb'

    # -n infinitives (e.g. doen, staan, gaan, zien)
    if w.endswith('n') and len(w) > 3 and w[-2] not in 'aeiou':
        return 'verb'

    return 'noun'


def is_skip(line):
    """Skip section headers, page markers, and preamble."""
    # Single letter headings
    if re.match(r'^[a-z]$', line):
        return True
    # Page footer / document title
    if 'STAATSEXAMEN' in line or 'TWEEDE TAAL' in line:
        return True
    # Section continuation header
    if 'Woorden' in line and ('vervolg' in line or len(line) < 15):
        return True
    # Preamble sentences (contain spaces and are long descriptive text)
    if len(line) > 50 and ' ' in line and not any(c in line for c in [',', '(']):
        return True
    # Numbered items or bullets
    if re.match(r'^\d+\.', line):
        return True
    return False


def extract_primary_word(raw):
    """
    Handle entries with multiple forms e.g.:
      'trainen, trainer, training'  → 'trainen'
      'stagiair, stagiaire'         → 'stagiair'
      'voetbal, voetballen'         → 'voetbal'
      'het weer'                    → 'weer'
      'de auto'                     → 'auto'
    """
    # Strip leading article (de/het) — these occasionally appear in the list
    raw = re.sub(r'^(de|het)\s+', '', raw.strip())
    # Split on comma and take the first
    first = raw.split(',')[0].strip()
    return first


def parse(input_file, a1_words=None, a2_words=None):
    with open(input_file, encoding='utf-8') as f:
        lines = [l.rstrip('\n').strip() for l in f]

    # Find start of word list (after "Woorden" header)
    start = 0
    for i, line in enumerate(lines):
        if line.strip() == 'Woorden':
            start = i + 1
            break

    entries = []
    seen = set()

    for line in lines[start:]:
        if not line or is_skip(line):
            continue

        # Check for explicit POS hint in parentheses e.g. "groeten (werkwoord)"
        pos_hint = None
        hint_match = re.search(r'\((werkwoord|zelfstandig naamwoord|bijvoeglijk naamwoord|bijwoord)\)', line)
        if hint_match:
            hint_map = {
                'werkwoord': 'verb',
                'zelfstandig naamwoord': 'noun',
                'bijvoeglijk naamwoord': 'adjective',
                'bijwoord': 'adverb',
            }
            pos_hint = hint_map.get(hint_match.group(1))
            line = line[:hint_match.start()].strip().rstrip(',')

        primary = extract_primary_word(line)

        if not primary or not primary[0].isalpha():
            continue

        if primary.lower() in EXCLUDE:
            continue

        # Skip if already covered at A1 or A2
        if a1_words and primary.lower() in a1_words:
            continue
        if a2_words and primary.lower() in a2_words:
            continue

        pos = pos_hint if pos_hint else classify_pos(primary)

        key = primary.lower()
        if key in seen:
            continue
        seen.add(key)

        entries.append({
            'word': primary,
            'article': '',
            'pos': pos,
            'full_entry': line,
        })

    return entries


def main():
    a1_words, a2_words = set(), set()
    for path, word_set in [('nl_a1_vocabulary.json', a1_words),
                           ('nl_a2_vocabulary.json', a2_words)]:
        if os.path.exists(path):
            data = json.load(open(path, encoding='utf-8'))
            word_set.update(e['word'].lower() for e in data)
            print(f'Loaded {len(word_set)} words from {path}')

    entries = parse('nl_b1_extracted.txt', a1_words, a2_words)

    pos_counts = {}
    for e in entries:
        pos_counts[e['pos']] = pos_counts.get(e['pos'], 0) + 1

    print(f'\nTotal B1: {len(entries)} entries')
    print('POS distribution:')
    for pos, count in sorted(pos_counts.items(), key=lambda x: -x[1]):
        print(f'  {pos:15} {count:4} ({100*count/len(entries):.1f}%)')

    with open('nl_b1_vocabulary.json', 'w', encoding='utf-8') as f:
        json.dump(entries, f, ensure_ascii=False, indent=2)
    print('\nWritten to nl_b1_vocabulary.json')

    print('\nSample entries:')
    for pos in ['noun', 'verb', 'adjective']:
        sample = [e for e in entries if e['pos'] == pos][:5]
        if sample:
            print(f'  {pos}: {[e["word"] for e in sample]}')


if __name__ == '__main__':
    main()
