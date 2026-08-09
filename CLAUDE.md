# Claude Code Instructions for Lenguas

## Project Overview

Lenguas is a mobile reading app for language learners. The user opens a book in their target language (German, Dutch, French, or Spanish) and reads it one sentence at a time: the English translation appears on top, the original sentence below with every word tappable. Tapping a noun/verb/adjective (highlighted) shows its contextual translation plus, when relevant, a one-sentence grammar explanation; tapping any other word (articles, prepositions, pronouns, etc., shown in a different color) just plays its audio, with no translation.

No login. The app launches directly into language select, and all API endpoints are open — there is no per-user state on the server.

**Books are parsed offline** by the developer using a CLI script (`api/v0/bin/parse-epub.js`) that runs the EPUB through gpt-4.1-mini and uploads the parsed `SerializedBook` JSON to S3. The API is read-only against that S3 library; the mobile app fetches the library list and downloads books on demand. Mobile never parses anything.

**Architecture:**
- **Frontend**: React Native app (`mobile/`)
- **Backend**: Express.js API (`api/v0/`) — stateless, no database; reads from S3
- **Library storage**: S3 bucket `lenguas-parsed-books` (us-west-2)
- **Image registry**: `ghcr.io/georgebradford0/lenguas-api`
- **Deployment**: Docker container on AWS EC2 (`ec2-16-144-226-254.us-west-2.compute.amazonaws.com`)
- **External services**: OpenAI (translation + EPUB parse), AWS Polly (TTS), AWS S3 (library)

## Key Files & Locations

### Backend (`api/v0/`)
- `index.js` — Express app, mounts `/speak`, `/translate`, and `/books`
- `routes/speak.js` — `GET /speak/:text?language=` (Polly TTS, returns mp3 bytes)
- `routes/translate.js` — `POST /translate/sentence` (sentence → chunks + word translations)
- `routes/books.js` — `GET /books?language=X` (library list), `GET /books/:hash` (full book). Read-only against S3.
- `lib/parseEpub.js` — pure parse pipeline: takes EPUB buffer, returns SerializedBook. Used by the CLI; not mounted as a route.
- `lib/bookStore.js` — S3 helpers: head/get/put by SHA-256, plus `_index.json` manifest read/write.
- `bin/parse-epub.js` — **dev CLI**: `node bin/parse-epub.js <file.epub> --language de`. Parses locally and uploads to S3.
- `config/languages.js` — per-language Polly voice config
- `Dockerfile` — `node:22-alpine`, `npm ci --production`

### Frontend (`mobile/src/`)
- `App.tsx` — language pick → ReadAlongScreen (no login screen)
- `screens/ReadAlongScreen.tsx` — phase machine (`loading | library | downloading | toc | reading`). Library is fetched from `GET /books?language=X`; tapping an undownloaded book triggers `GET /books/:hash` and caches it locally by content hash.
- `components/SentenceModePanel.tsx` — fullscreen sentence reader, fetches `/translate/sentence` per sentence, shows translation on top + original below with noun/verb taps
- `utils/epubParser.ts` — types + `hydrateSerializedBook` + tokenizer. No parsing — books arrive pre-parsed from the server.
- `utils/bookStorage.ts` — RNFS-backed cache: downloaded `SerializedBook` JSONs keyed by content hash, library-list cache for offline, per-language `{ currentBookHash, positions }` state.
- `api/client.ts` — fetch wrappers: `listLibrary`, `fetchBook`, `translateSentence`, `speak`.

### Infra
- `docker-compose.prod.yml` — pulls the GHCR image and runs the api container with `restart: unless-stopped`. No mongo, no network alias.
- `docker-compose.yml` — local dev compose (builds from `./api/v0`)
- `deploy.sh` — ships compose file + writes `.env` on the remote host, then `docker compose pull && up -d --force-recreate api`
- `.github/workflows/api-docker.yml` — `workflow_dispatch` job that builds the API Dockerfile for `linux/amd64 + linux/arm64` and pushes to GHCR

## Reading Flow

