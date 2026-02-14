import re
import json

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
        # (start with numbers or are obviously sentences)
        if re.match(r'^\d+\.', line):
            i += 1
            continue

        # Pattern 1: Nouns - must start with article and have comma
        # Format: "der/die/das Word, -plural"
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
        # Format: "infinitive, conjugation, conjugation, hat/ist past_participle"
        # Can span multiple lines
        verb_match = re.match(r'^([a-zäöü]+en|[a-zäöü]+n),\s+', line)
        if verb_match:
            word = verb_match.group(1)
            full_entry = line

            # Check if conjugation continues on next line
            j = i + 1
            while j < len(lines) and j < i + 3:  # Check up to 3 lines ahead
                next_line = lines[j].strip()
                if not next_line:
                    break
                # If next line contains hat/ist and past participle, it's part of the verb
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

        # Pattern 4: Simple adjectives/adverbs/other (single lowercase word)
        # Must be alone on a line, lowercase, and not part of a sentence
        if re.match(r'^[a-zäöüß\-]+$', line) and not any(c in line for c in '.!?,;()'):
            entry = {
                "word": line,
                "article": "",
                "pos": "other",
                "full_entry": line
            }
            vocab_entries.append(entry)
            i += 1
            continue

        # Skip everything else (example sentences, etc.)
        i += 1

    return vocab_entries

def main():
    input_file = '/Users/georgebalch/.claude/projects/-Users-georgebalch-language-app-sandbox/d7101842-cb3a-401b-9ebd-ae9f0d1c9e75/tool-results/toolu_01YXUgREeVnzdhvMryWfX6AM.txt'
    output_file = 'b1_vocabulary.json'

    print("Parsing vocabulary list...")
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

    # Write to JSON
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(unique_vocab, f, ensure_ascii=False, indent=2)

    print(f"Vocabulary saved to {output_file}")

    # Show some examples
    print("\nFirst 20 entries:")
    for entry in unique_vocab[:20]:
        print(f"  {entry['word']:20} ({entry['pos']:12}) - {entry['full_entry']}")

if __name__ == '__main__':
    main()
