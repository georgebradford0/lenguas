# Claude Code Instructions for Language Learning App

## Project Overview

This is a language learning app using the European Framework levels (A1/A2/B1). It generates simple word translation tasks from curated vocabulary lists, with spaced repetition and mastery tracking.

**Architecture:**
- **Frontend**: React Native mobile app (`mobile/` directory)
- **Backend**: Express.js API (`api/v0/` directory)
- **Database**: MongoDB (for progress tracking)
- **Deployment**: Docker containers on AWS EC2 (35.88.113.219)
- **Vocabulary**: JSON files in `wordlists/` directory (a1_vocabulary.json, a2_vocabulary.json, b1_vocabulary.json)

## Key Files & Locations

### Backend (API)
- **`api/v0/routes/generateTask.js`**: Core task generation logic
  - `loadVocabulary()`: Loads vocab from JSON files
  - `parsePluralForm()`: Parses German plural markers (e.g., "die Adresse, -en")
  - `selectWord()`: Weighted selection for spaced repetition
  - `generateDistractors()`: Creates wrong answer choices
  - Endpoints: `/generate-task`, `/submit-answer`, `/level-stats`

- **`api/v0/models/Progress.js`**: MongoDB schema for tracking user progress
  - Fields: word, level (A1/A2/B1), timesShown, correctCount, lastSeenTaskType

### Frontend (Mobile)
- **`mobile/src/types/index.ts`**: TypeScript type definitions (Level, GeneratedTask, etc.)
- **`mobile/src/hooks/useCards.ts`**: Main hook for task management
- **`mobile/src/hooks/useApiClient.ts`**: API client for backend communication

### Deployment & Infrastructure
- **`docker-compose.prod.yml`**: Docker configuration for production deployment
- **`deploy.sh`**: Main deployment script to AWS EC2
- **`clear-db.sh`**: Script to clear remote database

### Vocabulary
- **`wordlists/a1_vocabulary.json`**: 641 A1-level words
- **`wordlists/a2_vocabulary.json`**: 904 A2-level words
- **`wordlists/b1_vocabulary.json`**: 2,345 B1-level words

## Deployment Process

### Deploy to Remote Server

```bash
./deploy.sh
```

**What it does:**
1. Creates remote directory on EC2 server
2. Copies API files (excluding node_modules)
3. Copies wordlists directory
4. Copies docker-compose.prod.yml
5. Creates .env file with OPENAI_API_KEY
6. Builds and starts Docker containers
7. Shows service status

