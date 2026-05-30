//! Minimal chat-completions client + the two prompts the parse pipeline uses
//! (TOC + metadata, and per-section content reproduction). The bookMessage
//! prefix is passed identically across all calls so OpenAI's prompt cache hits.

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const ENDPOINT: &str = "https://api.openai.com/v1/chat/completions";

#[derive(Clone)]
pub struct Client {
    http: reqwest::Client,
    api_key: String,
}

impl Client {
    pub fn new(api_key: String) -> Self {
        Self {
            http: reqwest::Client::builder()
                .pool_idle_timeout(std::time::Duration::from_secs(30))
                .build()
                .expect("reqwest client"),
            api_key,
        }
    }

    pub async fn chat_json(
        &self,
        model: &str,
        messages: &[Value],
        temperature: f32,
        max_tokens: u32,
    ) -> Result<Value> {
        // Retry policy: up to MAX_ATTEMPTS total. Retry on 429, 5xx, and
        // network/transport errors. On 429, honor the server's Retry-After
        // header when present (capped so we don't sleep forever); otherwise
        // exponential backoff (1, 2, 4, 8, 16, 30s, capped at MAX_DELAY_MS).
        const MAX_ATTEMPTS: u32 = 6;
        const MIN_DELAY_MS: u64 = 1_000;
        const MAX_DELAY_MS: u64 = 30_000;
        const MAX_RETRY_AFTER_MS: u64 = 120_000;

        let body = json!({
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "response_format": { "type": "json_object" },
        });

        for attempt in 1..=MAX_ATTEMPTS {
            let send_result = self
                .http
                .post(ENDPOINT)
                .bearer_auth(&self.api_key)
                .json(&body)
                .send()
                .await;

            let (delay_ms, reason) = match send_result {
                Ok(res) if res.status().is_success() => {
                    let parsed: ChatResponse =
                        res.json().await.context("decoding OpenAI response")?;
                    let content = parsed
                        .choices
                        .into_iter()
                        .next()
                        .ok_or_else(|| anyhow!("no choices returned"))?
                        .message
                        .content;
                    return serde_json::from_str(&content).context("LLM returned invalid JSON");
                }
                Ok(res) => {
                    let status = res.status();
                    let retry_after_ms = parse_retry_after(res.headers().get("retry-after"))
                        .map(|ms| ms.min(MAX_RETRY_AFTER_MS));
                    let retryable = status.as_u16() == 429 || status.is_server_error();
                    let text = res.text().await.unwrap_or_default();
                    if !retryable {
                        // Non-retryable HTTP error (4xx other than 429) — fail immediately.
                        return Err(anyhow!(
                            "OpenAI {status}: {}",
                            text.chars().take(400).collect::<String>()
                        ));
                    }
                    let delay = retry_after_ms.unwrap_or_else(|| backoff_ms(attempt, MIN_DELAY_MS, MAX_DELAY_MS));
                    let trimmed = text.chars().take(120).collect::<String>();
                    let detail = if trimmed.is_empty() { String::new() } else { format!(" — {trimmed}") };
                    let hint = if retry_after_ms.is_some() { " (Retry-After)" } else { "" };
                    (delay, format!("HTTP {status}{hint}{detail}"))
                }
                Err(err) => {
                    // Network / transport error (DNS, timeout, connection reset). Retry.
                    let delay = backoff_ms(attempt, MIN_DELAY_MS, MAX_DELAY_MS);
                    (delay, format!("network: {err}"))
                }
            };

            if attempt >= MAX_ATTEMPTS {
                return Err(anyhow!(
                    "OpenAI failed after {MAX_ATTEMPTS} attempts: {reason}"
                ));
            }
            // Surface the retry so a multi-second backoff doesn't look like a hang.
            eprintln!(
                "  ↻ openai retry {}/{} in {:.1}s: {}",
                attempt + 1,
                MAX_ATTEMPTS,
                delay_ms as f64 / 1000.0,
                reason,
            );
            tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
        }

        // Unreachable: the loop either returns Ok, bails on non-retryable, or
        // bails on attempt == MAX_ATTEMPTS above.
        unreachable!()
    }
}

