# Writing Assistant — Task 4: `/next` Endpoint & Section Transition Feature

This document covers the implementation of the `/next` feature — a new slash command and endpoint that helps writers transition to their next section when they've finished a thought and don't know where to go next.

---

## Overview

This is separate from `/continue` (bridge mode). The two commands have distinct intents:

| Command | Intent | Trigger moment |
|---|---|---|
| `/continue` | Help me finish this sentence | Mid-sentence, stuck on words |
| `/next` | Help me start the next section | After finishing a paragraph, blank line |

---

## Backend — New Endpoint `POST /next`

### Request

```json
{
  "sessionId": "abc123",
  "lastParagraph": "Rather than load everything into memory, stream your data one by one."
}
```

**Notes**
- `sessionId` — same session cache lookup as `/predict`, fetch `{ outline, style, tone }`
- `lastParagraph` — the last completed paragraph before the cursor. Max 500 characters, truncate from left if longer.
- No `mode`, no `precedingText`, no `stage` — this endpoint is purpose-built, keep it clean.

### Response

```json
{
  "phrase": "The beauty of io.Reader is",
  "angle": "explain how the interface abstracts the data source, making streaming composable",
  "cached": false
}
```

**Notes**
- `phrase` — 5-7 words to open the next section. Goes into ghost text inline.
- `angle` — one sentence describing the topic/argument the writer should develop. Shown as a muted hint below the ghost text, never inserted into the document.
- `cached` — debug flag, same as `/predict`.
- If session not found → `404 { "error": "Session not found or expired" }`
- If LLM fails or returns unparseable JSON → return `{ "phrase": "", "angle": "", "cached": false }` silently.

### Cache Key

```ts
key = hash(sessionId + lastParagraph)
```

TTL: 5 minutes — same as `/predict`.

### LLM Configuration

- **Model**: `claude-haiku-4-5-20251001`
- **Max tokens**: `120` — enough for both fields, hard cap
- **Temperature**: `0.7`
- **No streaming**

### The Prompt

```
System:
You are a writing assistant helping a writer transition to their next section.

Their piece is about: "{outline}"
Style: {style}
Tone: {tone}

The writer just finished this paragraph:
"{lastParagraph}"

Your job is to help them open the next section. Return a JSON object with exactly two fields:
- "phrase": the first 5-7 words to open the next section. Should feel like a natural continuation of the article's voice. No punctuation at the end.
- "angle": one sentence describing the specific topic or argument the writer should develop in this next section. This is a writing compass, not the actual text. Be specific and concrete — reference actual concepts from the outline.

Base the angle strictly on the outline — what logically comes next after what they just wrote.

Return ONLY valid JSON. No explanation. No preamble. No markdown backticks.
If you cannot determine a helpful next section, return: {"phrase": "", "angle": ""}

User:
What should I write next?
```

### Post-processing

```ts
try {
  const raw = llmResponse.trim()
  const parsed = JSON.parse(raw)
  return {
    phrase: parsed.phrase?.trim().replace(/[.,!?]$/, '') ?? '',
    angle: parsed.angle?.trim() ?? '',
    cached: false
  }
} catch {
  return { phrase: '', angle: '', cached: false }
}
```

Always wrap `JSON.parse` in try/catch — if the LLM returns anything other than valid JSON, fail silently.

---

## Frontend — `/next` Slash Command

### Add to Slash Command Menu

Add `/next` as a new entry in `slashCommandExtension.ts` alongside `/continue`:

| Command | Label | Description shown in menu |
|---|---|---|
| `/continue` | Continue | Finish your current sentence |
| `/next` | Next section | Get direction for your next paragraph |

### Client-side: Extract Last Paragraph

Add this utility to `lib/writingStage.ts`:

```ts
export function getLastParagraph(editor: Editor): string {
  const text = editor.getText()
  const paragraphs = text.split(/\n+/).filter(p => p.trim().length > 0)
  const last = paragraphs[paragraphs.length - 1] ?? ''
  return last.slice(-500) // max 500 chars
}
```

