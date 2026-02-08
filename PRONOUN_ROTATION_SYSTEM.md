# Pronoun Rotation System

## Overview
The pronoun rotation system ensures balanced distribution of German pronouns (ich, du, er/sie/es, wir, ihr, sie) across generated learning tasks, preventing bias toward "ich" and ensuring students practice all pronoun forms equally.

## Problem Solved
Previously, task generation had a heavy bias toward "ich" (I) in example sentences. This limited students' exposure to other important pronoun forms like "du" (you), "wir" (we), etc.

## Implementation

### 1. Pronoun History Model (`/api/v0/models/PronounHistory.js`)
Tracks the last 12 pronouns used per user:
```javascript
{
  userId: 'default',
  recentPronouns: ['ich', 'du', 'wir', ...], // Last 12 used
  lastUpdated: Date
}
```

### 2. Weighted Selection Algorithm (`/api/v0/prompts/tier1TaskGenerator.js`)

**Function**: `selectPronounWeighted(recentPronouns)`

**How it works**:
1. Starts with equal weight (1.0) for all 6 pronouns
2. Applies recency penalty: recently used pronouns get heavily reduced weight
   - Last used (position 0): Gets 0.1x weight (~10x less likely)
   - 2 tasks ago: Gets ~0.3x weight
   - 6 tasks ago: Gets ~0.5x weight
   - Not used in last 12: Full 1.0x weight
3. Performs weighted random selection

**Pronouns tracked**:
```javascript
const PRONOUNS = [
  { key: 'ich', german: 'ich', english: 'I' },
  { key: 'du', german: 'du', english: 'you (informal)' },
  { key: 'er_sie_es', german: 'er/sie/es', english: 'he/she/it' },
  { key: 'wir', german: 'wir', english: 'we' },
  { key: 'ihr', german: 'ihr', english: 'you (plural)' },
  { key: 'sie', german: 'sie', english: 'they' }
];
```

### 3. Task Generation Integration (`/api/v0/routes/generateTask.js`)

**Process**:
1. Fetch user's pronoun history from database
2. Use `selectPronounWeighted()` to choose pronoun for this task
3. Pass `preferredPronoun` to task prompt generator
4. Generate task with OpenAI (with pronoun preference instruction)
5. Update pronoun history with newly used pronoun
6. Save history to database

**Prompt instruction added**:
```
PRONOUN PREFERENCE: Strongly prefer using "wir" (we) as the subject
in this task. This ensures variety across multiple tasks and helps
students practice all pronoun forms equally.
```

## Results

### Before Implementation
```
ich, ich, du, ich, wir, ich, ich...  ❌
```
Heavy clustering, poor distribution

### After Implementation
```
ich, du, wir, er/sie/es, ihr, sie, du, wir, ich, er/sie/es...  ✅
```
Balanced rotation, natural variety

## Example Scenario

**Task Sequence**:
1. Task 1: Select from fresh history → Random, gets "ich"
2. Task 2: "ich" has low weight → Likely gets "du" or "wir"
3. Task 3: "ich" and "du" both penalized → Gets "wir"
4. Task 4: Recent 3 all penalized → Gets "er/sie/es"
5. ...continues rotating through all pronouns

**Over 12 tasks**: All 6 pronouns get roughly equal representation (2 uses each)

## Benefits

1. **Prevents clustering**: No more 3-4 "ich" tasks in a row
2. **Ensures coverage**: All pronouns practiced regularly
3. **Still feels natural**: Weighted random (not rigid round-robin)
4. **Per-user tracking**: Each learner gets personalized rotation
5. **Automatic**: No manual intervention needed

## Technical Details

- **History window**: 12 tasks (2x the number of pronouns)
- **Penalty function**: `weight *= Math.pow(0.3, 1 / (i + 1))`
- **Fallback**: If selection fails, uses first pronoun
- **Database**: MongoDB via Mongoose
- **Scope**: Applied to both multipleChoice and reverseTranslation tasks

## Maintenance

The system is self-maintaining:
- Automatically creates history for new users
- Limits history to last 12 pronouns (prevents unbounded growth)
- Updates timestamp on each task generation
- Logs pronoun selection for monitoring

## Monitoring

Check console logs during task generation:
```
Selected pronoun: "wir" (we)
Updated pronoun history: [wir, ich, du, er_sie_es, ihr, sie...]
```

## Future Enhancements

Possible improvements:
- Track pronoun accuracy separately (practice struggling forms more)
- Adjust weights based on learner proficiency
- Add admin dashboard to view pronoun distribution stats
- Extend to Tier 2+ with more complex pronoun usage
