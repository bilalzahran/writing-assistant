# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GuidedWrite is a writing assistant that provides ghost-text suggestions to reduce "tip of the tongue" moments. It does not replace writers — it guides them. The app is a monorepo with a Fastify backend and a React/Tiptap frontend.

## Commands

### Backend (`backend/`)

```bash
# Development (hot reload with tsx)
npm run dev

# Type check only
npm run typecheck

# Build to dist/
npm run build

# Run compiled build
npm run start
```

Environment: copy `backend/.env.example` to `backend/.env` and set `ANTHROPIC_API_KEY`.

### Frontend (`frontend/`)

```bash
# Development server (http://localhost:5173)
npm run dev

# Type check + production build
npm run build

# Lint
npm run lint
```

The frontend talks directly to `http://localhost:3000` (hardcoded in `src/lib/api.ts`). Both servers must be running during development.

## Architecture

### Data flow

1. User fills out **SessionSetup** (outline, style, tone) → `POST /session` → backend stores context in in-memory cache, returns `sessionId`
2. User types in **Editor** (Tiptap) → `usePrediction` hook fires debounced requests → `POST /predict` → ghost text appears at cursor
3. User presses **Tab** to accept ghost text, **Escape** to dismiss it, or types to override it

### Two prediction modes

| Mode | Trigger | Backend behaviour |
|------|---------|------------------|
| `word` | Last char is a letter/digit (mid-word) | LLM call: one-word completion, `max_tokens: 5`, `temperature: 0.3` |
| `bridge` | Last char is space/newline (stuck between thoughts) | LLM call: 5–7 word bridge, `max_tokens: 20`, `temperature: 0.7` |

Mode is detected client-side in `frontend/src/lib/detectMode.ts`. Bridge mode also receives `position` (opening/middle/closing, based on total word count) and `stage` (start/establish/continue, based on preceding word count), which select different system prompts in `backend/src/services/llm.ts`.

### Backend services

- **`services/cache.ts`** — in-memory `Map`-based cache with TTL. Sessions: 24h (`session:{sessionId}`). Predictions: 5min (`predict:{hash}`).
- **`services/llm.ts`** — `getWordSuggestion` and `getBridgeSuggestion`. Both use `claude-haiku-4-5-20251001`. LLM errors always return `""` silently.
- **`routes/session.ts`** — `POST /session`: stores context, returns UUID.
- **`routes/predict.ts`** — `POST /predict`: validates, checks prediction cache, dispatches to word or bridge handler.
- **`utils/textUtils.ts`** — `truncatePrecedingText` (500 char cap), `postProcessSuggestion` (trim + strip trailing punctuation).

### Frontend extensions

- **`extensions/ghostTextExtension.ts`** — ProseMirror `Plugin` that renders ghost text as a `Decoration.widget` at cursor. Communicate via `tr.setMeta(GhostTextPluginKey, suggestion)`.
- **`extensions/slashCommandExtension.ts`** — Slash command menu via `@tiptap/suggestion` + tippy.js. `/nudge` immediately triggers a bridge prediction.
- **`extensions/calloutExtension.ts`** — Custom callout block node.

### Key frontend hooks/libs

- **`hooks/usePrediction.ts`** — manages suggestion state, debounces word predictions (700ms), cancels in-flight requests on new input.
- **`lib/writingStage.ts`** — `detectPosition` (word count thresholds: <50 opening, <300 middle, else closing) and `detectStage` (word count of preceding text: 0 = start, <20 = establish, else continue).
- **`lib/getPrecedingText.ts`** — extracts last 500 chars at cursor from the Tiptap editor state.

## Key constraints

- `precedingText` is always capped at **500 characters** (both client-side in `getPrecedingText` and server-side in `truncatePrecedingText`)
- LLM failures always fail silently — never surface errors to the writing experience
- Ghost text is dismissed on: cursor move without typing, blur, Escape, or arrow keys
