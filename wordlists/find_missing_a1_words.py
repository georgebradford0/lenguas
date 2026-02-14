import re
import json
from typing import List, Set, Tuple

def load_a1_json() -> Set[str]:
    """Load parsed A1 vocabulary and get set of words."""
    with open('a1_vocabulary.json', 'r', encoding='utf-8') as f:
        vocab = json.load(f)

    # Get all words (normalized to lowercase)
    words = set()
    for entry in vocab:
        word = entry['word'].lower()
        article = entry.get('article', '').lower()
        # Store with article for nouns
        if article:
            words.add(f"{article} {word}")
        words.add(word)

    return words

def extract_vocab_entries_from_pdf(text_file: str) -> List[Tuple[str, int]]:
    """
    Extract potential vocabulary entries from the A1 PDF text.
    Returns list of (entry, line_number) tuples.
    """

    with open(text_file, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    entries = []
    in_vocab_section = False

    for line_num, line in enumerate(lines, 1):
        line = line.strip()

        # Find start of alphabetical list
        if 'Alphabetische Wortliste' in line:
            # Find the "A" that starts the vocab
            for i in range(line_num, min(line_num + 20, len(lines))):
                if lines[i].strip() == 'A':
                    in_vocab_section = True
                    break
            continue

        if not in_vocab_section:
            continue

        # Skip empty lines, page numbers, markers
        if not line or line.isdigit():
            continue

        if any(m in line for m in ['VS_02_280312', 'Seite ', 'Inventare']):
            continue

        # Skip single letter headers
        if len(line) == 1 and line.isupper():
            continue

        # Skip obvious example sentences (start with capital and contain verb)
        if re.match(r'^[A-ZÄÖÜ].*[.!?]', line):
            continue

        # Pattern 1: Nouns with articles
        if re.match(r'^(der|die|das)\s+[A-ZÄÖÜ]', line):
            entries.append((line, line_num))
            continue

        # Pattern 2: Verbs (lowercase word ending in -en or -n)
        if re.match(r'^[a-zäöü]+e?n$', line):
            entries.append((line, line_num))
            continue

        # Pattern 3: Adjectives/adverbs (single lowercase word)
        if re.match(r'^[a-zäöüß]+(-[a-zäöüß]+)?$', line):
            entries.append((line, line_num))
            continue

        # Pattern 4: Expressions (like "auf sein")
        if re.match(r'^(auf|aus|an)\s+sein$', line):
            entries.append((line, line_num))
            continue

    return entries

def analyze_missing_words():
    """Find words in A1 PDF that weren't parsed into JSON."""

    print("="*70)
    print("FINDING MISSING A1 VOCABULARY WORDS")
    print("="*70)
    print()

    # Load parsed vocabulary
    print("Loading parsed A1 vocabulary...")
    parsed_words = load_a1_json()
    print(f"  Found {len(parsed_words)} parsed entries")

    # Extract from PDF
    print("\nExtracting vocabulary from A1 PDF...")
    pdf_entries = extract_vocab_entries_from_pdf('a1_extracted.txt')
    print(f"  Found {len(pdf_entries)} potential entries in PDF")

    # Find missing entries
    print("\nAnalyzing missing entries...")
    missing = []

    for entry, line_num in pdf_entries:
        # Normalize the entry
        entry_lower = entry.lower()

        # Extract the main word from the entry
        if entry_lower.startswith(('der ', 'die ', 'das ')):
            # Noun - extract word after article
            parts = entry.split()
            if len(parts) >= 2:
                word = parts[1].lower().rstrip(',')
                full_entry = f"{parts[0].lower()} {word}"
                if word not in parsed_words and full_entry not in parsed_words:
                    missing.append((entry, line_num, 'noun'))
        else:
            # Verb, adjective, or other
            word = entry_lower.split()[0] if ' ' in entry_lower else entry_lower
            word = word.rstrip(',')
            if word not in parsed_words:
                missing.append((entry, line_num, 'other'))

    print(f"\n{'='*70}")
    print(f"RESULTS: Found {len(missing)} potentially missing entries")
    print(f"{'='*70}")

    if missing:
        print(f"\nMissing entries (showing first 50):")
        print(f"{'-'*70}")

        for i, (entry, line_num, entry_type) in enumerate(missing[:50], 1):
            print(f"{i:3}. Line {line_num:4}: {entry:40} ({entry_type})")

    # Let's also check the PDF more carefully for compound words and special cases
    print(f"\n{'='*70}")
    print("DETAILED ANALYSIS OF A1 PDF STRUCTURE")
    print(f"{'='*70}")

    # Read through the vocab section more carefully
    with open('a1_extracted.txt', 'r', encoding='utf-8') as f:
        content = f.read()

    # Find the vocab section
    start_idx = content.find('Alphabetische Wortliste')
    if start_idx != -1:
        vocab_section = content[start_idx:start_idx + 5000]  # First 5000 chars
        lines = vocab_section.split('\n')

        print("\nFirst 30 lines of alphabetical vocabulary section:")
        print(f"{'-'*70}")
        for i, line in enumerate(lines[:30], 1):
            if line.strip():
                print(f"{i:3}. {line[:65]}")

    # Save detailed missing list
    with open('a1_missing_words.txt', 'w', encoding='utf-8') as f:
        f.write("Missing A1 Vocabulary Entries\n")
        f.write("="*70 + "\n\n")
        f.write(f"Expected: ~700 words\n")
        f.write(f"Parsed: {len([w for w in parsed_words if ' ' not in w])} words\n")
        f.write(f"Potentially missing: {len(missing)}\n\n")
        f.write("-"*70 + "\n\n")

        for entry, line_num, entry_type in missing:
            f.write(f"Line {line_num}: {entry} ({entry_type})\n")

    print(f"\n✓ Detailed analysis saved to: a1_missing_words.txt")

if __name__ == '__main__':
    analyze_missing_words()
