import json
from typing import List, Dict, Set, Tuple

def load_vocabulary(filename: str) -> List[Dict]:
    """Load vocabulary from JSON file."""
    with open(filename, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_vocabulary(filename: str, vocab: List[Dict]):
    """Save vocabulary to JSON file."""
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(vocab, f, ensure_ascii=False, indent=2)

def get_word_set(vocab_list: List[Dict]) -> Set[Tuple[str, str]]:
    """Extract unique (word, article) tuples."""
    return {(entry['word'].lower(), entry.get('article', '').lower())
            for entry in vocab_list}

def find_missing_entries(target_vocab: List[Dict], source_vocab: List[Dict]) -> List[Dict]:
    """Find entries in source that are missing from target."""
    target_words = get_word_set(target_vocab)
    missing = []

    for entry in source_vocab:
        word_key = (entry['word'].lower(), entry.get('article', '').lower())
        if word_key not in target_words:
            missing.append(entry)

    return missing

def make_cumulative():
    """Make vocabulary lists cumulative by adding missing lower-level words."""

    print("Loading vocabulary lists...")
    a1_vocab = load_vocabulary('a1_vocabulary.json')
    a2_vocab = load_vocabulary('a2_vocabulary.json')
    b1_vocab = load_vocabulary('b1_vocabulary.json')

    print(f"\nOriginal sizes:")
    print(f"  A1: {len(a1_vocab)} words")
    print(f"  A2: {len(a2_vocab)} words")
    print(f"  B1: {len(b1_vocab)} words")

    # Step 1: Add missing A1 words to A2
    print("\n" + "="*70)
    print("Step 1: Adding A1 words to A2...")
    print("="*70)

    a1_missing_in_a2 = find_missing_entries(a2_vocab, a1_vocab)
    print(f"Found {len(a1_missing_in_a2)} A1 words missing in A2")

    if a1_missing_in_a2:
        print("\nSample missing A1 words being added to A2:")
        for entry in a1_missing_in_a2[:10]:
            display = f"{entry.get('article', '')} {entry['word']}".strip()
            print(f"  - {display}")

    # Create new A2 with A1 words added
    a2_cumulative = a2_vocab + a1_missing_in_a2

    # Step 2: Add missing A1+A2 words to B1
    print("\n" + "="*70)
    print("Step 2: Adding A1+A2 words to B1...")
    print("="*70)

    # Combine A1 and updated A2
    a1_a2_combined = a1_vocab + a2_cumulative

    # Find what's missing in B1
    missing_in_b1 = find_missing_entries(b1_vocab, a1_a2_combined)
    print(f"Found {len(missing_in_b1)} A1+A2 words missing in B1")

    if missing_in_b1:
        print("\nSample missing A1+A2 words being added to B1:")
        for entry in missing_in_b1[:10]:
            display = f"{entry.get('article', '')} {entry['word']}".strip()
            print(f"  - {display}")

    # Create new B1 with A1+A2 words added
    b1_cumulative = b1_vocab + missing_in_b1

    # Remove duplicates while preserving order
    print("\n" + "="*70)
    print("Removing duplicates...")
    print("="*70)

    def deduplicate(vocab_list: List[Dict]) -> List[Dict]:
        """Remove duplicate entries, keeping first occurrence."""
        seen = set()
        unique = []
        for entry in vocab_list:
            key = (entry['word'].lower(), entry.get('article', '').lower())
            if key not in seen:
                seen.add(key)
                unique.append(entry)
        return unique

    a2_final = deduplicate(a2_cumulative)
    b1_final = deduplicate(b1_cumulative)

    print(f"\nNew sizes after making cumulative:")
    print(f"  A1: {len(a1_vocab)} words (unchanged)")
    print(f"  A2: {len(a2_final)} words (was {len(a2_vocab)}, added {len(a2_final) - len(a2_vocab)})")
    print(f"  B1: {len(b1_final)} words (was {len(b1_vocab)}, added {len(b1_final) - len(b1_vocab)})")

    # Verify cumulative property
    print("\n" + "="*70)
    print("Verification:")
    print("="*70)

    a1_words = get_word_set(a1_vocab)
    a2_words = get_word_set(a2_final)
    b1_words = get_word_set(b1_final)

    a1_in_a2 = len(a1_words & a2_words)
    a1_in_b1 = len(a1_words & b1_words)
    a2_in_b1 = len(a2_words & b1_words)

    print(f"✓ A1 words in A2: {a1_in_a2}/{len(a1_words)} ({100*a1_in_a2/len(a1_words):.1f}%)")
    print(f"✓ A1 words in B1: {a1_in_b1}/{len(a1_words)} ({100*a1_in_b1/len(a1_words):.1f}%)")
    print(f"✓ A2 words in B1: {a2_in_b1}/{len(a2_words)} ({100*a2_in_b1/len(a2_words):.1f}%)")

    # Save cumulative versions
    print("\n" + "="*70)
    print("Saving cumulative vocabulary lists...")
    print("="*70)

    save_vocabulary('a2_vocabulary_cumulative.json', a2_final)
    save_vocabulary('b1_vocabulary_cumulative.json', b1_final)

    print(f"✓ Saved: a2_vocabulary_cumulative.json ({len(a2_final)} words)")
    print(f"✓ Saved: b1_vocabulary_cumulative.json ({len(b1_final)} words)")

    print("\n" + "="*70)
    print("✅ Cumulative vocabulary lists created successfully!")
    print("="*70)

    return {
        'a1': a1_vocab,
        'a2': a2_final,
        'b1': b1_final
    }

if __name__ == '__main__':
    make_cumulative()
