import json
from typing import Set, Tuple

def load_vocabulary(filename: str) -> dict:
    """Load vocabulary from JSON file."""
    with open(filename, 'r', encoding='utf-8') as f:
        return json.load(f)

def get_word_set(vocab_list: list) -> Set[Tuple[str, str]]:
    """
    Extract unique words from vocabulary list.
    Returns set of (word, article) tuples to properly match nouns.
    """
    words = set()
    for entry in vocab_list:
        # Use (word, article) tuple for better matching
        # This distinguishes "der Teil" from "das Teil"
        word = entry['word'].lower()
        article = entry.get('article', '').lower()
        words.add((word, article))
    return words

def find_overlap(set1: Set[Tuple], set2: Set[Tuple]) -> Set[Tuple]:
    """Find words that appear in both sets."""
    return set1.intersection(set2)

def analyze_vocabulary_progression():
    """Analyze vocabulary overlap across CEFR levels."""

    # Load all vocabulary lists
    print("Loading vocabulary lists...")
    a1_vocab = load_vocabulary('a1_vocabulary.json')
    a2_vocab = load_vocabulary('a2_vocabulary.json')
    b1_vocab = load_vocabulary('b1_vocabulary.json')

    # Get word sets
    a1_words = get_word_set(a1_vocab)
    a2_words = get_word_set(a2_vocab)
    b1_words = get_word_set(b1_vocab)

    print(f"\nVocabulary sizes:")
    print(f"  A1: {len(a1_words)} unique words")
    print(f"  A2: {len(a2_words)} unique words")
    print(f"  B1: {len(b1_words)} unique words")
    print(f"  Total unique: {len(a1_words | a2_words | b1_words)} words\n")

    # Find overlaps
    a1_in_a2 = find_overlap(a1_words, a2_words)
    a1_in_b1 = find_overlap(a1_words, b1_words)
    a2_in_b1 = find_overlap(a2_words, b1_words)

    # A1 words that appear in both A2 and B1
    a1_in_both = find_overlap(a1_in_a2, a1_in_b1)

    # A2 words that are new (not in A1)
    a2_new = a2_words - a1_words

    # B1 words that are new (not in A1 or A2)
    b1_new = b1_words - a1_words - a2_words

    # Display results
    print("=" * 70)
    print("VOCABULARY OVERLAP ANALYSIS")
    print("=" * 70)

    print("\n📊 A1 → A2 Progression:")
    print(f"  A1 words also in A2: {len(a1_in_a2)} ({100*len(a1_in_a2)/len(a1_words):.1f}% of A1)")
    print(f"  A1 words NOT in A2: {len(a1_words - a2_words)} ({100*len(a1_words - a2_words)/len(a1_words):.1f}% of A1)")
    print(f"  New words in A2: {len(a2_new)} ({100*len(a2_new)/len(a2_words):.1f}% of A2)")

    print("\n📊 A1 → B1 Progression:")
    print(f"  A1 words also in B1: {len(a1_in_b1)} ({100*len(a1_in_b1)/len(a1_words):.1f}% of A1)")
    print(f"  A1 words NOT in B1: {len(a1_words - b1_words)} ({100*len(a1_words - b1_words)/len(a1_words):.1f}% of A1)")

    print("\n📊 A2 → B1 Progression:")
    print(f"  A2 words also in B1: {len(a2_in_b1)} ({100*len(a2_in_b1)/len(a2_words):.1f}% of A2)")
    print(f"  A2 words NOT in B1: {len(a2_words - b1_words)} ({100*len(a2_words - b1_words)/len(a2_words):.1f}% of A2)")
    print(f"  New words in B1: {len(b1_new)} ({100*len(b1_new)/len(b1_words):.1f}% of B1)")

    print("\n📊 Cumulative Vocabulary:")
    print(f"  A1 words in both A2 and B1: {len(a1_in_both)} ({100*len(a1_in_both)/len(a1_words):.1f}% of A1)")
    print(f"  Core vocabulary (A1+A2): {len(a1_words | a2_words)} words")
    print(f"  Complete vocabulary (A1+A2+B1): {len(a1_words | a2_words | b1_words)} words")

    # Show some examples
    print("\n" + "=" * 70)
    print("EXAMPLES")
    print("=" * 70)

    print("\n🔹 A1 words that continue through A2 and B1 (foundational vocabulary):")
    examples = sorted(list(a1_in_both))[:15]
    for i, (word, article) in enumerate(examples, 1):
        if article:
            print(f"  {i:2}. {article} {word}")
        else:
            print(f"  {i:2}. {word}")

    print("\n🔹 A1 words that DON'T appear in B1 (A1-specific):")
    a1_only = sorted(list(a1_words - b1_words))[:10]
    for i, (word, article) in enumerate(a1_only, 1):
        if article:
            print(f"  {i:2}. {article} {word}")
        else:
            print(f"  {i:2}. {word}")

    print("\n🔹 New words introduced in A2 (not in A1):")
    examples_a2_new = sorted(list(a2_new))[:15]
    for i, (word, article) in enumerate(examples_a2_new, 1):
        if article:
            print(f"  {i:2}. {article} {word}")
        else:
            print(f"  {i:2}. {word}")

    print("\n🔹 New words introduced in B1 (not in A1 or A2):")
    examples_b1_new = sorted(list(b1_new))[:15]
    for i, (word, article) in enumerate(examples_b1_new, 1):
        if article:
            print(f"  {i:2}. {article} {word}")
        else:
            print(f"  {i:2}. {word}")

    # Save detailed overlap data
    overlap_data = {
        "summary": {
            "a1_total": len(a1_words),
            "a2_total": len(a2_words),
            "b1_total": len(b1_words),
            "a1_in_a2": len(a1_in_a2),
            "a1_in_b1": len(a1_in_b1),
            "a2_in_b1": len(a2_in_b1),
            "a1_in_both_a2_and_b1": len(a1_in_both),
            "a2_new_words": len(a2_new),
            "b1_new_words": len(b1_new)
        },
        "a1_also_in_a2": sorted([f"{art} {word}".strip() for word, art in a1_in_a2]),
        "a1_also_in_b1": sorted([f"{art} {word}".strip() for word, art in a1_in_b1]),
        "a2_also_in_b1": sorted([f"{art} {word}".strip() for word, art in a2_in_b1]),
        "a1_only": sorted([f"{art} {word}".strip() for word, art in (a1_words - b1_words)]),
        "a2_new": sorted([f"{art} {word}".strip() for word, art in a2_new]),
        "b1_new": sorted([f"{art} {word}".strip() for word, art in b1_new])
    }

    with open('vocabulary_overlap_analysis.json', 'w', encoding='utf-8') as f:
        json.dump(overlap_data, f, ensure_ascii=False, indent=2)

    print("\n" + "=" * 70)
    print(f"✅ Detailed analysis saved to: vocabulary_overlap_analysis.json")
    print("=" * 70)

if __name__ == '__main__':
    analyze_vocabulary_progression()
