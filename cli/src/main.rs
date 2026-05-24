mod delete;
mod epub;
mod list;
mod openai;
mod parse;
mod store;

use anyhow::Result;
use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser)]
#[command(
    name = "lenguas",
    version,
    about = "Offline tooling for the Lenguas reading app",
    propagate_version = true,
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Parse an EPUB with gpt-4.1-mini and upload the result to S3.
    /// Uses a TOC call followed by N parallel section calls with the full
    /// book in the cached prompt prefix — verbatim text reproduction.
    Parse {
        /// Path to the .epub file.
        epub: PathBuf,

        /// Target language code (de, nl, fr, es).
        #[arg(short, long)]
        language: String,

        /// Override the hint title (defaults to filename).
        #[arg(short, long)]
        title: Option<String>,

        /// Re-parse even if the same content hash is already in S3.
        #[arg(short, long)]
        force: bool,
    },

    /// List every book in the S3 library, grouped by language.
    List {
        /// Only show books for one language code (de, nl, fr, es).
        #[arg(short, long)]
        language: Option<String>,

        /// Emit raw JSON instead of the grouped human-readable view.
        #[arg(long)]
        json: bool,
    },

    /// Delete a book from S3 + the library index.
    /// Identifier can be a full SHA-256, an 8+ char hash prefix, or a
    /// case-insensitive substring of the title.
    Delete {
        /// Book identifier (hash, hash prefix, or title substring).
        identifier: String,

        /// Skip the y/N prompt.
        #[arg(short, long)]
        yes: bool,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Parse { epub, language, title, force } => {
            parse::run(parse::Args { epub, language, title, force }).await
        }
        Command::List { language, json } => {
            list::run(list::Args { language, json }).await
        }
        Command::Delete { identifier, yes } => {
            delete::run(delete::Args { identifier, yes }).await
        }
    }
}
