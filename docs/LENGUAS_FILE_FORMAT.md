# `.lenguas` File Format

A `.lenguas` file is the JSON artifact produced by [`lenguas parse`](../cli/) — a fully parsed, ready-to-render book in a single self-contained payload. The same shape is what the mobile app downloads from `GET /books/:hash` and what lives at `s3://lenguas-parsed-books/parsed-books/<sha256>.json`.

Source of truth:
- Server type: [`api/v0/lib/parseEpub.js`](../api/v0/lib/parseEpub.js) (assembly)
- CLI type: [`cli/src/openai.rs`](../cli/src/openai.rs) (`SerializedBook` struct)
- Mobile type: [`mobile/src/utils/epubParser.ts`](../mobile/src/utils/epubParser.ts) (`SerializedBook` interface)

## Top-level shape

```json
{
  "version": 2,
  "id": "1xkmcfo",
  "title": "Der Prozess",
  "author": "Franz Kafka",
  "description": "An ordinary bank clerk is arrested without explanation and drawn into an opaque legal bureaucracy. The novel follows his attempts to defend himself against charges he cannot learn.",
  "genre": "Literary Fiction",
  "difficulty": "C1",
  "language": "de",
  "toc": [...],
  "spineHrefs": [...],
  "chapterContent": {...},
  "savedAt": 1716480000000
}
```

| Field | Type | Notes |
|---|---|---|
| `version` | `2` | Schema version. Bump on any breaking shape change. |
| `id` | `string` | Short base36 djb2 hash of `{title}\|{toc-ids}\|{ms-timestamp}`. Stable per parse; **not** the same as the S3 content hash. Used only as a React `key`. |
| `title` | `string` | Library-display title. Cleaned by the LLM — strips file-name cruft, edition tags, appended author names. |
| `author` | `string \| null` | `"First Last"` form. `null` if the LLM can't identify one from the text. |
| `description` | `string \| null` | 1–2 sentence neutral English summary. |
| `genre` | `string \| null` | Short label, e.g. `"Mystery"`, `"Memoir"`, `"Children's"`. |
| `difficulty` | `"A1" \| "A2" \| "B1" \| "B2" \| "C1" \| "C2" \| null` | CEFR reading-comprehension estimate for a learner of the source language. |
| `language` | `"de" \| "nl" \| "fr" \| "es"` | Source language. |
| `toc` | `TocEntry[]` | Ordered chapter list. See below. |
| `spineHrefs` | `string[]` | Reading order — same as `toc.map(t => t.id)`, kept separately for legacy mobile-render code. |
| `chapterContent` | `Record<string, ChapterContent>` | Keyed by `TocEntry.id`. Every TOC entry has a matching key. |
| `savedAt` | `number` | Milliseconds since epoch when the parse finished. |

## `TocEntry`

```json
{ "id": "ch_01", "title": "Verhaftung", "href": "ch_01", "level": 0 }
```

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Stable slug — `"ch1"`, `"prologue"`, `"epilogue"`. Unique across the TOC; collisions get a `_<index>` suffix. |
| `title` | `string` | Chapter title as it appears in the source (or `"Chapter N"` if untitled). |
| `href` | `string` | Always equal to `id`. Legacy field — the mobile reader uses it as the key into `chapterContent`. |
| `level` | `number` | `0` for top-level chapters, `1` for nested subsections. |

## `ChapterContent`

```json
{
  "title": "Verhaftung",
  "paragraphs": [
    [
      "Jemand musste Josef K. verleumdet haben.",
      "Eines Morgens wurde er verhaftet."
    ],
    [
      "Die Köchin der Frau Grubach kam nicht."
    ]
  ]
}
```

| Field | Type | Notes |
|---|---|---|
| `title` | `string` | Same as the corresponding `TocEntry.title`. Duplicated so a chapter object is self-contained. |
| `paragraphs` | `string[][]` | Outer array = paragraphs in source order. Inner array = sentences in that paragraph. **No tokenization, no translations** — just verbatim source-language text. The mobile reader tokenizes lazily and fetches per-sentence translations on demand via `POST /translate/sentence`. |

## Worked example (truncated)

```json
{
  "version": 2,
  "id": "1xkmcfo",
  "title": "Der Prozess",
  "author": "Franz Kafka",
  "description": "An ordinary bank clerk is arrested...",
  "genre": "Literary Fiction",
  "difficulty": "C1",
  "language": "de",
  "toc": [
    { "id": "ch_01", "title": "Verhaftung", "href": "ch_01", "level": 0 },
    { "id": "ch_02", "title": "Gespräch mit Frau Grubach", "href": "ch_02", "level": 0 }
  ],
  "spineHrefs": ["ch_01", "ch_02"],
  "chapterContent": {
    "ch_01": {
      "title": "Verhaftung",
      "paragraphs": [
        ["Jemand musste Josef K. verleumdet haben.", "Eines Morgens wurde er verhaftet."],
        ["Die Köchin der Frau Grubach kam nicht."]
      ]
    },
    "ch_02": {
      "title": "Gespräch mit Frau Grubach",
      "paragraphs": [
        ["..."]
      ]
    }
  },
  "savedAt": 1716480000000
}
```

## Related: library index

A single sidecar manifest at `s3://lenguas-parsed-books/parsed-books/_index.json` holds one summary entry per book, so the API can serve the library list in a single S3 GET:

```json
{
  "books": [
    {
      "contentHash": "86fb1a1176aa7acf38be01ffc9581e8e2b3c7340d14a2a0c459f87743c77e3c2",
      "title": "La rebelión de las masas",
      "author": "José Ortega y Gasset",
      "description": "A philosophical and sociological essay...",
      "genre": "Essays",
      "difficulty": "C2",
      "language": "es",
      "uploadedAt": 1779578544865
    }
  ]
}
```

`contentHash` is the SHA-256 of the source EPUB bytes. It's the canonical client-side identifier — `book.id` is only used as a React key, not as a lookup key.

## How files get here

1. `lenguas parse <some.epub> -l de` reads the EPUB, computes SHA-256, runs the LLM pipeline, writes the full `SerializedBook` to `s3://lenguas-parsed-books/parsed-books/<hash>.json` and upserts a summary into `_index.json`.
2. Mobile calls `GET /books?language=de`, gets the summary list (filtered server-side by language).
3. On book tap, mobile calls `GET /books/:hash`, downloads the full `SerializedBook`, and caches it locally at `<DocumentDirectoryPath>/readalong/book_<hash>.json`. Subsequent opens skip the network.

## Backwards compatibility

`version: 1` files (produced before the metadata expansion) lack `author`, `description`, `genre`, and `difficulty`. The mobile parser treats all four as optional, so v1 files still hydrate — they just render without those fields on screen. No v1 files exist in the current S3 library; this is documented only for completeness if old exports surface.
