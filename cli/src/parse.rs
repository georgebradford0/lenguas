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
/// Target size, in characters, of each source window handed to one reproduction
/// call. ~22k chars of French is roughly ~6-7k output tokens — comfortably under
/// the model's completion cap, with headroom for JSON overhead.
const WINDOW_CHARS: usize = 22_000;

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
            8192,
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

    let (toc, anchors) = parse_toc(&toc_json)?;
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

    // Phase 3: locate each section in the source via its verbatim startAnchor,
    // slice the text into bounded windows on paragraph boundaries, and reproduce
    // each window in parallel. This keeps every completion well under the output
    // token cap and avoids re-sending the whole book on every call.
    let full_text = &extracted.full_text;
    let mut cursor = 0usize;
    let mut starts: Vec<Option<usize>> = Vec::with_capacity(toc.len());
    for anchor in &anchors {
        match anchor.as_deref().and_then(|a| find_anchor(full_text, a, cursor)) {
            Some((start, len)) => {
                starts.push(Some(start));
                cursor = start + len;
            }
            None => starts.push(None),
        }
    }

    let unresolved = starts.iter().filter(|s| s.is_none()).count();
    if unresolved > 0 {
        eprintln!(
            "  ! {unresolved}/{} section anchor(s) not found in the source — those chapters may come out empty or merged into the previous section.",
            toc.len()
        );
    }

    // Flatten every section into a list of window jobs, each tagged with its
    // section index and order so we can reassemble afterwards. A section's text
    // runs from its anchor up to the next *resolved* anchor (or end of book).
    struct WinJob {
        sec: usize,
        ord: usize,
        text: String,
    }
    let mut jobs: Vec<WinJob> = Vec::new();
    for i in 0..toc.len() {
        let Some(s) = starts[i] else { continue };
        let e = starts[i + 1..]
            .iter()
            .flatten()
            .next()
            .copied()
            .unwrap_or(full_text.len());
        if e <= s {
            continue;
        }
        for (ord, text) in split_into_windows(&full_text[s..e], WINDOW_CHARS)
            .into_iter()
            .enumerate()
        {
            jobs.push(WinJob { sec: i, ord, text });
        }
    }

    let total_windows = jobs.len();
    let bar = ProgressBar::new(total_windows as u64);
    bar.set_style(
        ProgressStyle::with_template("  reproducing windows [{bar:30}] {pos}/{len} {elapsed_precise}")
            .unwrap()
            .progress_chars("=>-"),
    );

    // sec index -> (window order -> paragraphs), so sections reassemble in order.
    let mut sec_windows: BTreeMap<usize, BTreeMap<usize, Vec<Vec<String>>>> = BTreeMap::new();

    for batch in jobs.chunks(BATCH_SIZE) {
        let mut tasks = FuturesUnordered::new();
        for job in batch {
            let client = openai_client.clone();
            let system = system.clone();
            let prompt = openai::window_prompt(from_language, &job.text);
            let sec = job.sec;
            let ord = job.ord;
            tasks.push(async move {
                let result = client
                    .chat_json(
                        MODEL,
                        &[
                            json!({ "role": "system", "content": system }),
                            json!({ "role": "user", "content": prompt }),
                        ],
                        0.0,
                        16_384,
                    )
                    .await;
                (sec, ord, result)
            });
        }
        while let Some((sec, ord, result)) = tasks.next().await {
            let paragraphs = match result {
                Ok(json) => extract_paragraphs(&json),
                Err(err) => {
                    eprintln!("\n  ! section \"{}\" window {ord} failed: {err}", toc[sec].id);
                    Vec::new()
                }
            };
            sec_windows.entry(sec).or_default().insert(ord, paragraphs);
            bar.inc(1);
        }
    }
    bar.finish_and_clear();
    println!("  done reproducing {total_windows} windows across {} sections", toc.len());

    // Assemble each section's paragraphs by concatenating its windows in order.
    let mut chapters: BTreeMap<String, ChapterContent> = BTreeMap::new();
    for (i, entry) in toc.iter().enumerate() {
        let mut paragraphs: Vec<Vec<String>> = Vec::new();
        if let Some(windows) = sec_windows.get(&i) {
            for paras in windows.values() {
                paragraphs.extend(paras.iter().cloned());
            }
        }
        chapters.insert(
            entry.id.clone(),
            ChapterContent { title: entry.title.clone(), paragraphs },
        );
    }

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

