//! `lenguas delete <id>` — remove a book from S3 + the library index.
//!
//! The identifier can be a full SHA-256, a content-hash prefix (8+ hex chars),
//! or a case-insensitive title substring. If the identifier resolves to more
//! than one book, the command prints all matches and exits without deleting.

use anyhow::{bail, Result};
use std::io::{self, BufRead, Write};

use crate::store::{LibrarySummary, Store};

pub struct Args {
    pub identifier: String,
    pub yes: bool,
}

pub async fn run(args: Args) -> Result<()> {
    let store = Store::from_env().await?;
    let mut index = store.read_index().await?;

    let matches: Vec<usize> = find_matches(&index, &args.identifier);

    if matches.is_empty() {
        bail!("no book matches \"{}\"", args.identifier);
    }
    if matches.len() > 1 {
        eprintln!("ambiguous — \"{}\" matches multiple books:", args.identifier);
        for &i in &matches {
            let b = &index[i];
            let short = &b.content_hash[..8.min(b.content_hash.len())];
            let author = b.author.as_deref().unwrap_or("Unknown author");
            eprintln!("  [{}] {} — {} ({})", short, b.title, author, b.language);
        }
        bail!("disambiguate with a full hash or a longer title substring");
    }

    let idx = matches[0];
    let target = index[idx].clone();
    let short = &target.content_hash[..8.min(target.content_hash.len())];
    let author = target.author.as_deref().unwrap_or("Unknown author");

    if !args.yes {
        print!("delete \"{}\" by {} [{}] [{}] ? [y/N] ", target.title, author, target.language, short);
        io::stdout().flush().ok();
        let mut buf = String::new();
        io::stdin().lock().read_line(&mut buf)?;
        if !matches!(buf.trim().to_lowercase().as_str(), "y" | "yes") {
            println!("aborted");
            return Ok(());
        }
    }

    print!("  deleting from S3… ");
    io::stdout().flush().ok();
    store.delete_book_json(&target.content_hash).await?;
    println!("done");

    print!("  updating library index… ");
    io::stdout().flush().ok();
    index.remove(idx);
    store.write_index(&index).await?;
    println!("done");

    println!("✓ deleted \"{}\"", target.title);
    Ok(())
}

/// Returns the indices into `index` of every book that the identifier resolves
/// to. A full or prefix hex match takes precedence over title-substring match —
/// if `id` is plausibly a hash and matches one or more books by hash, those
/// matches are returned; otherwise we fall back to title substring matching.
fn find_matches(index: &[LibrarySummary], id: &str) -> Vec<usize> {
    let id_lower = id.to_lowercase();

    // Hash-style identifier: 8+ hex chars.
    let looks_like_hash = id.len() >= 8 && id.chars().all(|c| c.is_ascii_hexdigit());
    if looks_like_hash {
        let hash_matches: Vec<usize> = index
            .iter()
            .enumerate()
            .filter(|(_, b)| b.content_hash.starts_with(&id_lower))
            .map(|(i, _)| i)
            .collect();
        if !hash_matches.is_empty() {
            return hash_matches;
        }
    }

    // Fall back to case-insensitive title substring.
    index
        .iter()
        .enumerate()
        .filter(|(_, b)| b.title.to_lowercase().contains(&id_lower))
        .map(|(i, _)| i)
        .collect()
}

