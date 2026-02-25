# Writing Assistant — Backend Technical Requirements (PoC)

## Overview

A backend service that powers a writing assistant with ghost-text suggestions. The core purpose is to reduce "tip of the tongue" moments by guiding writers — not replacing them. The system detects whether the user needs a word completion or a contextual bridge, then picks the right strategy accordingly.

---

## Endpoints

### 1. `POST /session`

Called **once** at the start of a writing session. Stores the writing context in cache and returns a session ID to be reused on every prediction request.

**Request Body**
```json
{
  "outline": "Brief description of what the article/piece is about",
  "style": "e.g. conversational, academic, journalistic",
  "tone": "e.g. calm, energetic, wise, playful"
}
```

**Response**
```json
{
  "sessionId": "abc123"
}
```

**Behavior**
- Generate a unique `sessionId` (UUID v4)
- Store `{ outline, style, tone }` in cache keyed by `sessionId`
- TTL: 24 hours
- Return `sessionId` to client

---

### 2. `POST /predict`

The core prediction endpoint. Called on every trigger event from the client (debounced, not per-keystroke).

**Request Body**
```json
{
  "sessionId": "abc123",
  "mode": "word" | "bridge",
  "precedingText": "last 500 characters of what the user has typed so far"
}
```

**Response**
```json
{
  "mode": "word" | "bridge",
  "suggestion": "lapsing faster than most experts",
  "confidence": 0.87,
  "cached": false
}
```

**Notes**
- `precedingText` max length: **500 characters**. Truncate from the left if longer (keep the most recent text)
- `confidence` can be mocked as `0.85` for PoC — reserved for future use
- `cached` is a debug flag indicating whether the response was served from cache
- If the session is not found in cache, return `404` with `{ "error": "Session not found or expired" }`
- If `precedingText` is empty, return `{ "suggestion": "", "cached": false }`

---

## Core Logic — `/predict`

### Step 1: Mode Detection (client-driven)

The client sends the mode explicitly. No server-side detection needed.

| Mode | When | Strategy |
|------|------|----------|
| `word` | Cursor is mid-word (no trailing space) | Local trie / dictionary lookup |
| `bridge` | Cursor is after a space — user is stuck | LLM call with session context |

---

### Step 2: Word Mode — Local Trie / Dictionary

- Extract the **last partial word** from `precedingText` (characters after the last space)
- Look up the trie for the best matching completion
- Return the **full completed word only** (not the whole preceding text)
- If no match found, return `{ "suggestion": "" }`

**Example**
```
precedingText: "The economy is col"
lastPartialWord: "col"
suggestion: "collapsing"
```

**Trie requirements for PoC**
- Load a standard English word list on server startup (e.g. `words-list` npm package or `/usr/share/dict/words`)
- In-memory trie, no external calls
- Lookup must complete in < 5ms

---

### Step 3: Bridge Mode — LLM Call

#### 3a. Fetch session context from cache
```
context = cache.get(sessionId)
// { outline, style, tone }
```
If not found → return 404.

#### 3b. Check prediction cache
Before calling LLM, check if an identical request was recently cached:
```
cacheKey = hash(sessionId + precedingText)
```
If hit → return cached suggestion with `"cached": true`

TTL for prediction cache: **5 minutes**

#### 3c. Build prompt

**System Prompt**
```
You are a writing assistant that helps writers find the right words.
Your job is to suggest the next 5-7 words that naturally bridge the 
current sentence — not complete it. You are a guide, not a ghostwriter.

Writing context:
- Style: {style}
- Tone: {tone}  
- Article outline: {outline}

Rules:
- Return ONLY the word suggestion, no punctuation at the end
- Suggest exactly 5-7 words
- Never complete the full sentence
- Never add explanation or commentary  
- Match the style and tone strictly
- If the preceding text already feels complete, return empty string
```

**User Prompt**
```
Continue this naturally: "{precedingText}"
```

#### 3d. LLM Configuration
- **Model**: `claude-haiku-4-5-20251001` (fast, cheap, good enough for short completions)
- **Max tokens**: `20` (hard cap — enough for 5-7 words, stops generation early)
- **Temperature**: `0.7` (some creativity, but not random)
- **No streaming** for PoC

#### 3e. Post-process response
- Strip leading/trailing whitespace
- Strip any trailing punctuation (`.`, `,`, `!`, `?`)
- If response is empty or LLM returns refusal/explanation → return `{ "suggestion": "" }`

---

## Caching Strategy

Use **Redis** for session and prediction cache. In-memory (e.g. a simple JS `Map`) is acceptable for PoC if Redis is not available.

| Cache Type | Key | TTL |
|---|---|---|
| Session context | `session:{sessionId}` | 24 hours |
| Prediction result | `predict:{hash(sessionId + precedingText)}` | 5 minutes |

---

## Error Handling

| Scenario | HTTP Status | Response |
|---|---|---|
| Session not found | 404 | `{ "error": "Session not found or expired" }` |
| Empty precedingText | 200 | `{ "suggestion": "", "cached": false }` |
| LLM failure / timeout | 200 | `{ "suggestion": "", "cached": false }` (fail silently — don't break the writing experience) |
| Invalid mode value | 400 | `{ "error": "mode must be word or bridge" }` |
| Missing required fields | 400 | `{ "error": "missing required field: {field}" }` |

LLM errors should **always fail silently** from the user's perspective. Ghost text disappearing is better than an error breaking the editor.

---

## Tech Stack (Recommended for PoC)

| Layer | Choice | Reason |
|---|---|---|
| Runtime | Node.js + TypeScript | Fast to scaffold, good LLM SDK support |
| Framework | Fastify or Express | Lightweight |
| LLM SDK | `@anthropic-ai/sdk` | Direct access to Haiku |
| Cache | Redis or in-memory Map | Redis preferred, Map acceptable for PoC |
| Trie | `trie-search` npm package | Simple, in-memory |

---

## Project Structure (Suggested)

```
/src
  /routes
    session.ts       # POST /session
    predict.ts       # POST /predict
  /services
    trie.ts          # Word mode — trie lookup
    llm.ts           # Bridge mode — LLM call + prompt builder
    cache.ts         # Redis or in-memory cache wrapper
  /utils
    hash.ts          # Cache key generation
    textUtils.ts     # precedingText trimming, post-processing
  index.ts           # Server bootstrap
```

---

## Non-Goals for PoC

- Streaming responses
- Multiple suggestion variants
- User feedback / ignored suggestion tracking
- Rolling summary compression of long documents
- Authentication / user accounts
- Rate limiting (add before production)
- Fine-tuning the model

---

## Key Constraints Summary

- `precedingText` max: **500 characters**
- LLM max output tokens: **20**
- Suggestion word count target: **5–7 words**
- Prediction cache TTL: **5 minutes**
- Session TTL: **24 hours**
- LLM must fail silently — never surface errors to the writing experience
