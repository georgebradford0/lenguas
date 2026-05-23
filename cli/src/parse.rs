//! `lenguas parse <epub>` — extract, run the LLM pipeline, upload to S3.

use anyhow::{anyhow, bail, Context, Result};
use futures::stream::{FuturesUnordered, StreamExt};
use indicatif::{ProgressBar, ProgressStyle};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::Instant;

use crate::epub;
use crate::openai::{
    self, ChapterContent, Client as OpenAI, SerializedBook, TocEntry,
};
use crate::store::{LibrarySummary, Store};

pub struct Args {
    pub epub: PathBuf,
    pub language: String,
    pub title: Option<String>,
    pub force: bool,
}

const BATCH_SIZE: usize = 15;
const MODEL: &str = "gpt-4.1-mini";

fn language_name(code: &str) -> Option<&'static str> {
    match code {
        "de" => Some("German"),
        "nl" => Some("Dutch"),
        "fr" => Some("French"),
        "es" => Some("Spanish"),
        _ => None,
    }
}

pub async fn run(args: Args) -> Result<()> {
    let from_language = language_name(&args.language)
        .ok_or_else(|| anyhow!("--language must be one of: de, nl, fr, es"))?;

    let openai_key = std::env::var("OPENAI_API_KEY")
        .map_err(|_| anyhow!("OPENAI_API_KEY is not set — `export OPENAI_API_KEY=…` in your shell"))?;

    // Read the EPUB and hash it.
    let bytes = std::fs::read(&args.epub)
        .with_context(|| format!("reading {}", args.epub.display()))?;
    let content_hash = Store::hash_bytes(&bytes);
    let filename = args.epub.file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "book.epub".to_string());

    println!("→ {} ({:.2} MB)", filename, bytes.len() as f64 / 1024.0 / 1024.0);
    println!("  hash: {content_hash}");
    println!("  language: {}", args.language);

    let store = Store::from_env().await?;

    if !args.force && store.exists(&content_hash).await? {
        println!("✓ already in S3 — skipping. Pass --force to re-parse.");
        return Ok(());
    }

    // Extract text + OPF metadata.
    print!("  extracting text… ");
    use std::io::Write;
    std::io::stdout().flush().ok();
    let extracted = epub::extract(&bytes)?;
    println!("done ({} chars)", extracted.full_text.len());

    let hint_title = args
        .title
        .clone()
        .or_else(|| {
            let stem = args.epub.file_stem()?.to_string_lossy().into_owned();
            (!stem.is_empty()).then_some(stem)
        })
        .unwrap_or_else(|| extracted.title.clone());
    let hint_author = extracted.author.clone();

    // Build the cached prefix: system + book message. Reused for every call.
    let system = openai::system_prompt(from_language);
    let book_msg = openai::book_message(
        from_language,
        &hint_title,
        hint_author.as_deref(),
        &extracted.full_text,
    );

    let openai_client = OpenAI::new(openai_key);

    // Phase 2: TOC + metadata.
    print!("  identifying chapters + metadata… ");
    std::io::stdout().flush().ok();
    let toc_started = Instant::now();
    let toc_json = openai_client
        .chat_json(
            MODEL,
            &[
                json!({ "role": "system", "content": system }),
                json!({ "role": "user", "content": book_msg }),
                json!({ "role": "user", "content": openai::toc_prompt(from_language) }),
            ],
            0.0,
            4096,
        )
        .await?;
    println!("done in {:.1}s", toc_started.elapsed().as_secs_f64());

    let book_title = trim_string(&toc_json, "title").unwrap_or(hint_title.clone());
    let book_author = trim_string(&toc_json, "author").or(hint_author);
    let description = trim_string(&toc_json, "description");
    let genre = trim_string(&toc_json, "genre");
    let difficulty = trim_string(&toc_json, "difficulty")
        .map(|s| s.to_uppercase())
        .filter(|s| matches!(s.as_str(), "A1" | "A2" | "B1" | "B2" | "C1" | "C2"));

    let toc = parse_toc(&toc_json)?;
    if toc.is_empty() {
        bail!("Could not identify any chapters in this book");
    }
    println!(
        "  resolved: \"{}\"{}{} — {} sections",
        book_title,
        book_author.as_deref().map(|a| format!(" by {a}")).unwrap_or_default(),
        difficulty.as_deref().map(|d| format!(" [{d}]")).unwrap_or_default(),
        toc.len(),
    );

    // Phase 3: reproduce each section, batched in groups of 15 parallel calls.
    let toc_summary = serde_json::to_string(&json!({ "toc": &toc }))?;
    let bar = ProgressBar::new(toc.len() as u64);
    bar.set_style(
        ProgressStyle::with_template("  reproducing sections [{bar:30}] {pos}/{len} {elapsed_precise}")
            .unwrap()
            .progress_chars("=>-"),
    );

    let mut chapters: BTreeMap<String, ChapterContent> = BTreeMap::new();

    for batch in toc.chunks(BATCH_SIZE) {
        let mut tasks = FuturesUnordered::new();
        for entry in batch {
            let client = openai_client.clone();
            let system = system.clone();
            let book_msg = book_msg.clone();
            let prompt = openai::section_prompt(
                from_language,
                &toc_summary,
                &entry.id,
                &entry.title,
            );
            let entry = entry.clone();
            tasks.push(async move {
                let result = client
                    .chat_json(
                        MODEL,
                        &[
                            json!({ "role": "system", "content": system }),
                            json!({ "role": "user", "content": book_msg }),
                            json!({ "role": "user", "content": prompt }),
                        ],
                        0.0,
                        16_384,
                    )
                    .await;
                (entry, result)
            });
        }
        while let Some((entry, result)) = tasks.next().await {
            let paragraphs = match result {
                Ok(json) => extract_paragraphs(&json),
                Err(err) => {
                    eprintln!("\n  ! section \"{}\" failed: {err}", entry.id);
                    Vec::new()
                }
            };
            chapters.insert(
                entry.id.clone(),
                ChapterContent { title: entry.title.clone(), paragraphs },
            );
            bar.inc(1);
        }
    }
    bar.finish_and_clear();
    println!("  done reproducing {} sections", toc.len());

    // Phase 4: assemble + upload.
    let saved_at = chrono_now_millis();
    let book = SerializedBook {
        version: 2,
        id: compute_book_id(&book_title, &toc, saved_at),
        title: book_title.clone(),
        author: book_author.clone(),
        description: description.clone(),
        genre: genre.clone(),
        difficulty: difficulty.clone(),
        language: args.language.clone(),
        toc: toc.clone(),
        spine_hrefs: toc.iter().map(|t| t.id.clone()).collect(),
        chapter_content: chapters,
        saved_at,
    };

    print!("  uploading to S3… ");
    std::io::stdout().flush().ok();
    let body = serde_json::to_vec(&book)?;
    store.put_book_json(&content_hash, body).await?;
    println!("done");

    print!("  updating library index… ");
    std::io::stdout().flush().ok();
    let mut index = store.read_index().await?;
    let summary = LibrarySummary {
        content_hash: content_hash.clone(),
        title: book_title,
        author: book_author,
        description,
        genre,
        difficulty,
        language: args.language.clone(),
        uploaded_at: saved_at,
    };
    if let Some(existing) = index.iter_mut().find(|e| e.content_hash == content_hash) {
        *existing = summary;
    } else {
        index.push(summary);
    }
    store.write_index(&index).await?;
    let count = index.iter().filter(|e| e.language == args.language).count();
    println!("done");

    println!("✓ added to the {} library ({count} total)", args.language.to_uppercase());
    Ok(())
}

