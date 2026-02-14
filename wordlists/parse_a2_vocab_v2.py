import re
import json

# Import POS classification from B1 parser
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
    'wenigstens', 'wieder', 'wirklich', 'wo', 'zuerst', 'zusammen', 'zwar', 'allein'
}

ADJECTIVE_ENDINGS = ['bar', 'lich', 'ig', 'isch', 'sam', 'haft', 'los', 'voll', 'frei',
                     'arm', 'reich', 'wert', 'fähig', 'gemäß', 'end', 'ell']

def classify_pos(word, full_entry):
    """Classify POS for non-noun, non-verb words."""
    word_lower = word.lower()

    if word_lower in PREPOSITIONS:
        return 'preposition'
    if word_lower in CONJUNCTIONS:
        return 'conjunction'
    if word_lower in PRONOUNS:
        return 'pronoun'
    if word_lower in ADVERBS:
        return 'adverb'

    for ending in ADJECTIVE_ENDINGS:
        if word_lower.endswith(ending):
            return 'adjective'

    if '¨' in full_entry or '-' in word:
        return 'adjective'

    if word[0].islower():
        return 'adjective'

    return 'other'

def is_example_sentence(line):
    """Check if line is an example sentence."""
    if re.match(r'^[A-ZÄÖÜ].*[.!?…]$', line):
        return True
    if re.search(r'\s(ich|du|er|sie|es|wir|ihr|Sie|ist|sind|hat|haben|war|kann|muss)\s', line, re.IGNORECASE):
        return True
    return False

def parse_vocabulary(input_file):
    """Parse A2 vocabulary."""

    with open(input_file, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    vocab_entries = []
    in_vocab_section = False

    i = 0
    while i < len(lines):
        line = lines[i].strip()

        # Find start - look for "Alphabetischer Wortschatz" followed by "A"
        if not in_vocab_section:
            if 'Alphabetischer Wortschatz' in line:
                # Find the next "A" line
                j = i + 1
                while j < len(lines):
                    if lines[j].strip() == 'A':
                        in_vocab_section = True
                        i = j + 1
                        break
                    j += 1
                continue
            i += 1
            continue

        # Skip empty lines, page markers
        if not line or line.isdigit():
            i += 1
            continue

        # Skip document markers
        if any(marker in line for marker in ['A2_Wortliste', 'WORTLISTE', 'GOETHE-ZERTIFIKAT', 'Seite ']):
            i += 1
            continue

        # Skip single letter headers
        if len(line) == 1 and line.isupper():
            i += 1
            continue

        # Skip example sentences
        if is_example_sentence(line):
            i += 1
            continue

        # Pattern 1: Nouns with article
        noun_match = re.match(r'^(der|die|das)\s+([A-ZÄÖÜ][a-zäöüß\-]+),?\s*([¨\-a-ze/()]+)?', line)
        if noun_match:
            article = noun_match.group(1)
            word = noun_match.group(2)
            full_entry = line

            entry = {
                "word": word,
                "article": article,
                "pos": "noun",
                "full_entry": full_entry
            }
            vocab_entries.append(entry)
            i += 1
            continue

        # Pattern 2: Verbs with conjugation
        verb_match = re.match(r'^([a-zäöü]+en|[a-zäöü]+n),\s+', line)
        if verb_match:
            word = verb_match.group(1)
            full_entry = line.rstrip(',')

            # Check next lines for conjugation continuation
            j = i + 1
            while j < len(lines) and j < i + 3:
                next_line = lines[j].strip()
                if not next_line:
                    j += 1
                    continue
                # If it contains conjugation info
                if re.search(r'(hat|ist)\s+\w+', next_line) or re.match(r'^(ruft|gibt|sieht|fährt|läuft|nimmt|isst)\s', next_line):
                    full_entry += ' ' + next_line
                    j += 1
                    if 'hat ' in next_line or 'ist ' in next_line:
                        break
                else:
                    break

            # Only add if we found complete conjugation
            if re.search(r'(hat|ist)\s+\w+', full_entry):
                entry = {
                    "word": word,
                    "article": "",
                    "pos": "verb",
                    "full_entry": full_entry
                }
                vocab_entries.append(entry)
                i = j
                continue

        # Pattern 3: Simple adjectives/adverbs (single word, lowercase)
        if re.match(r'^[a-zäöüß]+(-[a-zäöüß]+)?$', line):
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

        i += 1

    return vocab_entries

def main():
    input_file = 'a2_extracted.txt'
    output_file = 'a2_vocabulary.json'

    print("Parsing A2 vocabulary...")
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

    # Show examples by POS
    print("\nExamples by part of speech:")
    for pos in ['noun', 'verb', 'adjective', 'adverb', 'preposition']:
        examples = [e for e in unique_vocab if e['pos'] == pos][:5]
        if examples:
            print(f"\n{pos.upper()}:")
            for e in examples:
                print(f"  {e['word']:20} - {e['full_entry'][:60]}")

if __name__ == '__main__':
    main()