fn backoff_ms(attempt: u32, min: u64, max: u64) -> u64 {
    // attempt 1 → min, attempt 2 → 2*min, attempt 3 → 4*min, ... capped at max.
    let shifted = min.checked_shl(attempt.saturating_sub(1)).unwrap_or(max);
    shifted.min(max)
}

fn parse_retry_after(header: Option<&reqwest::header::HeaderValue>) -> Option<u64> {
    let value = header?.to_str().ok()?;
    let secs: f64 = value.trim().parse().ok()?;
    if !secs.is_finite() || secs < 0.0 {
        return None;
    }
    Some((secs * 1000.0) as u64)
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
}
#[derive(Deserialize)]
struct Choice {
    message: ChatMessage,
}
#[derive(Deserialize)]
struct ChatMessage {
    content: String,
}

// ── Prompts ────────────────────────────────────────────────────────────────

pub fn system_prompt(from_language: &str) -> String {
    format!(
        "You are processing a {from_language} EPUB book to prepare it for sentence-by-sentence language learning reading.

CRITICAL RULES:
- NEVER translate, paraphrase, summarize, or correct the text. Reproduce {from_language} text VERBATIM.
- Apply only these structural cleanups:
  * Remove page numbers, running headers, footers, and navigation cruft
  * Merge mid-paragraph line breaks (common in EPUBs converted from PDFs or older scans)
  * Split text into proper sentences (handle abbreviations like \"Dr.\", \"Mr.\", \"z.B.\", \"St.\", month and weekday abbreviations, etc.)
  * Skip front matter (copyright pages, publisher info, dedications, contents listings)
  * Skip back matter (about the author, advertisements, indexes) unless explicitly requested
- Output VALID JSON only. No prose explanations outside the JSON."
    )
}

pub fn book_message(from_language: &str, hint_title: &str, hint_author: Option<&str>, full_text: &str) -> String {
    let by = hint_author.map(|a| format!(" by {a}")).unwrap_or_default();
    format!("Here is the full text of the {from_language} book \"{hint_title}\"{by}:\n\n{full_text}")
}

pub fn toc_prompt(from_language: &str) -> String {
    format!(
        "Identify the book's metadata and its table of contents. Output JSON with this exact shape:

{{
  \"title\": \"<clean, library-display-quality book title>\",
  \"author\": \"<author name in 'First Last' form, or null if unknown>\",
  \"description\": \"<1-2 sentence neutral summary of the book>\",
  \"genre\": \"<short genre label>\",
  \"difficulty\": \"<CEFR level: A1 | A2 | B1 | B2 | C1 | C2>\",
  \"toc\": [
    {{ \"id\": \"ch1\", \"title\": \"Chapter title as it appears\", \"level\": 0, \"startAnchor\": \"first ~10 words of this section's body, verbatim\" }}
  ]
}}

Rules for \"title\":
- Use the title as it would appear on the cover or in a library catalog.
- Drop file-naming cruft (underscores, version numbers, \"v1.0\", \"_unabridged\"), edition tags like \"(Unabridged)\" or \"[Annotated]\", author names appended to the title, and series volume formatting like \"- Book 2 of N\".
- Preserve original-language spelling and diacritics. Use proper capitalization for the source language (e.g. German nouns capitalized; French/Spanish sentence case).
- If a subtitle is present and short, include it after a colon. Drop long marketing subtitles.

Rules for \"author\":
- Use the author's commonly-known display name in \"First Last\" order (e.g. \"Franz Kafka\", not \"Kafka, Franz\").
- If multiple authors, join with \" & \" (e.g. \"Jorge Luis Borges & Adolfo Bioy Casares\").
- Translators, editors, and illustrators do NOT count — author only.
- If no author can be identified with reasonable confidence, output null. Do NOT guess from training-data memory if the text itself gives no signal.

Rules for \"description\":
- 1-2 sentences, neutral and factual. Avoid marketing language (\"a thrilling tale...\", \"you won't put it down...\").
- Written in English regardless of the source language.
- Focus on what the book is about, not why someone should read it.

Rules for \"genre\":
- Short label, ideally 1-3 words: \"Literary Fiction\", \"Mystery\", \"Memoir\", \"Children's\", \"Short Stories\", \"Essays\", \"Historical Fiction\", \"Science Fiction\", \"Poetry\", etc.
- Pick the single best fit, not a list.

Rules for \"difficulty\":
- Estimate the CEFR reading-comprehension level required for a learner of {from_language}.
- Base it on vocabulary range, sentence complexity, idiomatic density, and assumed cultural knowledge — not book length.
- Children's books are typically A2-B1; literary fiction is typically B2-C1; technical/archaic prose is typically C1-C2.
- Must be exactly one of: A1, A2, B1, B2, C1, C2.

Rules for \"toc\":
- One entry per chapter or major reading section.
- \"id\" is a short slug like \"ch1\", \"prologue\", \"ch_2\", \"epilogue\". Must be unique across the TOC.
- \"title\" is the chapter title as it appears in the source. If a chapter has no explicit title, generate a brief one like \"Chapter 1\".
- \"level\" is 0 for top-level chapters, 1 for nested subsections (rarely needed).
- Skip front matter (copyright, publisher info, dedications, contents page).
- Skip back matter (about the author, advertisements, indexes).
- If the source has no clear chapter breaks, divide into reading units of ~2000-5000 words each.
- \"startAnchor\" is the first 8-12 words of the section's BODY text — the prose where the section actually begins, NOT the title — copied VERBATIM from the source above, with exact spelling, accents, capitalization, and punctuation, so it can be located by an exact string search. Never translate, paraphrase, shorten, or invent it. It must be a contiguous substring that appears in the text above."
    )
}

pub fn window_prompt(from_language: &str, window_text: &str) -> String {
    format!(
        "Reproduce the following excerpt of a {from_language} book as clean, sentence-split JSON. Output JSON with this exact shape:

{{
  \"paragraphs\": [
    [\"First sentence.\", \"Second sentence.\"],
    [\"Single sentence paragraph.\"]
  ]
}}

Rules:
- Each line of the excerpt is one source paragraph. Preserve paragraph boundaries (one inner array per paragraph).
- Each string is one {from_language} sentence. Split each paragraph into sentences (handle abbreviations like \"Dr.\", \"M.\", \"z.B.\", \"St.\", etc.).
- Preserve the text VERBATIM — no translation, paraphrasing, summarizing, or correcting.
- Apply only the structural cleanups from the system prompt (drop page numbers, running headers/footers, and navigation cruft; merge any mid-paragraph line breaks).
- Do NOT add, omit, or reorder content, and do NOT include anything outside this excerpt. Reproduce exactly what is given.
- If the excerpt has no readable content, output {{ \"paragraphs\": [] }}.

Excerpt:
{window_text}"
    )
}

// ── Serializable book shapes ────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct TocEntry {
    pub id: String,
    pub title: String,
    pub href: String,
    pub level: u32,
}

#[derive(Serialize)]
pub struct ChapterContent {
    pub title: String,
    pub paragraphs: Vec<Vec<String>>,
}

#[derive(Serialize)]
pub struct SerializedBook {
    pub version: u32,
    pub id: String,
    pub title: String,
    pub author: Option<String>,
    pub description: Option<String>,
    pub genre: Option<String>,
    pub difficulty: Option<String>,
    pub language: String,
    pub toc: Vec<TocEntry>,
    #[serde(rename = "spineHrefs")]
    pub spine_hrefs: Vec<String>,
    #[serde(rename = "chapterContent")]
    pub chapter_content: std::collections::BTreeMap<String, ChapterContent>,
    #[serde(rename = "savedAt")]
    pub saved_at: i64,
}
