//! EPUB → plain text + OPF metadata. Same behavior as api/v0/lib/parseEpub.js:
//! - unzip the package
//! - find the OPF via META-INF/container.xml, pull <dc:title> + <dc:creator>
//! - walk every .xhtml/.html, render to plain text with newlines at block boundaries

use anyhow::{anyhow, Context, Result};
use regex::Regex;
use scraper::{Html, Node, Selector};
use std::io::Read;

const BLOCK_TAGS: &[&str] = &[
    "p", "div", "h1", "h2", "h3", "h4", "h5", "h6",
    "li", "blockquote", "pre", "tr", "br", "hr",
    "section", "article", "aside", "header", "footer",
];

pub struct Extracted {
    pub title: String,
    pub author: Option<String>,
    pub full_text: String,
}

pub fn extract(epub_bytes: &[u8]) -> Result<Extracted> {
    let reader = std::io::Cursor::new(epub_bytes);
    let mut zip = zip::ZipArchive::new(reader).context("not a valid zip / EPUB")?;

    // Find the OPF path via META-INF/container.xml.
    let mut opf_path: Option<String> = None;
    if let Some(container) = read_zip_string(&mut zip, "META-INF/container.xml")? {
        let re = Regex::new(r#"full-path="([^"]+)""#).unwrap();
        if let Some(caps) = re.captures(&container) {
            opf_path = Some(caps[1].to_string());
        }
    }

    let mut title = None;
    let mut author = None;
    if let Some(path) = &opf_path {
        if let Some(opf) = read_zip_string(&mut zip, path)? {
            title = extract_opf_title(&opf);
            author = extract_opf_author(&opf);
        }
    }

    // Concatenate every HTML/XHTML file's text in name order. The Node version
    // sorts by filename, which generally yields spine order for well-formed EPUBs.
    let mut html_names: Vec<String> = (0..zip.len())
        .filter_map(|i| {
            let name = zip.by_index(i).ok()?.name().to_string();
            let lower = name.to_lowercase();
            let is_html = lower.ends_with(".xhtml") || lower.ends_with(".html") || lower.ends_with(".htm");
            if is_html && !name.starts_with("META-INF/") && !name.ends_with('/') {
                Some(name)
            } else {
                None
            }
        })
        .collect();
    html_names.sort();

    let mut parts = Vec::with_capacity(html_names.len());
    for name in &html_names {
        match read_zip_string(&mut zip, name)? {
            Some(content) => {
                let text = html_to_text(&content);
                if !text.trim().is_empty() {
                    parts.push(text);
                }
            }
            None => eprintln!("[epub] failed to read {name}"),
        }
    }

    if parts.is_empty() {
        return Err(anyhow!("No readable text found in EPUB"));
    }

    Ok(Extracted {
        title: title.unwrap_or_else(|| "Untitled".to_string()),
        author,
        full_text: parts.join("\n\n"),
    })
}

fn read_zip_string<R: Read + std::io::Seek>(
    zip: &mut zip::ZipArchive<R>,
    name: &str,
) -> Result<Option<String>> {
    match zip.by_name(name) {
        Ok(mut file) => {
            let mut buf = String::new();
            file.read_to_string(&mut buf)
                .with_context(|| format!("reading {name} as utf-8"))?;
            Ok(Some(buf))
        }
        Err(zip::result::ZipError::FileNotFound) => Ok(None),
        Err(e) => Err(anyhow!(e)),
    }
}

fn extract_opf_title(opf: &str) -> Option<String> {
    let re = Regex::new(r"(?i)<dc:title[^>]*>([^<]+)</dc:title>").ok()?;
    re.captures(opf)
        .map(|c| html_escape::decode_html_entities(&c[1]).trim().to_string())
        .filter(|s| !s.is_empty())
}

fn extract_opf_author(opf: &str) -> Option<String> {
    // Prefer <dc:creator opf:role="aut">; fall back to the first <dc:creator>.
    let with_role = Regex::new(r#"(?i)<dc:creator[^>]*opf:role=["']aut["'][^>]*>([^<]+)</dc:creator>"#).ok()?;
    if let Some(c) = with_role.captures(opf) {
        let s = html_escape::decode_html_entities(&c[1]).trim().to_string();
        if !s.is_empty() {
            return Some(s);
        }
    }
    let any = Regex::new(r"(?i)<dc:creator[^>]*>([^<]+)</dc:creator>").ok()?;
    any.captures(opf)
        .map(|c| html_escape::decode_html_entities(&c[1]).trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Walk the DOM, emitting text content with `\n` at block boundaries, then
/// collapse whitespace inside each line. Mirrors the Node `htmlToText` helper
/// closely enough that the LLM gets the same input.
fn html_to_text(html: &str) -> String {
    let doc = Html::parse_document(html);

    // If there's a <body>, walk from there; otherwise walk the whole tree.
    let body_sel = Selector::parse("body").unwrap();
    let root = doc.select(&body_sel).next();

    let mut parts: Vec<String> = Vec::new();
    if let Some(body) = root {
        walk_node(*body, &mut parts);
    } else {
        for child in doc.tree.root().children() {
            walk_node(child, &mut parts);
        }
    }

    let joined: String = parts.join("");
    let decoded = html_escape::decode_html_entities(&joined).into_owned();

    let collapse_ws = Regex::new(r"\s+").unwrap();
    decoded
        .split('\n')
        .map(|line| collapse_ws.replace_all(line, " ").trim().to_string())
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn walk_node(node: ego_tree::NodeRef<Node>, parts: &mut Vec<String>) {
    match node.value() {
        Node::Text(t) => parts.push(t.to_string()),
        Node::Element(el) => {
            let name = el.name();
            let is_block = BLOCK_TAGS.contains(&name);
            if is_block {
                parts.push("\n".to_string());
            }
            for child in node.children() {
                walk_node(child, parts);
            }
            if is_block && name != "br" && name != "hr" {
                parts.push("\n".to_string());
            }
        }
        _ => {}
    }
}
