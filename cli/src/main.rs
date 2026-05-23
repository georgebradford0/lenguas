mod epub;
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
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Parse { epub, language, title, force } => {
            parse::run(parse::Args { epub, language, title, force }).await
        }
    }
}
