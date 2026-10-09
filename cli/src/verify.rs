//! Verbatim verification for LLM-reproduced book text.
//!
//! The model is asked to reproduce each source window sentence by sentence, but
//! LLMs "helpfully" fix archaic spellings, swap quote styles, drop a word, or
//! invent a sentence. A reader app must never show text that isn't in the book,
//! so the source window is the ground truth and the model's output is only
//! trusted for *where the sentence boundaries fall*:
//!
//! 1. Align the output tokens to the source tokens (global sequence alignment).
//! 2. Rebuild every sentence from the source tokens it aligns to, so the final
//!    text is the book's own, whatever the model typed.
//! 3. Report what had to be repaired, so a bad window can be retried and a
//!    hopeless one replaced by the raw source lines.

const GAP: i32 = -1;
/// Alignment needs an (n+1)*(m+1) byte traceback; refuse windows beyond this.
const MAX_CELLS: usize = 150_000_000;

/// Words per whole line at or under which a line can be page-number/header cruft.
const CRUFT_MAX_TOKENS: usize = 6;

struct SrcTok<'a> {
    text: &'a str,
    key: String,
    line: usize,
}

struct OutTok<'a> {
    text: &'a str,
    key: String,
}

fn norm_key(s: &str) -> String {
    s.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase()
}

/// The token without edge punctuation, for readable log examples.
fn bare(s: &str) -> &str {
    let t = s.trim_matches(|c: char| !c.is_alphanumeric());
    if t.is_empty() { s } else { t }
}

fn common_prefix(a: &str, b: &str) -> usize {
    a.chars().zip(b.chars()).take_while(|(x, y)| x == y).count()
}

fn pair_score(s: &SrcTok, o: &OutTok) -> i32 {
    if s.text == o.text {
        3
    } else if !s.key.is_empty() && s.key == o.key {
        2 // same word, different punctuation/quotes
    } else if common_prefix(&s.key, &o.key) >= 4 {
        1 // reworded or re-inflected (innigst / inniglich)
    } else {
        -2
    }
}

/// A line is cruft (page number, running header) when it is short and either has
/// no lowercase letters at all ("— 23 —", "XIV", "KAPITEL I") or is tiny and has a digit.
fn looks_like_cruft(line_tokens: &[&str]) -> bool {
    if line_tokens.is_empty() || line_tokens.len() > CRUFT_MAX_TOKENS {
        return false;
    }
    let no_lowercase = line_tokens.iter().all(|t| !t.chars().any(|c| c.is_lowercase()));
    let tiny_with_digit =
        line_tokens.len() <= 3 && line_tokens.iter().any(|t| t.chars().any(|c| c.is_ascii_digit()));
    no_lowercase || tiny_with_digit
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    /// Output matched the source (or was repaired by a negligible amount).
    Clean,
    /// Enough was wrong or missing that a retry is worthwhile.
    Suspect,
    /// The output isn't recognisably this source; don't use it.
    Unusable,
}

#[derive(Debug, Clone, Default)]
pub struct Report {
    pub src_tokens: usize,
    pub out_tokens: usize,
    /// Output words that differed from the source and were replaced by it.
    pub word_fixed: usize,
    /// Output words whose only difference was punctuation/quotes; replaced too.
    pub punct_fixed: usize,
    /// Output words with no counterpart in the source; removed.
    pub invented: usize,
    /// Source words the model dropped from the middle/edges of a sentence; restored.
    pub recovered: usize,
    /// Source words on lines the model left out entirely (not page-number cruft).
    pub omitted_text: usize,
    /// Source words on page-number/header lines the model left out (expected).
    pub omitted_cruft: usize,
    pub examples: Vec<String>,
    pub omitted_preview: Vec<String>,
}

impl Report {
    /// Words that were wrong, missing or invented in the model's output.
    pub fn bad(&self) -> usize {
        self.word_fixed + self.invented + self.recovered
    }

    pub fn cost(&self) -> usize {
        self.bad() + self.omitted_text
    }

    fn ratio(n: usize, d: usize) -> f64 {
        n as f64 / d.max(1) as f64
    }

    pub fn verdict(&self) -> Verdict {
        let bad = Self::ratio(self.bad(), self.out_tokens);
        let omitted = Self::ratio(self.omitted_text, self.src_tokens);
        if self.out_tokens > 0 && bad > 0.2 {
            Verdict::Unusable
        } else if bad > 0.03 || omitted > 0.25 {
            Verdict::Suspect
        } else {
            Verdict::Clean
        }
    }