/// Returns the cleaned TOC plus a parallel vector of per-entry `startAnchor`
/// strings (aligned by index; `None` when the model omitted one).
fn parse_toc(v: &Value) -> Result<(Vec<TocEntry>, Vec<Option<String>>)> {
    let arr = v
        .get("toc")
        .and_then(|t| t.as_array())
        .ok_or_else(|| anyhow!("LLM response missing `toc` array"))?;
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    let mut anchors = Vec::new();
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
        let anchor = raw
            .get("startAnchor")
            .and_then(|x| x.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(String::from);
        out.push(TocEntry {
            id: id.clone(),
            title: title_str.to_string(),
            href: id,
            level,
        });
        anchors.push(anchor);
    }
    Ok((out, anchors))
}

/// Locate `anchor` in `hay` at or after byte offset `from`, returning the match's
/// start offset and byte length. Falls back to the first ~6 words if the full
/// anchor isn't found verbatim (e.g. the model drifted on the tail end).
fn find_anchor(hay: &str, anchor: &str, from: usize) -> Option<(usize, usize)> {
    let a = anchor.trim();
    if a.chars().count() < 4 {
        return None;
    }
    let sub = &hay[from..];
    if let Some(p) = sub.find(a) {
        return Some((from + p, a.len()));
    }
    let short: String = a.split_whitespace().take(6).collect::<Vec<_>>().join(" ");
    if short.chars().count() >= 8 {
        if let Some(p) = sub.find(&short) {
            return Some((from + p, short.len()));
        }
    }
    None
}

/// Split text into windows of whole lines (paragraphs), each up to ~`target_chars`
/// characters. Because `epub::extract` emits one block element per line, splitting
/// on '\n' never cuts a sentence. A single paragraph longer than the target becomes
/// its own oversized window — unavoidable without splitting mid-paragraph.
fn split_into_windows(text: &str, target_chars: usize) -> Vec<String> {
    let mut windows = Vec::new();
    let mut cur = String::new();
    let mut cur_chars = 0usize;
    for raw_line in text.split('\n') {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }
        let line_chars = line.chars().count();
        if cur_chars > 0 && cur_chars + 1 + line_chars > target_chars {
            windows.push(std::mem::take(&mut cur));
            cur_chars = 0;
        }
        if !cur.is_empty() {
            cur.push('\n');
            cur_chars += 1;
        }
        cur.push_str(line);
        cur_chars += line_chars;
    }
    if !cur.is_empty() {
        windows.push(cur);
    }
    windows
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn find_anchor_locates_and_advances() {
        let hay = "Avant-propos inutile.\nLe désir produit le réel.\nSuite du texte.\nDeuxième partie commence ici.";
        let (s, len) = find_anchor(hay, "Le désir produit", 0).unwrap();
        assert_eq!(&hay[s..s + len], "Le désir produit");
        // Searching from just past the first match still finds a later anchor.
        let (s2, _) = find_anchor(hay, "Deuxième partie commence", s + len).unwrap();
        assert!(s2 > s);
        // A phrase that isn't present resolves to None.
        assert!(find_anchor(hay, "absent phrase xyz", 0).is_none());
    }

    #[test]
    fn find_anchor_short_fallback() {
        let hay = "Le chat noir dort sur le tapis rouge ce soir.";
        // The full anchor drifts at the tail, but the first 6 words still match.
        let (s, len) = find_anchor(hay, "Le chat noir dort sur le DRIFTED words", 0).unwrap();
        assert_eq!(&hay[s..s + len], "Le chat noir dort sur le");
    }

    #[test]
    fn windows_keep_whole_lines_and_lose_nothing() {
        let text = "alpha\nbeta\ngamma\ndelta\nepsilon";
        let w = split_into_windows(text, 12);
        assert!(w.len() > 1, "small target should produce multiple windows");
        // Every window is composed only of intact original lines.
        for win in &w {
            for line in win.split('\n') {
                assert!(["alpha", "beta", "gamma", "delta", "epsilon"].contains(&line));
            }
        }
        // Concatenating windows reproduces every line in order — nothing dropped.
        let flat: Vec<&str> = w.iter().flat_map(|s| s.split('\n')).collect();
        assert_eq!(flat, vec!["alpha", "beta", "gamma", "delta", "epsilon"]);
    }

    #[test]
    fn oversized_paragraph_becomes_its_own_window() {
        let big = "x".repeat(50);
        let text = format!("short\n{big}\nshort2");
        let w = split_into_windows(&text, 20);
        assert!(w.iter().any(|win| win == &big));
    }
}