1. App boots into language select, then `ReadAlongScreen` fetches the server library (`GET /books?language=de`) and auto-resumes the saved current book if it's already downloaded.
2. User taps a book in the library. If already cached (downloaded earlier), it opens instantly. Otherwise mobile downloads it via `GET /books/:hash`, caches it locally as `<DocumentDirectoryPath>/readalong/book_<hash>.json`, then opens.
3. Opening a chapter drops into fullscreen sentence mode at the saved position (or sentence 0). `SentenceModePanel` calls `POST /translate/sentence` for every sentence; the response carries the whole-sentence translation, a list of grammatically-coherent chunks (each with its own translation + play button), and a pre-computed list of nouns/verbs with per-word translation/explanation.
4. Prev/Next walks within the chapter and auto-advances across chapter boundaries. Back returns to the TOC.

## Adding Books (Dev Workflow)

Books are added by the developer running the parse CLI locally:

```bash
cd api/v0 && node bin/parse-epub.js ~/Downloads/der-prozess.epub --language de
```

What it does:
1. Reads the EPUB bytes, computes SHA-256.
2. Skips the parse if `s3://lenguas-parsed-books/parsed-books/<hash>.json` already exists (use `--force` to override).
3. Runs `lib/parseEpub.js` — extracts text, asks gpt-4.1-mini for TOC + metadata (title, author, description, genre, CEFR difficulty), reproduces each section in parallel batches.
4. Uploads the full `SerializedBook` to S3 under `parsed-books/<hash>.json`.
5. Upserts a summary entry into `parsed-books/_index.json` so the API library list picks it up.

Requires `OPENAI_API_KEY`, `AWS_S3_BUCKET`, and AWS credentials in the repo-root `.env`. Or `npm run parse-epub -- <args>` from `api/v0/`.

## API Endpoints

All endpoints are unauthenticated.

- `GET /health` — `{ status: "ok" }`
- `GET /speak/:text?language=de|nl|fr|es` — mp3 bytes via Polly
- `POST /translate/sentence` — body `{ sentence, language }` →
  ```
  { translation: string,
    chunks: [{ original: string, translation: string }],
    words: [{ word, pos: 'noun'|'verb'|'adjective', translation, explanation: string|null }] }
  ```
  `word` is the inflected surface form as it appears in the sentence, not a lemma.
- `GET /books?language=de` — `{ books: LibrarySummary[] }`. Reads from S3 `_index.json`. Each summary: `{ contentHash, title, author, description, genre, difficulty, language, uploadedAt }`.
- `GET /books/:hash` — `{ book: SerializedBook }`. Reads from S3. 404 if unknown hash. The full `SerializedBook` includes paragraphs/sentences for every chapter — ready for the reader to hydrate.

## Building & Publishing the API Image

The image is **not** built on the EC2 box. Builds happen in CI (or locally) and the host pulls.

**CI build** (`workflow_dispatch`): GitHub → Actions → "Build and Push API Image" → Run workflow. Pushes `:latest` and `:sha-<short>` to GHCR. Optional input adds a version tag (e.g. `v1.2.3`).

**Local build** (multi-arch via buildx, useful when CI is unavailable):
```bash
gh auth token | docker login ghcr.io -u georgebradford0 --password-stdin
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag ghcr.io/georgebradford0/lenguas-api:latest \
  --tag ghcr.io/georgebradford0/lenguas-api:sha-$(git rev-parse --short HEAD) \
  --push ./api/v0
```

The image is currently **private**; toggling public is a one-time UI flip at https://github.com/users/georgebradford0/packages/container/lenguas-api/settings .

## Deploying the Backend

```bash
./deploy.sh
```

What it does:
1. Reads local `.env` (or environment) for `OPENAI_API_KEY` and `AWS_*`.
2. SCPs `docker-compose.prod.yml` to the EC2 box.
3. Writes a fresh `.env` on the host.
4. `docker compose pull && docker compose up -d --force-recreate api` — always replaces the running api container with the freshly-pulled image, even when only the `:latest` digest moved.

**One-time prerequisites on the EC2 box:**
- Docker installed.
- If the GHCR image is still private: `echo "$GHCR_PAT" | docker login ghcr.io -u georgebradford0 --password-stdin`.

**Remote details:**
- Host: `ubuntu@ec2-16-144-226-254.us-west-2.compute.amazonaws.com`
- Remote dir: `/home/ubuntu/lenguas`
- API port: 3000

**Verify after deploy:**
```bash
curl http://ec2-16-144-226-254.us-west-2.compute.amazonaws.com:3000/health
```

## Mobile Deployment (iOS / TestFlight)

