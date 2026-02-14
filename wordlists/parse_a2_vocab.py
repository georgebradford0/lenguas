import re
import json

# Common German word lists by part of speech
PREPOSITIONS = {
    'ab', 'an', 'auf', 'aus', 'außer', 'bei', 'bis', 'durch', 'für', 'gegen',
    'gegenüber', 'hinter', 'in', 'mit', 'nach', 'neben', 'ohne', 'über',
    'um', 'unter', 'von', 'vor', 'während', 'wegen', 'zu', 'zwischen'
}

CONJUNCTIONS = {
    'aber', 'als', 'bevor', 'bis', 'da', 'damit', 'dass', 'denn', 'falls',
    'nachdem', 'ob', 'obwohl', 'oder', 'seit', 'sobald', 'sodass', 'sondern',
    'sowohl', 'und', 'weil', 'wenn', 'wie', 'während', 'doch'
}

PRONOUNS = {
    'ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr', 'man', 'mich', 'mir', 'dich',
    'dir', 'sich', 'uns', 'euch', 'ihnen', 'dieser', 'jener', 'welcher',
    'mein', 'dein', 'sein', 'ihr', 'unser', 'euer', 'jemand', 'niemand',
    'etwas', 'nichts', 'alles', 'was', 'wer', 'wen', 'wem'
}

ADVERBS = {
    'auch', 'außerdem', 'bald', 'bereits', 'besonders', 'bisher', 'da', 'daher',
    'damals', 'dann', 'dazu', 'deshalb', 'dort', 'draußen', 'endlich', 'etwa',
    'fast', 'ganz', 'genauso', 'gerade', 'gern', 'gestern', 'gleich', 'heute',
    'hier', 'hin', 'hinten', 'hoffentlich', 'immer', 'inzwischen', 'irgendwo',
    'ja', 'jetzt', 'kaum', 'leider', 'lieber', 'links', 'mal', 'manchmal',
    'mehr', 'meistens', 'mindestens', 'morgen', 'nachher', 'natürlich', 'nein',
    'nicht', 'nie', 'noch', 'nun', 'nur', 'oben', 'oft', 'rechts', 'schon',
    'sehr', 'selbst', 'selten', 'so', 'sofort', 'sonst', 'später', 'trotzdem',
    'überall', 'unten', 'vielleicht', 'vorn', 'wahrscheinlich', 'weiter',
    'wenigstens', 'wieder', 'wirklich', 'wo', 'zuerst', 'zusammen', 'zwar'
}

PARTICLES = {
    'doch', 'eben', 'eigentlich', 'etwa', 'halt', 'ja', 'mal', 'nur', 'schon',
    'wohl', 'denn'
}

ADJECTIVE_ENDINGS = [
    'bar', 'lich', 'ig', 'isch', 'sam', 'haft', 'los', 'voll', 'frei',
    'arm', 'reich', 'wert', 'fähig', 'gemäß', 'end'
]

def classify_pos(word, full_entry):
    """Classify the part of speech for non-noun, non-verb words."""
    word_lower = word.lower()

    if word_lower in PREPOSITIONS:
        return 'preposition'
    if word_lower in CONJUNCTIONS:
        return 'conjunction'
    if word_lower in PRONOUNS:
        return 'pronoun'
    if word_lower in ADVERBS:
        return 'adverb'
    if word_lower in PARTICLES:
        return 'particle'

    for ending in ADJECTIVE_ENDINGS:
        if word_lower.endswith(ending):
            return 'adjective'

    if '¨' in full_entry:
        return 'adjective'

    if word_lower.startswith('ge') and word_lower.endswith(('t', 'en')):
        return 'adjective'

    if word_lower.startswith(('un', 'in')):
        for ending in ['bar', 'lich', 'ig', 'isch', 'sam']:
            if word_lower.endswith(ending):
                return 'adjective'

    if word_lower in ['ein', 'eine', 'einer', 'eins', 'zwei', 'drei', 'viele', 'wenige', 'alle', 'beide', 'einige', 'mehrere']:
        return 'determiner'

    if word[0].islower():
        return 'adjective'

    return 'other'