    /// One-line human description of what was repaired, or None if nothing was.
    pub fn describe_repairs(&self) -> Option<String> {
        let mut parts = Vec::new();
        if self.word_fixed > 0 {
            parts.push(format!("{} reworded word(s) restored", self.word_fixed));
        }
        if self.invented > 0 {
            parts.push(format!("{} invented word(s) removed", self.invented));
        }
        if self.recovered > 0 {
            parts.push(format!("{} dropped word(s) restored", self.recovered));
        }
        if parts.is_empty() {
            return None;
        }
        let ex = if self.examples.is_empty() {
            String::new()
        } else {
            format!(" [{}]", self.examples.join(", "))
        };
        Some(format!("{}{}", parts.join(", "), ex))
    }

    pub fn describe_omissions(&self) -> Option<String> {
        if self.omitted_text == 0 {
            return None;
        }
        Some(format!(
            "{} word(s) on omitted line(s), e.g. {}",
            self.omitted_text,
            self.omitted_preview
                .iter()
                .map(|p| format!("\"{p}\""))
                .collect::<Vec<_>>()
                .join(", ")
        ))
    }
}

pub struct Verified {
    pub paragraphs: Vec<Vec<String>>,
    pub report: Report,
}

/// Rebuild `model_paragraphs` from `source`. Returns None when the window is too
/// large to align (the caller should fall back to the raw source lines).
pub fn verify_window(source: &str, model_paragraphs: &[Vec<String>]) -> Option<Verified> {
    // ── tokenise the source, remembering which line each token is on ────────
    let mut src: Vec<SrcTok> = Vec::new();
    let mut line_tokens: Vec<Vec<&str>> = Vec::new();
    for (li, line) in source.split('\n').enumerate() {
        let toks: Vec<&str> = line.split_whitespace().collect();
        for t in &toks {
            src.push(SrcTok { text: t, key: norm_key(t), line: li });
        }
        line_tokens.push(toks);
    }
    let cruft_line: Vec<bool> = line_tokens.iter().map(|t| looks_like_cruft(t)).collect();

    // ── tokenise the model output, remembering sentence membership ──────────
    let mut out: Vec<OutTok> = Vec::new();
    struct Sent {
        par: usize,
        start: usize,
        end: usize,
    }
    let mut sents: Vec<Sent> = Vec::new();
    for (pi, para) in model_paragraphs.iter().enumerate() {
        for sentence in para {
            let start = out.len();
            for t in sentence.split_whitespace() {
                out.push(OutTok { text: t, key: norm_key(t) });
            }
            sents.push(Sent { par: pi, start, end: out.len() });
        }
    }

    let (n, m) = (src.len(), out.len());
    let mut report = Report { src_tokens: n, out_tokens: m, ..Default::default() };

    if n == 0 || m == 0 {
        // Nothing to align. An empty output is accepted as "no readable content";
        // the caller sees it as omitted text via the report.
        if n > 0 {
            record_omissions(&mut report, &src, &vec![false; n], &line_tokens, &cruft_line, &vec![false; n]);
        }
        return Some(Verified { paragraphs: Vec::new(), report });
    }
    if (n + 1).checked_mul(m + 1).map_or(true, |c| c > MAX_CELLS) {
        return None;
    }

    // ── global alignment (Needleman–Wunsch, linear gaps, diagonal on ties) ──
    let w = m + 1;
    let mut dir = vec![0u8; (n + 1) * w]; // 0 diag, 1 skip source token, 2 skip output token
    let mut prev: Vec<i32> = (0..=m).map(|j| j as i32 * GAP).collect();
    let mut cur = vec![0i32; w];
    for j in 1..=m {
        dir[j] = 2;
    }
    for i in 1..=n {
        cur[0] = i as i32 * GAP;
        dir[i * w] = 1;
        for j in 1..=m {
            let d = prev[j - 1] + pair_score(&src[i - 1], &out[j - 1]);
            let u = prev[j] + GAP;
            let l = cur[j - 1] + GAP;
            let (best, step) = if d >= u && d >= l {
                (d, 0)
            } else if u >= l {
                (u, 1)
            } else {
                (l, 2)
            };
            cur[j] = best;
            dir[i * w + j] = step;
        }
        std::mem::swap(&mut prev, &mut cur);
    }

    let mut out_to_src: Vec<Option<usize>> = vec![None; m];
    let mut src_aligned = vec![false; n];
    let (mut i, mut j) = (n, m);
    while i > 0 || j > 0 {
        match dir[i * w + j] {
            0 => {
                out_to_src[j - 1] = Some(i - 1);
                src_aligned[i - 1] = true;
                i -= 1;
                j -= 1;
            }
            1 => i -= 1,
            _ => j -= 1,
        }
    }

    // ── classify what the model got wrong ───────────────────────────────────
    for (oj, mapped) in out_to_src.iter().enumerate() {
        match mapped {
            None => {
                report.invented += 1;
                push_example(&mut report, format!("+{}", bare(out[oj].text)));
            }
            Some(si) if out[oj].text == src[*si].text => {}
            Some(si) if !src[*si].key.is_empty() && out[oj].key == src[*si].key => {
                report.punct_fixed += 1;
            }
            Some(si) => {
                report.word_fixed += 1;
                push_example(&mut report, format!("{} → {}", bare(out[oj].text), bare(src[*si].text)));
            }
        }
    }

    let mut line_aligned = vec![false; line_tokens.len()];
    for (t, a) in src.iter().zip(&src_aligned) {
        if *a {
            line_aligned[t.line] = true;
        }
    }

    // ── per-sentence source span ────────────────────────────────────────────
    let spans: Vec<Option<(usize, usize)>> = sents
        .iter()
        .map(|s| {
            let mapped = out_to_src[s.start..s.end].iter().flatten();
            let (mut lo, mut hi, mut any) = (usize::MAX, 0usize, false);
            for &si in mapped {
                lo = lo.min(si);
                hi = hi.max(si);
                any = true;
            }
            any.then_some((lo, hi))
        })
        .collect();
    let live: Vec<usize> = (0..sents.len()).filter(|&k| spans[k].is_some()).collect();

    // Words the model dropped at a sentence's edge (same source line, between it
    // and its neighbour) belong to that sentence: extend the span over them.
    let mut ext: Vec<(usize, usize)> = Vec::with_capacity(live.len());
    let mut prev_hi: Option<usize> = None;
    for (idx, &k) in live.iter().enumerate() {
        let (lo, hi) = spans[k].unwrap();
        let next_lo = live.get(idx + 1).map(|&nk| spans[nk].unwrap().0).unwrap_or(n);
        let floor = prev_hi.map(|h| h + 1).unwrap_or(0);
        let mut l = lo;
        while l > floor && !src_aligned[l - 1] && src[l - 1].line == src[lo].line {
            l -= 1;
        }
        let mut h = hi;
        while h + 1 < next_lo && !src_aligned[h + 1] && src[h + 1].line == src[hi].line {
            h += 1;
        }
        prev_hi = Some(h);
        ext.push((l, h));
    }

    // ── rebuild each sentence from the source ───────────────────────────────
    let mut included = vec![false; n];
    let mut rebuilt: Vec<Option<String>> = vec![None; sents.len()];
    for (idx, &k) in live.iter().enumerate() {
        let (l, h) = ext[idx];
        let mut words: Vec<&str> = Vec::new();
        for t in l..=h {
            let line = src[t].line;
            if !src_aligned[t] && !line_aligned[line] && cruft_line[line] {
                continue; // a page number / running header sitting inside the sentence
            }
            if !src_aligned[t] {
                report.recovered += 1;
            }
            included[t] = true;
            words.push(src[t].text);
        }
        rebuilt[k] = Some(words.join(" "));
    }

    record_omissions(&mut report, &src, &included, &line_tokens, &cruft_line, &src_aligned);

    // ── reassemble in the model's paragraph structure ───────────────────────
    let mut paragraphs: Vec<Vec<String>> = vec![Vec::new(); model_paragraphs.len()];
    for (k, s) in sents.iter().enumerate() {
        if let Some(text) = rebuilt[k].take() {
            paragraphs[s.par].push(text);
        }
    }
    paragraphs.retain(|p| !p.is_empty());

    Some(Verified { paragraphs, report })
}