```bash
cd mobile/ios && bundle exec fastlane beta
```

Builds a release IPA via Xcode and uploads to TestFlight.

**Requirements:**
- App Store Connect team API key (`AuthKey_7XMT6777TY.p8`) in `mobile/ios/fastlane/`
- `bundle` (Bundler) available — `gem install bundler` if missing

**Before deploying:**
1. Bump `CURRENT_PROJECT_VERSION` (integer, +1) and `MARKETING_VERSION` (semver) in `mobile/ios/Lenguas.xcodeproj/project.pbxproj`.
2. Commit the version bump.
3. Run `bundle exec fastlane beta` from `mobile/ios/`.

Upload only (skip rebuild): `bundle exec fastlane upload`.

Fastfile: `mobile/ios/fastlane/Fastfile`.

## Mobile Deployment (Google Play / Alpha)

```bash
cd mobile/android && bundle exec fastlane closed
```

Builds a release AAB via Gradle and uploads to the alpha track.

**Requirements:**
- Release keystore in `mobile/android/gradle.properties` (`LENGUAS_RELEASE_*` keys)
- Google Play service account JSON (`zotik-456123-a116e792e9e6.json`) in `mobile/android/fastlane/`

**Before deploying:**
1. Bump `versionCode` (+1) and `versionName` (semver) in `mobile/android/app/build.gradle`.
2. Commit the version bump.
3. Run `bundle exec fastlane closed` from `mobile/android/`.

Fastfile: `mobile/android/fastlane/Fastfile`. Version commits follow the format `Mobile Version X.Y.Z`.

## Remote Operations

```bash
# View logs
ssh -i ~/Documents/lenovo-ideapad.pem ubuntu@ec2-16-144-226-254.us-west-2.compute.amazonaws.com \
  'cd /home/ubuntu/lenguas && docker compose logs -f'

# Restart api
ssh -i ~/Documents/lenovo-ideapad.pem ubuntu@ec2-16-144-226-254.us-west-2.compute.amazonaws.com \
  'cd /home/ubuntu/lenguas && docker compose restart api'

# Pull a new image without redeploying compose
ssh -i ~/Documents/lenovo-ideapad.pem ubuntu@ec2-16-144-226-254.us-west-2.compute.amazonaws.com \
  'cd /home/ubuntu/lenguas && docker compose pull && docker compose up -d --force-recreate api'

# API container shell
ssh -i ~/Documents/lenovo-ideapad.pem ubuntu@ec2-16-144-226-254.us-west-2.compute.amazonaws.com \
  'docker exec -it language-app-api sh'
```

## Environment Variables

**Required for the API:**
- `OPENAI_API_KEY` — `/translate/sentence`
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` — Polly (TTS) + S3 (library)
- `AWS_S3_BUCKET` — the library bucket (`lenguas-parsed-books`)

**Also required for `bin/parse-epub.js` (dev CLI):** all of the above.

**Optional:**
- `PORT` (default 3000)

**Used by `deploy.sh` from your shell / local `.env`:**
- `OPENAI_API_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET`.

## Git Workflow

**Only create commits when explicitly requested by the user.**

When committing:
1. Run `git status` and `git diff` first.
2. Stage specific files (avoid `git add -A`).
3. Write a message explaining WHY, not just WHAT.
4. Include co-author line: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`.
5. Use heredoc format.

**Never** force-push, `--no-verify`, or `--amend` without explicit instruction. Don't push without explicit instruction.

## Best Practices

1. **Read files before editing** — understand current state.
2. **Prefer editing existing files** over creating new ones.
3. **Parallelize independent tool calls** (e.g. `git status` + `git diff`, multiple `Read`s).
4. **Only make requested changes** — no opportunistic refactors.
5. **Confirm destructive remote actions** (force-push, recreating containers in ways that could lose state).
6. **For mobile changes**, no backend redeploy is needed — mobile builds ship separately via Fastlane.

## Notes for Claude

- Backend lives on EC2; mobile runs from the developer's machine via Metro.
- After backend changes, the user must (a) trigger the GH Actions workflow or build locally, then (b) run `./deploy.sh` to roll the new image. There's no source-shipping deploy anymore.
- The API is stateless — there is no database in prod. All reader state (library, current book, sentence position per chapter) is kept locally in AsyncStorage on the device. Do not write code that assumes server-side per-user state.
