//! `lenguas list` — print every book in the S3 library, grouped by language.

use anyhow::Result;

use crate::store::Store;

pub struct Args {
    pub language: Option<String>,
    pub json: bool,
}

pub async fn run(args: Args) -> Result<()> {
    let store = Store::from_env().await?;
    let mut books = store.read_index().await?;

    if let Some(lang) = &args.language {
        books.retain(|b| &b.language == lang);
    }

    if args.json {
        // Raw passthrough for piping into jq.
        println!("{}", serde_json::to_string_pretty(&books)?);
        return Ok(());
    }

    if books.is_empty() {
        println!("(no books)");
        return Ok(());
    }

    // Stable order: language, then title.
    books.sort_by(|a, b| a.language.cmp(&b.language).then_with(|| a.title.cmp(&b.title)));

    let mut current_lang = String::new();
    let mut lang_count = 0usize;
    let total = books.len();

    for book in &books {
        if book.language != current_lang {
            if !current_lang.is_empty() {
                println!();
            }
            let count = books.iter().filter(|b| b.language == book.language).count();
            println!("{} ({} book{})", book.language.to_uppercase(), count, if count == 1 { "" } else { "s" });
            current_lang = book.language.clone();
            lang_count += 1;
        }
        let author = book.author.as_deref().unwrap_or("Unknown author");
        let difficulty = book
            .difficulty
            .as_deref()
            .map(|d| format!(" [{d}]"))
            .unwrap_or_default();
        println!("  {} — {}{}", book.title, author, difficulty);
    }

    println!();
    println!("{total} book{} across {lang_count} language{}", if total == 1 { "" } else { "s" }, if lang_count == 1 { "" } else { "s" });

    Ok(())
}