### API Call

Add `fetchNext` to `lib/api.ts`:

```ts
export async function fetchNext(
  sessionId: string,
  lastParagraph: string
): Promise<{ phrase: string; angle: string }> {
  try {
    const res = await fetch('/api/next', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, lastParagraph })
    })
    const data = await res.json()
    return {
      phrase: data.phrase ?? '',
      angle: data.angle ?? ''
    }
  } catch {
    return { phrase: '', angle: '' } // always fail silently
  }
}
```

### State — Add Angle to Editor State

```ts
interface EditorState {
  sessionId: string
  suggestion: string        // ghost text phrase (used by both /continue and /next)
  angle: string             // new — direction hint, only set by /next
  isLoadingPrediction: boolean
}
```

When `/next` is triggered:
```ts
const { phrase, angle } = await fetchNext(sessionId, lastParagraph)
setSuggestion(phrase)
setAngle(angle)
```

When user types, presses Tab, or Escape:
```ts
setSuggestion('')
setAngle('')  // always clear both together
```

---

## Frontend — Rendering the Angle Hint

The angle is rendered as a **block decoration** (ProseMirror widget) below the cursor line. It is read-only — it never gets inserted into the document.

### Update `ghostTextExtension.ts`

The extension currently handles one inline decoration for the phrase. Extend it to also render a block widget for the angle when present.

```ts
// phrase → existing inline decoration at cursor position (unchanged)

// angle → new block widget rendered after the current paragraph node
if (angle) {
  const angleWidget = Decoration.widget(cursorPos, () => {
    const el = document.createElement('div')
    el.className = 'angle-hint'
    el.textContent = `→ ${angle}`
    return el
  }, { side: 1 }) // side: 1 renders after cursor

  decorations.push(angleWidget)
}
```

### Styles

Add to your global CSS or Tiptap editor styles:

```css
.angle-hint {
  color: var(--stone-300);
  font-style: italic;
  font-size: 0.875rem;
  padding-left: 1rem;
  margin-top: 2px;
  pointer-events: none;
  user-select: none;
  display: block;
}
```

### Visual Hierarchy (What the User Sees)

```
  ...stream your data one by one.

  The beauty of io.Reader is|                        ← ghost phrase, stone-400, italic, inline
  → explain how the interface abstracts the          ← angle hint, stone-300, italic, smaller
    data source, making streaming composable         
```

Three distinct visual layers:
- **Real text** — full opacity, normal weight
- **Ghost phrase** — `stone-400`, italic, inline after cursor, accepted with Tab
- **Angle hint** — `stone-300`, italic, `0.875rem`, block below phrase, never accepted

---

## Behavior Rules

| Event | Phrase | Angle |
|---|---|---|
| `/next` triggered | Appears inline after cursor | Appears below as block hint |
| `Tab` pressed | Inserted into document | Disappears |
| Any key typed | Disappears | Disappears |
| `Escape` pressed | Disappears | Disappears |
| Editor loses focus | Disappears | Disappears |

**The angle is never inserted into the document under any circumstance.**

---

## Files to Create or Modify

| File | Change |
|---|---|
| `routes/next.ts` | New route handler for `POST /next` |
| `services/llm.ts` | Add `buildNextPrompt()` function alongside existing `promptBuilder` |
| `lib/api.ts` | Add `fetchNext()` function |
| `lib/writingStage.ts` | Add `getLastParagraph()` utility |
| `slashCommandExtension.ts` | Add `/next` command entry |
| `ghostTextExtension.ts` | Extend to render angle block widget alongside phrase decoration |
| `Editor.tsx` | Add `angle` state, pass to ghost text extension, clear on typing |

---

## Non-Goals for This Task

- The angle is never editable
- No "use this angle" button for PoC
- No history of previous angles
- No multi-section lookahead (only one next section at a time)
