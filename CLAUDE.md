# Claude Code Instructions for Lenguas

## Project Overview

Lenguas is a mobile reading app for language learners. The user opens an EPUB in their target language (German, Dutch, French, or Spanish) and reads it one sentence at a time: the English translation appears on top, the original sentence below with **only nouns and verbs tappable**. Tapping a noun/verb shows its contextual translation plus, when relevant, a one-sentence grammar explanation.

Auth is passwordless — a 6-digit code is emailed via AWS SES and exchanged for a JWT.

**Architecture:**
- **Frontend**: React Native app (`mobile/`)
- **Backend**: Express.js API (`api/v0/`)
- **Database**: MongoDB (only stores short-lived `LoginCode` documents — there is no user-progress tracking)
- **Image registry**: `ghcr.io/georgebradford0/lenguas-api`
- **Deployment**: Docker containers on AWS EC2 (`ec2-16-144-226-254.us-west-2.compute.amazonaws.com`)
- **External services**: OpenAI (translation), AWS Polly (TTS), AWS SES (email)

## Key Files & Locations

### Backend (`api/v0/`)
- `index.js` — Express app, mounts auth/speak/translate routes
- `routes/auth.js` — `POST /auth/login`, `POST /auth/verify`, `DELETE /auth/account`
- `routes/speak.js` — `GET /speak/:text?language=` (Polly TTS, returns mp3 bytes)
- `routes/translate.js` — `POST /translate/sentence`, `POST /translate/chapter`
- `models/LoginCode.js` — the only Mongo model
- `middleware/authMiddleware.js` — JWT verification
- `config/languages.js` — per-language Polly voice config
- `Dockerfile` — `node:22-alpine`, `npm ci --production`

### Frontend (`mobile/src/`)
- `App.tsx` — login → language pick → ReadAlongScreen
- `screens/ReadAlongScreen.tsx` — phase machine (`loading | library | parsing | toc | reading`); the `reading` phase mounts `SentenceModePanel` fullscreen
- `components/SentenceModePanel.tsx` — fullscreen sentence reader, fetches `/translate/sentence` per sentence, shows translation on top + original below with noun/verb taps
- `utils/epubParser.ts` — unzips the EPUB, runs each chapter's raw lines through `/translate/chapter`, tokenizes into sentences with stable word IDs
- `utils/bookStorage.ts` — AsyncStorage-backed library + per-language `{ currentBookId, positions }` state
- `api/client.ts` — fetch wrappers for every endpoint above

### Infra
- `docker-compose.prod.yml` — pulls the GHCR image, brings up mongo + api with named containers + restart policy
- `docker-compose.yml` — local dev compose (builds from `./api/v0`)
- `deploy.sh` — ships compose file + writes `.env` on the remote host, then `docker compose pull && up -d`
- `.github/workflows/api-docker.yml` — `workflow_dispatch` job that builds the API Dockerfile for `linux/amd64 + linux/arm64` and pushes to GHCR

## Reading Flow

1. App boots → loads library + auto-resumes current book if one is saved.
2. User picks (or adds) an EPUB. New books are parsed: each chapter's raw HTML lines go to `POST /translate/chapter`, which uses OpenAI to drop non-content, merge paragraphs, and split sentences without translating. Parsed books are persisted locally so reopens are instant.
3. Opening a chapter drops into fullscreen sentence mode at the saved position (or sentence 0). `SentenceModePanel` calls `POST /translate/sentence` for every sentence; the response carries the whole-sentence translation **and** a pre-computed list of nouns/verbs with per-word translation/explanation, so taps don't make a second API call.
4. Prev/Next walks within the chapter and auto-advances across chapter boundaries. Back returns to the TOC.

## API Endpoints

All `/speak`, `/translate/*` routes require a JWT bearer token.

- `POST /auth/login` — body `{ email }` → emails a 6-digit code
- `POST /auth/verify` — body `{ email, code }` → `{ token, userId }`
- `DELETE /auth/account` — deletes the caller's pending login codes
- `GET /health` — `{ status: "ok" }`
- `GET /speak/:text?language=de|nl|fr|es` — mp3 bytes via Polly
- `POST /translate/sentence` — body `{ sentence, language }` →
  ```
  { translation: string,
    words: [{ word, pos: 'noun'|'verb', translation, explanation: string|null }] }
  ```
  `word` is the inflected surface form as it appears in the sentence, not a lemma.
- `POST /translate/chapter` — body `{ rawLines: string[], language }` → `{ paragraphs: string[][] }` (structured sentences, no translation)

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
3. Writes a fresh `.env` on the host (sources `JWT_SECRET` from `~/.lenguas_secrets` on the box).
4. `docker compose pull && docker compose up -d` — recreates only the api container; mongo keeps running off its volume.

**One-time prerequisites on the EC2 box:**
- Docker installed.
- If the GHCR image is still private: `echo "$GHCR_PAT" | docker login ghcr.io -u georgebradford0 --password-stdin`.
- `~/.lenguas_secrets` contains `LENGUAS_JWT_SECRET=...`.

**Remote details:**
- Host: `ubuntu@ec2-16-144-226-254.us-west-2.compute.amazonaws.com`
- Remote dir: `/home/ubuntu/lenguas`
- API port: 3000
- Mongo: container port 27017, host port 27018

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

# Restart api (mongo unaffected)
ssh -i ~/Documents/lenovo-ideapad.pem ubuntu@ec2-16-144-226-254.us-west-2.compute.amazonaws.com \
  'cd /home/ubuntu/lenguas && docker compose restart api'

# Pull a new image without redeploying compose
ssh -i ~/Documents/lenovo-ideapad.pem ubuntu@ec2-16-144-226-254.us-west-2.compute.amazonaws.com \
  'cd /home/ubuntu/lenguas && docker compose pull && docker compose up -d'

# API container shell
ssh -i ~/Documents/lenovo-ideapad.pem ubuntu@ec2-16-144-226-254.us-west-2.compute.amazonaws.com \
  'docker exec -it language-app-api sh'

# Mongo shell (mainly useful to inspect pending login codes)
ssh -i ~/Documents/lenovo-ideapad.pem ubuntu@ec2-16-144-226-254.us-west-2.compute.amazonaws.com \
  'docker exec -it language-app-mongo mongosh language-app'
```

## Environment Variables

**Required for the API:**
- `OPENAI_API_KEY` — `/translate/*`
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` — SES (auth emails) + Polly (TTS)
- `JWT_SECRET` — JWT signing

**Optional:**
- `MONGO_URI` (default `mongodb://mongo:27017/language-app`)
- `PORT` (default 3000)

**Used by `deploy.sh` from your shell / local `.env`:**
- `OPENAI_API_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`. `JWT_SECRET` is read from `~/.lenguas_secrets` on the EC2 box.

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
5. **Confirm destructive remote actions** (force-push, dropping the prod DB, recreating containers in ways that could lose state).
6. **For mobile changes**, no backend redeploy is needed — mobile builds ship separately via Fastlane.

## Notes for Claude

- Backend lives on EC2; mobile runs from the developer's machine via Metro.
- After backend changes, the user must (a) trigger the GH Actions workflow or build locally, then (b) run `./deploy.sh` to roll the new image. There's no source-shipping deploy anymore.
- The only Mongo collection in use is `logincodes`. There is no user-progress data; do not write code that assumes there is.
- The reader keeps state locally (AsyncStorage). Clearing the remote DB only affects pending login codes.
