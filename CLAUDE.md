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

### App views and navigation

The app has three top-level views managed in `App.tsx`:
- **`list`** — `PostList` component: landing page showing all documents
- **`setup`** — `SessionSetup` component: form for outline, style, tone before creating a new post
- **`editor`** — `Editor` component: the full writing environment

URL routing is manual via `history.pushState`. `/posts/:id` deep-links directly into the editor for a post.

### Editor layout (VS Code-style)

`Editor.tsx` has an activity bar on the far left with two nav modes (`activeNav` state):

- **Session view** (default): collapsible session sidebar (outline/style/tone) + Tiptap editor + status bar
- **Docs view**: full-width inline document table (lazy-loaded when switching to this tab)

The activity bar also has a disabled "Account" button at the bottom (placeholder for future auth).

### Data flow

1. User fills out **SessionSetup** (outline, style, tone) → `POST /session` → backend stores context in in-memory cache, returns `sessionId`
2. User types in **Editor** (Tiptap) → `usePrediction` hook fires debounced requests → `POST /predict` → ghost text appears at cursor
3. User presses **Tab** to accept ghost text, **Escape** to dismiss it, or types to override it
4. `/next` slash command → `POST /next` → returns a next-section suggestion (`phrase` + `angle`)

### Two prediction modes

| Mode | Trigger | Backend behaviour |
|------|---------|------------------|
| `word` | Last char is a letter/digit (mid-word) | LLM call: one-word completion, `max_tokens: 5`, `temperature: 0.3` |
| `bridge` | Last char is space/newline (stuck between thoughts) | LLM call: 5–7 word bridge, `max_tokens: 20`, `temperature: 0.7` |

Mode is detected client-side in `frontend/src/lib/detectMode.ts`. Bridge mode also receives `position` (opening/middle/closing, based on total word count) and `stage` (start/establish/continue, based on preceding word count), which select different system prompts in `backend/src/services/llm.ts`.

### Backend services

- **`services/cache.ts`** — in-memory `Map`-based cache with TTL. Sessions: 24h (`session:{sessionId}`). Predictions: 5min (`predict:{hash}`).
- **`services/llm.ts`** — `getWordSuggestion`, `getBridgeSuggestion`, `getNextSuggestion`. All use `claude-haiku-4-5-20251001`. LLM errors always return `""` silently.
- **`routes/session.ts`** — `POST /session`: stores context, returns UUID.
- **`routes/predict.ts`** — `POST /predict`: validates, checks prediction cache, dispatches to word or bridge handler.
- **`routes/next.ts`** — `POST /next`: takes `sessionId`, `lastParagraph`, optional `currentSection`; returns `{ phrase, angle }`.
- **`routes/posts.ts`** — CRUD for posts (`GET /posts`, `GET /posts/:id`, `POST /posts`, `PUT /posts/:id`, `DELETE /posts/:id`).
- **`utils/textUtils.ts`** — `truncatePrecedingText` (500 char cap), `postProcessSuggestion` (trim + strip trailing punctuation).

### Frontend components

- **`components/Editor.tsx`** — main editor with activity bar, session sidebar, Tiptap, docs table, status bar
- **`components/PostList.tsx`** — landing document list (used as the `list` view)
- **`components/SessionSetup.tsx`** — session form (outline, style, tone)
- **`components/SlashMenu.tsx`** — floating slash command menu (rendered by slashCommandExtension)
- **`components/CodeBlockComponent.tsx`** — custom node view for syntax-highlighted code blocks

### Frontend extensions

- **`extensions/ghostTextExtension.ts`** — ProseMirror `Plugin` that renders ghost text as a `Decoration.widget` at cursor. Communicate via `tr.setMeta(GhostTextPluginKey, { suggestion, angle })`.
- **`extensions/slashCommandExtension.ts`** — Slash command menu via `@tiptap/suggestion` + tippy.js. `/nudge` triggers bridge prediction; `/next` triggers next-section suggestion.
- **`extensions/calloutExtension.ts`** — Custom callout block node.

### Key frontend hooks/libs

- **`hooks/usePrediction.ts`** — manages suggestion state, debounces word predictions (700ms), cancels in-flight requests on new input. Exposes `triggerPrediction`, `triggerBridgePrediction`, `setSuggestion`, `clearSuggestion`.
- **`hooks/useSession.ts`** — session creation, `initSession`, `clearSession`, persists `sessionId` in localStorage.
- **`lib/writingStage.ts`** — `detectPosition` (word count thresholds: <50 opening, <300 middle, else closing), `detectStage` (preceding text word count: 0 = start, <20 = establish, else continue), `getLastParagraph`, `detectOutlineSection`.
- **`lib/getPrecedingText.ts`** — extracts last 500 chars at cursor from the Tiptap editor state.

## Key constraints

- `precedingText` is always capped at **500 characters** (both client-side in `getPrecedingText` and server-side in `truncatePrecedingText`)
- LLM failures always fail silently — never surface errors to the writing experience
- Ghost text is dismissed on: cursor move without typing, blur, Escape, or arrow keys