def parse_vocabulary(input_file):
    """Parse the Goethe A2 vocabulary list."""

    with open(input_file, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    vocab_entries = []
    in_vocab_section = False

    i = 0
    while i < len(lines):
        line = lines[i].strip()

        # Find the start of vocabulary section
        if not in_vocab_section:
            if 'Alphabetischer Wortschatz' in line:
                in_vocab_section = True
                i += 1
                continue
            i += 1
            continue

        # Skip empty lines and page markers
        if not line or line.isdigit() or line in ['A2_Wortliste_03_200616', 'WORTLISTE', 'GOETHE-ZERTIFIKAT A2']:
            i += 1
            continue

        # Skip single letter section headers
        if len(line) == 1 and line.isupper():
            i += 1
            continue

        # Skip example sentences
        if re.match(r'^[A-ZÄÖÜ].*[.!?]$', line) and len(line.split()) > 3:
            i += 1
            continue

        # Pattern 1: Nouns
        noun_match = re.match(r'^(der|die|das)\s+([A-ZÄÖÜ][a-zäöüß\-]+),?\s*([¨\-a-z/()]+)?\s*(\([DACHSG, ]+\))?', line)
        if noun_match:
            article = noun_match.group(1)
            word = noun_match.group(2)
            full_entry = re.sub(r'→.*$', '', line).strip()

            entry = {
                "word": word,
                "article": article,
                "pos": "noun",
                "full_entry": full_entry
            }
            vocab_entries.append(entry)
            i += 1
            continue

        # Pattern 2: Verbs
        verb_match = re.match(r'^([a-zäöü]+en|[a-zäöü]+n),?\s*$', line)
        if verb_match:
            word = verb_match.group(1).rstrip(',')
            full_entry = line

            # Collect next lines for conjugation
            j = i + 1
            while j < len(lines) and j < i + 5:
                next_line = lines[j].strip()
                if not next_line:
                    j += 1
                    continue
                if re.search(r'(hat|ist)\s+\w+', next_line):
                    full_entry += ' ' + next_line
                    j += 1
                    if 'hat ' in next_line or 'ist ' in next_line:
                        break
                else:
                    break

            if re.search(r'(hat|ist)\s+\w+', full_entry):
                full_entry = re.sub(r'→.*$', '', full_entry).strip()
                entry = {
                    "word": word,
                    "article": "",
                    "pos": "verb",
                    "full_entry": full_entry
                }
                vocab_entries.append(entry)
                i = j
                continue

        # Pattern 3: Adjectives/adverbs/other
        if re.match(r'^[a-zäöüß\-]+$', line):
            pos = classify_pos(line, line)
            entry = {
                "word": line,
                "article": "",
                "pos": pos,
                "full_entry": line
            }
            vocab_entries.append(entry)
            i += 1
            continue

        # Pattern 4: Phrases or compound expressions
        if re.match(r'^[a-zäöü].*[a-zäöü]$', line) and not re.search(r'[.!?]', line):
            entry = {
                "word": line,
                "article": "",
                "pos": "expression",
                "full_entry": line
            }
            vocab_entries.append(entry)
            i += 1
            continue

        i += 1

    return vocab_entries

def main():
    input_file = 'a2_extracted.txt'
    output_file = 'a2_vocabulary.json'

    print("Parsing A2 vocabulary list...")
    vocab = parse_vocabulary(input_file)

    print(f"Found {len(vocab)} vocabulary entries")

    # Remove duplicates
    seen = set()
    unique_vocab = []
    for entry in vocab:
        key = (entry['word'], entry['article'], entry['pos'])
        if key not in seen:
            seen.add(key)
            unique_vocab.append(entry)

    print(f"After removing duplicates: {len(unique_vocab)} entries")

    # Statistics
    pos_counts = {}
    for entry in unique_vocab:
        pos = entry['pos']
        pos_counts[pos] = pos_counts.get(pos, 0) + 1

    print("\nPart-of-speech distribution:")
    for pos, count in sorted(pos_counts.items(), key=lambda x: x[1], reverse=True):
        print(f"  {pos:15} {count:4} ({100*count/len(unique_vocab):.1f}%)")

    # Write to JSON
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(unique_vocab, f, ensure_ascii=False, indent=2)

    print(f"\nVocabulary saved to {output_file}")

    # Show examples
    print("\nFirst 20 entries:")
    for entry in unique_vocab[:20]:
        print(f"  {entry['word']:20} ({entry['pos']:12}) - {entry['full_entry'][:50]}")

if __name__ == '__main__':
    main()
