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

# Adjective ending patterns
ADJECTIVE_ENDINGS = [
    'bar', 'lich', 'ig', 'isch', 'sam', 'haft', 'los', 'voll', 'frei',
    'arm', 'reich', 'wert', 'fähig', 'gemäß'
]

def classify_pos(word, full_entry):
    """Classify the part of speech for non-noun, non-verb words."""
    word_lower = word.lower()

    # Check explicit lists
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

    # Check for adjective patterns
    for ending in ADJECTIVE_ENDINGS:
        if word_lower.endswith(ending):
            return 'adjective'

    # Adjectives often have comparative forms marked with ¨ for umlaut
    if '¨' in full_entry:
        return 'adjective'

    # Past participles used as adjectives (ge- prefix)
    if word_lower.startswith('ge') and word_lower.endswith(('t', 'en')):
        return 'adjective'

    # Common adjective prefixes
    if word_lower.startswith(('un', 'in')):
        for ending in ['bar', 'lich', 'ig', 'isch', 'sam']:
            if word_lower.endswith(ending):
                return 'adjective'

    # Numbers and quantifiers
    if word_lower in ['ein', 'eine', 'einer', 'eins', 'zwei', 'drei', 'viele', 'wenige', 'alle', 'beide', 'einige', 'mehrere']:
        return 'determiner'

    # If it ends in -s and starts with lowercase, might be adverb
    if word_lower.endswith('s') and word[0].islower():
        return 'adverb'

    # Default to adjective for words that could be adjectives/adverbs
    if word[0].islower():
        return 'adjective'

    return 'other'

def parse_vocabulary(input_file):
    """Parse the Goethe B1 vocabulary list and convert to JSON format."""

    with open(input_file, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    vocab_entries = []
    in_vocab_section = False

    i = 0
    while i < len(lines):
        line = lines[i].strip()

        # Find the start of vocabulary section
        if not in_vocab_section:
            if 'Alphabetischer Wortschatz' in line and i + 2 < len(lines) and lines[i+2].strip() == 'A':
                in_vocab_section = True
                i += 3  # Skip to after the "A"
                continue
            i += 1
            continue

        # Skip empty lines and page markers
        if not line or line.isdigit() or line in ['VS_03', 'WORTLISTE', 'ZERTIFIKAT B1', 'INHALT']:
            i += 1
            continue

        # Skip single letter section headers (A-Z)
        if len(line) == 1 and line.isupper():
            i += 1
            continue

        # Skip lines that are clearly example sentences
        if re.match(r'^\d+\.', line):
            i += 1
            continue

        # Pattern 1: Nouns - must start with article and have comma
        noun_match = re.match(r'^(der|die|das)\s+([A-ZÄÖÜ][a-zäöüß\-]+),\s*([¨\-a-z/]+|Pl\.)?\s*(\([DACH, ]+\))?', line)
        if noun_match:
            article = noun_match.group(1)
            word = noun_match.group(2)
            full_entry = re.sub(r'→.*$', '', line).strip()
            full_entry = re.sub(r'\s*$', '', full_entry)

            entry = {
                "word": word,
                "article": article,
                "pos": "noun",
                "full_entry": full_entry
            }
            vocab_entries.append(entry)
            i += 1
            continue

        # Pattern 2: Verbs - must contain conjugation with "hat" or "ist"
        verb_match = re.match(r'^([a-zäöü]+en|[a-zäöü]+n),\s+', line)
        if verb_match:
            word = verb_match.group(1)
            full_entry = line

            # Check if conjugation continues on next line
            j = i + 1
            while j < len(lines) and j < i + 3:
                next_line = lines[j].strip()
                if not next_line:
                    break
                if re.search(r'(hat|ist)\s+\w+', next_line) and not re.match(r'^\d+\.', next_line):
                    full_entry += ' ' + next_line
                    j += 1
                else:
                    break

            # Only add if it looks like a complete verb entry
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

        # Pattern 3: Plural nouns (marked with (Pl.))
        plural_match = re.match(r'^([A-ZÄÖÜ][a-zäöüß\-]+)\s+\(Pl\.\)', line)
        if plural_match:
            word = plural_match.group(1)
            entry = {
                "word": word,
                "article": "",
                "pos": "noun_plural",
                "full_entry": line
            }
            vocab_entries.append(entry)
            i += 1
            continue

        # Pattern 4: Other words (adjectives, adverbs, prepositions, etc.)
        if re.match(r'^[a-zäöüß\-]+$', line) and not any(c in line for c in '.!?,;()'):
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

        # Skip everything else
        i += 1

    return vocab_entries

def main():
    input_file = '/Users/georgebalch/.claude/projects/-Users-georgebalch-language-app-sandbox/d7101842-cb3a-401b-9ebd-ae9f0d1c9e75/tool-results/toolu_01YXUgREeVnzdhvMryWfX6AM.txt'
    output_file = 'b1_vocabulary.json'

    print("Parsing vocabulary list with refined POS tagging...")
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

    # Statistics by POS
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
    for pos in ['noun', 'verb', 'adjective', 'adverb', 'preposition', 'conjunction', 'pronoun']:
        examples = [e for e in unique_vocab if e['pos'] == pos][:5]
        if examples:
            print(f"\n{pos.upper()}:")
            for e in examples:
                print(f"  {e['word']:20} - {e['full_entry']}")

if __name__ == '__main__':
    main()