**Requirements:**
- SSH key: `~/Documents/lenovo-ideapad.pem`
- Environment variable: `OPENAI_API_KEY` must be set
- Optional: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`

**Remote Server Details:**
- Host: ubuntu@35.88.113.219
- Remote directory: /home/ubuntu/language-app
- API port: 3000
- MongoDB port: 27018 (external), 27017 (internal)

### Verify Deployment

After deployment, check:
- Health: http://35.88.113.219:3000/health
- Level stats: http://35.88.113.219:3000/level-stats

## Database Management

### Clear Remote Database

```bash
./clear-db.sh
```

This drops the entire `language-app` database on the remote server, clearing:
- `progress` collection (user progress tracking)
- `pronounhistories` collection (if exists)

**Use when:**
- Starting fresh in development
- Testing new progression logic
- Major schema changes

## Testing

### Test Plural Parsing Locally

```bash
node test-plural-parsing.js
```

Tests the German plural marker parsing logic with cases like:
- "die Adresse,-en" → "die Adresse (pl: die Adressen)"
- "der Apfel, -Ä" → "der Apfel (pl: die Äpfel)"
- "das Haus, -ä, er" → "das Haus (pl: die Häuser)"

## Common Development Tasks

### 1. Modifying Task Generation Logic

**File:** `api/v0/routes/generateTask.js`

When changing how tasks are generated:
1. Read the file first to understand current logic
2. Make changes using Edit tool
3. Test locally if possible (create test file)
4. Deploy with `./deploy.sh`
5. Verify with http://35.88.113.219:3000/level-stats

### 2. Adding New Vocabulary Words

**Files:** `wordlists/a1_vocabulary.json`, `a2_vocabulary.json`, `b1_vocabulary.json`

Format:
```json
{
  "word": "Adresse",
  "full_entry": "die Adresse, -en",
  "pos": "noun"
}
```

After adding words:
1. Deploy with `./deploy.sh` (will sync wordlists)
2. Check stats endpoint to verify new word count

### 3. Changing Progress Tracking

**File:** `api/v0/models/Progress.js`

When modifying schema or progression logic:
1. Update model schema if needed
2. Update `determineCurrentLevel()` function in generateTask.js if changing unlock criteria
3. Consider clearing database with `./clear-db.sh` for testing
4. Deploy changes

### 4. Frontend Changes

**Files:** `mobile/src/` directory

Frontend changes don't require deployment (mobile app is not deployed to EC2).
Only deploy backend changes that affect API endpoints.

## Level Progression System

**Mastery Criteria:**
- Word is "mastered" when: 7+ attempts AND 75%+ accuracy

**Level Unlocking:**
- A1: Always available
- A2: Unlocks when 75% of A1 words are mastered
- B1: Unlocks when 75% of A2 words are mastered

**Implementation:** See `determineCurrentLevel()` in generateTask.js

## German Plural Markers

The app parses German plural markers to display both singular and plural forms:

**Format:** `article word, pluralMarker`

**Examples:**
- `-en`: "die Adresse, -en" → "die Adressen"
- `-e`: "das Angebot, -e" → "die Angebote"
- `-s`: "das Auto, -s" → "die Autos"
- `-Ä`: "der Apfel, -Ä" → "die Äpfel" (umlaut only)
- `ä, er`: "das Haus, -ä, er" → "die Häuser" (umlaut + ending)
- `–` or `-`: No plural change (same as singular)

**Implementation:** `parsePluralForm()` function in generateTask.js

## Docker Container Management

### View Logs (Remote)
```bash
ssh -i ~/Documents/lenovo-ideapad.pem ubuntu@35.88.113.219 'cd /home/ubuntu/language-app && docker compose logs -f'
```

### Restart Services (Remote)
```bash
ssh -i ~/Documents/lenovo-ideapad.pem ubuntu@35.88.113.219 'cd /home/ubuntu/language-app && docker compose restart'
```

### Access API Container Shell (Remote)
```bash
ssh -i ~/Documents/lenovo-ideapad.pem ubuntu@35.88.113.219 'docker exec -it language-app-api sh'
```

### Access MongoDB Shell (Remote)
```bash
ssh -i ~/Documents/lenovo-ideapad.pem ubuntu@35.88.113.219 'docker exec -it language-app-mongo mongosh language-app'
```

## Troubleshooting

### "Failed to load level stats" Error

**Possible causes:**
1. Vocabulary files not mounted in Docker container
   - Check: Volume mount in docker-compose.prod.yml
   - Fix: Ensure `./wordlists:/app/wordlists:ro` is present

2. Wrong file path in code
   - Check: `loadVocabulary()` function path resolution
   - Container structure: `/app/routes/generateTask.js` with `/app/wordlists/`
   - Path should be: `path.join(__dirname, '..', 'wordlists', ...)`

3. Vocabulary files not deployed
   - Fix: Run `./deploy.sh` to sync wordlists

### Deployment Fails

1. Check OPENAI_API_KEY is set:
   ```bash
   echo $OPENAI_API_KEY
   ```

2. Check SSH key permissions:
   ```bash
   chmod 400 ~/Documents/lenovo-ideapad.pem
   ```

3. Check EC2 server connectivity:
   ```bash
   ssh -i ~/Documents/lenovo-ideapad.pem ubuntu@35.88.113.219
   ```

### Database Issues

1. Clear and restart:
   ```bash
   ./clear-db.sh
   ```

2. Check MongoDB is running:
   ```bash
   ssh -i ~/Documents/lenovo-ideapad.pem ubuntu@35.88.113.219 'docker ps | grep mongo'
   ```

## Git Workflow

**IMPORTANT:** Only create git commits when explicitly requested by the user.

When committing:
1. Run `git status` and `git diff` to see changes
2. Stage specific files (avoid `git add -A`)
3. Write clear commit messages explaining WHY, not just WHAT
4. Include co-author line: `Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>`
5. Use heredoc format for commit messages

**Never use:**
- Force push (unless explicitly requested)
- `--no-verify` flag (unless explicitly requested)
- `--amend` (create new commits instead)

## API Endpoints

- `POST /generate-task`: Generate a new word translation task
  - Body: `{ level: 'A1'|'A2'|'B1', taskType: 'multipleChoice'|'reverseTranslation' }`

- `POST /submit-answer`: Submit answer and update progress
  - Body: `{ targetWord, level, taskType, userAnswer, correctAnswer, previousLevel }`

- `GET /level-stats`: Get statistics for all levels
  - Returns: currentLevel, levelStats, overallAccuracy, totalWords, wordProgress

- `GET /tier-stats`: Legacy endpoint (maps to level-stats)

- `GET /health`: Health check endpoint

## Environment Variables

**Required:**
- `OPENAI_API_KEY`: OpenAI API key for translations

**Optional:**
- `AWS_ACCESS_KEY_ID`: AWS credentials (if using AWS services)
- `AWS_SECRET_ACCESS_KEY`: AWS credentials
- `AWS_REGION`: AWS region (default: us-east-1)
- `MONGO_URI`: MongoDB connection string (default: mongodb://mongo:27017/language-app)
- `PORT`: API port (default: 3000)

## Best Practices for Development

1. **Always read files before editing** to understand current state
2. **Test locally when possible** before deploying
3. **Deploy after backend changes** using ./deploy.sh
4. **Clear database when testing progression logic** to ensure clean state
5. **Use parallel tool calls** for independent operations (git status + git diff, multiple file reads)
6. **Don't create unnecessary files** - prefer editing existing files
7. **Avoid over-engineering** - only make requested changes
8. **Be careful with destructive actions** - confirm before force-push, database drops, etc.

## Notes for Claude

- This is a development environment, but uses a remote server for backend
- Frontend (mobile app) runs locally, backend runs on EC2
- Always deploy backend changes after editing API code
- Database can be freely cleared during development
- No need to ask permission for standard deploy/test operations
- The vocabulary lists are the source of truth - don't modify them without explicit request