fn push_example(report: &mut Report, s: String) {
    if report.examples.len() < 4 {
        report.examples.push(s);
    }
}

/// Tally source words that didn't make it into the output, separating
/// page-number cruft (expected) from real text (worth a warning).
fn record_omissions(
    report: &mut Report,
    src: &[SrcTok],
    included: &[bool],
    line_tokens: &[Vec<&str>],
    cruft_line: &[bool],
    src_aligned: &[bool],
) {
    let mut line_has_aligned = vec![false; line_tokens.len()];
    for (t, a) in src.iter().zip(src_aligned) {
        if *a {
            line_has_aligned[t.line] = true;
        }
    }
    let mut previewed_lines: Vec<usize> = Vec::new();
    for (t, tok) in src.iter().enumerate() {
        if included[t] {
            continue;
        }
        if cruft_line[tok.line] && !line_has_aligned[tok.line] {
            report.omitted_cruft += 1;
        } else {
            report.omitted_text += 1;
            if report.omitted_preview.len() < 3 && !previewed_lines.contains(&tok.line) {
                previewed_lines.push(tok.line);
                let preview: String = line_tokens[tok.line].join(" ").chars().take(60).collect();
                report.omitted_preview.push(preview);
            }
        }
    }
}

/// Last resort when the model's output can't be trusted: every source line as
/// its own single-sentence paragraph. Unpretty, but it is the book's own text.
/// Page-number cruft lines are dropped, as the model would have.
pub fn fallback_paragraphs(source: &str) -> Vec<Vec<String>> {
    source
        .split('\n')
        .filter_map(|line| {
            let toks: Vec<&str> = line.split_whitespace().collect();
            (!toks.is_empty() && !looks_like_cruft(&toks)).then(|| vec![toks.join(" ")])
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(paras: &[&[&str]]) -> Vec<Vec<String>> {
        paras.iter().map(|p| p.iter().map(|s| s.to_string()).collect()).collect()
    }

    const SRC: &str = "Er liebte sie innigst. Sie aber schwieg.\nDann kam der Abend.";

    #[test]
    fn faithful_output_passes_through_untouched() {
        let v = verify_window(SRC, &p(&[&["Er liebte sie innigst.", "Sie aber schwieg."], &["Dann kam der Abend."]])).unwrap();
        assert_eq!(v.paragraphs, p(&[&["Er liebte sie innigst.", "Sie aber schwieg."], &["Dann kam der Abend."]]));
        assert_eq!(v.report.cost(), 0);
        assert_eq!(v.report.verdict(), Verdict::Clean);
    }

    #[test]
    fn reworded_word_is_restored_from_the_source() {
        let v = verify_window(SRC, &p(&[&["Er liebte sie inniglich.", "Sie aber schwieg."], &["Dann kam der Abend."]])).unwrap();
        assert_eq!(v.paragraphs[0][0], "Er liebte sie innigst.");
        assert_eq!(v.report.word_fixed, 1);
        assert!(v.report.describe_repairs().unwrap().contains("inniglich → innigst"));
    }

    #[test]
    fn changed_quotes_and_punctuation_are_restored() {
        let src = "„Komm her“, sagte er.";
        let v = verify_window(src, &p(&[&["\"Komm her\", sagte er."]])).unwrap();
        assert_eq!(v.paragraphs[0][0], src);
        assert_eq!(v.report.punct_fixed, 2);
        assert_eq!(v.report.verdict(), Verdict::Clean);
    }

    #[test]
    fn dropped_word_is_restored_at_start_middle_and_end() {
        let src = "Und dann ging er langsam nach Hause zurück.";
        let v = verify_window(src, &p(&[&["dann ging er nach Hause."]])).unwrap();
        assert_eq!(v.paragraphs[0][0], src);
        assert_eq!(v.report.recovered, 3); // Und, langsam, zurück
    }

    #[test]
    fn invented_sentence_is_removed() {
        let v = verify_window(
            SRC,
            &p(&[&["Er liebte sie innigst.", "Sie aber schwieg."], &["Das ist völlig erfunden."], &["Dann kam der Abend."]]),
        )
        .unwrap();
        assert_eq!(v.paragraphs, p(&[&["Er liebte sie innigst.", "Sie aber schwieg."], &["Dann kam der Abend."]]));
        assert_eq!(v.report.invented, 4);
    }

    #[test]
    fn page_number_lines_may_be_dropped_even_inside_a_sentence() {
        let src = "Er ging durch den\n— 23 —\nWald nach Hause.\n24\nDann schlief er.";
        let v = verify_window(src, &p(&[&["Er ging durch den Wald nach Hause."], &["Dann schlief er."]])).unwrap();
        assert_eq!(v.paragraphs, p(&[&["Er ging durch den Wald nach Hause."], &["Dann schlief er."]]));
        assert_eq!(v.report.recovered, 0);
        assert_eq!(v.report.omitted_text, 0);
        assert_eq!(v.report.omitted_cruft, 4);
        assert_eq!(v.report.verdict(), Verdict::Clean);
    }

    #[test]
    fn a_sentence_dropped_from_a_line_is_restored_not_lost() {
        let src = "Er kam. Sie ging. Wir blieben.";
        let v = verify_window(src, &p(&[&["Er kam.", "Wir blieben."]])).unwrap();
        let joined = v.paragraphs.concat().join(" ");
        assert_eq!(joined, src);
        assert_eq!(v.report.recovered, 2);
    }

    #[test]
    fn a_wholly_omitted_paragraph_is_reported_not_invented() {
        let src = "Erster Absatz hier.\nCopyright 2020 Some Publisher Verlag Berlin.\nLetzter Absatz dort.";
        let v = verify_window(src, &p(&[&["Erster Absatz hier."], &["Letzter Absatz dort."]])).unwrap();
        assert_eq!(v.paragraphs, p(&[&["Erster Absatz hier."], &["Letzter Absatz dort."]]));
        assert_eq!(v.report.omitted_text, 6);
        assert!(v.report.describe_omissions().unwrap().contains("Copyright"));
    }

    #[test]
    fn an_empty_answer_is_accepted_and_reported_as_omitted() {
        let v = verify_window("Alles Rechte vorbehalten für den Verlag.", &[]).unwrap();
        assert!(v.paragraphs.is_empty());
        assert_eq!(v.report.omitted_text, 6);
    }

    #[test]
    fn unrelated_output_is_unusable() {
        let v = verify_window(SRC, &p(&[&["The quick brown fox jumps over the lazy dog today."]])).unwrap();
        assert_eq!(v.report.verdict(), Verdict::Unusable);
    }

    #[test]
    fn moderately_reworded_output_is_flagged_for_retry() {
        let src = "a1 b2 c3 d4 e5 f6 g7 h8 i9 j0 k1 l2 m3 n4 o5 p6 q7 r8 s9 t0 u1 v2 w3 x4 y5 z6 aa bb cc dd ee ff gg hh ii jj";
        let altered = "a1 b2 c3 XXXX YYYY ZZZZ g7 h8 i9 j0 k1 l2 m3 n4 o5 p6 q7 r8 s9 t0 u1 v2 w3 x4 y5 z6 aa bb cc dd ee ff gg hh ii jj";
        let v = verify_window(src, &p(&[&[altered]])).unwrap();
        assert_eq!(v.paragraphs[0][0], src);
        assert_eq!(v.report.verdict(), Verdict::Suspect);
    }

    #[test]
    fn a_full_size_window_is_repaired_correctly() {
        // ~4,000 words, like one WINDOW_CHARS window; one word altered in the middle.
        let lines: Vec<String> = (0..200)
            .map(|l| (0..20).map(|w| format!("wort{}x{}", l, w)).collect::<Vec<_>>().join(" "))
            .collect();
        let source = lines.join("\n");
        let mut altered = lines.clone();
        altered[100] = altered[100].replace("wort100x7", "wortXYZ");
        let model: Vec<Vec<String>> = altered.iter().map(|l| vec![l.clone()]).collect();
        let started = std::time::Instant::now();
        let v = verify_window(&source, &model).unwrap();
        eprintln!("aligned 4,000 words in {:?}", started.elapsed());
        let rebuilt: Vec<String> = v.paragraphs.iter().map(|p| p[0].clone()).collect();
        assert_eq!(rebuilt, lines);
        assert_eq!(v.report.word_fixed, 1);
    }

    #[test]
    fn windows_too_large_to_align_are_refused() {
        let big_src = vec!["wort"; 13_000].join(" ");
        assert!(verify_window(&big_src, &p(&[&[&big_src]])).is_none());
    }

    #[test]
    fn fallback_keeps_every_line_and_drops_only_page_numbers() {
        let got = fallback_paragraphs("Erste  Zeile hier.\n— 3 —\n\nZweite Zeile.");
        assert_eq!(got, p(&[&["Erste Zeile hier."], &["Zweite Zeile."]]));
    }
}