fn trim_string(v: &Value, key: &str) -> Option<String> {
    let s = v.get(key)?.as_str()?.trim();
    (!s.is_empty()).then(|| s.to_string())
}

fn parse_toc(v: &Value) -> Result<Vec<TocEntry>> {
    let arr = v
        .get("toc")
        .and_then(|t| t.as_array())
        .ok_or_else(|| anyhow!("LLM response missing `toc` array"))?;
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for (i, raw) in arr.iter().enumerate() {
        let id_str = raw.get("id").and_then(|x| x.as_str()).map(str::trim);
        let title_str = raw.get("title").and_then(|x| x.as_str()).map(str::trim);
        let (Some(id_str), Some(title_str)) = (id_str, title_str) else { continue };
        if title_str.is_empty() {
            continue;
        }
        let mut id = if id_str.is_empty() { format!("ch{}", i + 1) } else { id_str.to_string() };
        if !seen.insert(id.clone()) {
            id = format!("{id}_{}", i + 1);
            seen.insert(id.clone());
        }
        let level = raw.get("level").and_then(|x| x.as_u64()).unwrap_or(0) as u32;
        out.push(TocEntry {
            id: id.clone(),
            title: title_str.to_string(),
            href: id,
            level,
        });
    }
    Ok(out)
}

fn extract_paragraphs(v: &Value) -> Vec<Vec<String>> {
    let Some(arr) = v.get("paragraphs").and_then(|p| p.as_array()) else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|p| {
            let inner = p.as_array()?;
            if inner.is_empty() {
                return None;
            }
            let mut sentences = Vec::with_capacity(inner.len());
            for s in inner {
                let s = s.as_str()?;
                sentences.push(s.to_string());
            }
            Some(sentences)
        })
        .collect()
}

/// djb2-style hash matching api/v0/lib/parseEpub.js's computeBookId. The id
/// only needs to be stable per parse; using Date.now() in the input makes it
/// monotonic across re-parses, which matches the JS behavior.
fn compute_book_id(title: &str, toc: &[TocEntry], now_millis: i64) -> String {
    let s = format!(
        "{title}|{}|{}",
        toc.iter().map(|t| t.id.as_str()).collect::<Vec<_>>().join(","),
        now_millis,
    );
    let mut h: i32 = 5381;
    for c in s.chars() {
        // ((h << 5) + h + c) | 0  — JS 32-bit wrap-around
        h = h.wrapping_shl(5).wrapping_add(h).wrapping_add(c as i32);
    }
    let mut n = h as u32 as u64;
    let chars: Vec<char> = "0123456789abcdefghijklmnopqrstuvwxyz".chars().collect();
    if n == 0 {
        return "0".to_string();
    }
    let mut out = String::new();
    while n > 0 {
        out.push(chars[(n % 36) as usize]);
        n /= 36;
    }
    out.chars().rev().collect()
}

fn chrono_now_millis() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
