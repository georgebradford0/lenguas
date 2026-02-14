import re
import json

def is_example_sentence(line):
    """Check if a line is an example sentence."""
    # Lines starting with numbers (e.g., "1.", "2.")
    if re.match(r'^\d+\.', line):
        return True
    # Lines that start with a capital letter and contain a verb (basic heuristic)
    if re.match(r'^[A-ZÄÖÜ].*\s(ist|sind|war|waren|hat|haben|kann|konnte|muss|musste|soll|sollte|wird|wurde)\s', line):
        return True
    # Lines that look like full sentences (contain typical sentence markers)
    if re.search(r'\s(ich|du|er|sie|es|wir|ihr|Sie)\s', line, re.IGNORECASE):
        return True
    return False

def parse_vocabulary(input_file):
    """Parse the Goethe B1 vocabulary list and convert to JSON format."""

    with open(input_file, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    vocab_entries = []
    in_vocab_section = False
    skip_next_lines = 0

    for i, line in enumerate(lines):
        line = line.strip()

        # Find the start of vocabulary section
        if 'Alphabetischer Wortschatz' in line:
            in_vocab_section = True
            continue

        if not in_vocab_section:
            continue

        # Skip empty lines, page numbers, section markers
        if not line or line.isdigit():
            continue

        if any(marker in line for marker in ['VS_03', 'WORTLISTE', 'ZERTIFIKAT B1', 'INHALT']):
            continue

        # Skip single letter section headers
        if line in ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z']:
            continue

        # Skip example sentences
        if is_example_sentence(line):
            continue

        # Check if it's a continuation of a previous line (for multi-line entries)
        if skip_next_lines > 0:
            skip_next_lines -= 1
            continue

        # Pattern 1: Nouns with articles (der/die/das)
        noun_match = re.match(r'^(der|die|das)\s+([A-ZÄÖÜ][a-zäöüß]+(?:-[a-zäöüß]+)?)', line)
        if noun_match:
            article = noun_match.group(1)
            word = noun_match.group(2)
            full_entry = line.split('→')[0].strip()
            # Remove regional markers like (D), (A), (CH)
            full_entry = re.sub(r'\s*\([DACH]+\)', '', full_entry)

            entry = {
                "word": word,
                "article": article,
                "pos": "noun",
                "full_entry": full_entry
            }
            vocab_entries.append(entry)
            continue

        # Pattern 2: Verbs with conjugation
        # Match patterns like: "abbiegen, biegt ab," or "abholen, holt ab, holte ab,"
        verb_match = re.match(r'^([a-zäöü]+(?:en|n)),\s+', line)
        if verb_match and ('hat ' in line or 'ist ' in line or re.search(r',\s+\w+\s+(ab|an|auf|aus|bei|ein|mit|nach|vor|zu|zurück)', line)):
            word = verb_match.group(1)

            # Collect multi-line verb conjugations
            full_entry = line
            if i + 1 < len(lines) and not lines[i + 1].strip().startswith(('1.', '2.', 'A', 'B', 'C', 'D', 'E')):
                next_line = lines[i + 1].strip()
                if next_line and not re.match(r'^(der|die|das)\s+', next_line) and not re.match(r'^[a-zäöü]+,', next_line):
                    if 'hat ' in next_line or 'ist ' in next_line:
                        full_entry += ' ' + next_line
                        skip_next_lines = 1

            full_entry = full_entry.split('→')[0].strip()
            full_entry = re.sub(r'\s*\([DACH]+\)', '', full_entry)

            entry = {
                "word": word,
                "article": "",
                "pos": "verb",
                "full_entry": full_entry
            }
            vocab_entries.append(entry)
            continue

        # Pattern 3: Adjectives, adverbs, other word types (single words or short phrases)
        # Must not start with a number, must not be a sentence
        if len(line.split()) <= 4 and not line[0].isupper():
            # Clean up the word
            clean_word = line.split('→')[0].strip()
            clean_word = re.sub(r'\s*\([DACH]+\)', '', clean_word)
            clean_word = re.sub(r'\s*\(Pl\.\)', '', clean_word)

            # Skip if it contains typical sentence elements
            if '!' in clean_word or '?' in clean_word or '.' in clean_word:
                continue

            # Determine if it looks like a valid word entry
            if re.match(r'^[a-zäöüß]+(-[a-zäöüß]+)?$', clean_word):
                entry = {
                    "word": clean_word,
                    "article": "",
                    "pos": "other",  # adjective, adverb, conjunction, etc.
                    "full_entry": clean_word
                }
                vocab_entries.append(entry)
                continue

    return vocab_entries

def main():
    input_file = '/Users/georgebalch/.claude/projects/-Users-georgebalch-language-app-sandbox/d7101842-cb3a-401b-9ebd-ae9f0d1c9e75/tool-results/toolu_01YXUgREeVnzdhvMryWfX6AM.txt'
    output_file = 'b1_vocabulary.json'

    print("Parsing vocabulary list...")
    vocab = parse_vocabulary(input_file)

    print(f"Found {len(vocab)} vocabulary entries")

    # Write to JSON
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(vocab, f, ensure_ascii=False, indent=2)

    print(f"Vocabulary saved to {output_file}")

    # Show some examples
    print("\nFirst 10 entries:")
    for entry in vocab[:10]:
        print(f"  {entry}")

if __name__ == '__main__':
    main()
