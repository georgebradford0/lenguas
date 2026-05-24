//! S3 access: content-hashed book storage + the shared _index.json manifest.
//!
//! Layout (must match api/v0/lib/bookStore.js):
//!   s3://$AWS_S3_BUCKET/parsed-books/<sha256>.json   per-book SerializedBook
//!   s3://$AWS_S3_BUCKET/parsed-books/_index.json     [{contentHash, title, …}]

use anyhow::{anyhow, Context, Result};
use aws_sdk_s3::operation::get_object::GetObjectError;
use aws_sdk_s3::operation::head_object::HeadObjectError;
use aws_sdk_s3::primitives::ByteStream;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const PREFIX: &str = "parsed-books";
const INDEX_KEY: &str = "parsed-books/_index.json";
const DEFAULT_BUCKET: &str = "lenguas-parsed-books";

pub struct Store {
    client: aws_sdk_s3::Client,
    bucket: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct LibrarySummary {
    #[serde(rename = "contentHash")]
    pub content_hash: String,
    pub title: String,
    pub author: Option<String>,
    pub description: Option<String>,
    pub genre: Option<String>,
    pub difficulty: Option<String>,
    pub language: String,
    #[serde(rename = "uploadedAt")]
    pub uploaded_at: i64,
}

#[derive(Serialize, Deserialize)]
struct IndexFile {
    books: Vec<LibrarySummary>,
}

impl Store {
    pub async fn from_env() -> Result<Self> {
        // AWS_S3_BUCKET overrides; otherwise we use the project's well-known bucket.
        let bucket = std::env::var("AWS_S3_BUCKET").unwrap_or_else(|_| DEFAULT_BUCKET.to_string());
        // The SDK's default credential chain handles env vars, ~/.aws/credentials,
        // SSO, and IMDS — no manual key loading needed.
        let config = aws_config::defaults(aws_config::BehaviorVersion::latest())
            .load()
            .await;
        let client = aws_sdk_s3::Client::new(&config);
        Ok(Self { client, bucket })
    }

    pub fn hash_bytes(bytes: &[u8]) -> String {
        let mut h = Sha256::new();
        h.update(bytes);
        hex::encode(h.finalize())
    }

    fn key_for(hash: &str) -> String {
        format!("{PREFIX}/{hash}.json")
    }

    pub async fn exists(&self, hash: &str) -> Result<bool> {
        match self
            .client
            .head_object()
            .bucket(&self.bucket)
            .key(Self::key_for(hash))
            .send()
            .await
        {
            Ok(_) => Ok(true),
            Err(err) => {
                if let Some(HeadObjectError::NotFound(_)) = err.as_service_error() {
                    return Ok(false);
                }
                Err(anyhow!(err))
            }
        }
    }

    /// Delete the per-book JSON object from S3. S3 returns 204 even for missing
    /// keys, so this is idempotent — calling on a non-existent hash is a no-op.
    pub async fn delete_book_json(&self, hash: &str) -> Result<()> {
        self.client
            .delete_object()
            .bucket(&self.bucket)
            .key(Self::key_for(hash))
            .send()
            .await
            .context("deleting book from S3")?;
        Ok(())
    }

    pub async fn put_book_json(&self, hash: &str, body: Vec<u8>) -> Result<()> {
        self.client
            .put_object()
            .bucket(&self.bucket)
            .key(Self::key_for(hash))
            .body(ByteStream::from(body))
            .content_type("application/json")
            .send()
            .await
            .context("uploading book to S3")?;
        Ok(())
    }

    pub async fn read_index(&self) -> Result<Vec<LibrarySummary>> {
        let res = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(INDEX_KEY)
            .send()
            .await;
        match res {
            Ok(out) => {
                let bytes = out.body.collect().await.context("draining index body")?.into_bytes();
                let parsed: IndexFile = serde_json::from_slice(&bytes).context("parsing _index.json")?;
                Ok(parsed.books)
            }
            Err(err) => {
                if let Some(GetObjectError::NoSuchKey(_)) = err.as_service_error() {
                    return Ok(vec![]);
                }
                Err(anyhow!(err))
            }
        }
    }

    pub async fn write_index(&self, books: &[LibrarySummary]) -> Result<()> {
        let body = serde_json::to_vec_pretty(&IndexFile { books: books.to_vec() })?;
        self.client
            .put_object()
            .bucket(&self.bucket)
            .key(INDEX_KEY)
            .body(ByteStream::from(body))
            .content_type("application/json")
            .send()
            .await
            .context("writing _index.json")?;
        Ok(())
    }
}
