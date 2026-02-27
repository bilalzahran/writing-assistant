# Writing Assistant — Improvement Tasks for Claude Code

This file contains all the changes needed to improve the writing assistant app. Implement them in order as each builds on the previous.

## Task 1 — Add Position and Stage Detection Utilities

### Context
The backend now needs `position` and `stage` to select the right prompt variant. These are derived client-side from the current editor content and sent with every bridge mode request.

### Add these two utility functions to `lib/detectMode.ts` or a new `lib/writingStage.ts`

```ts
// Detects where in the article the writer currently is
function detectPosition(fullText: string): "opening" | "middle" | "closing" {
  const words = fullText.trim().split(/\s+/).filter(Boolean).length
  if (words < 50) return "opening"
  if (words < 300) return "middle"
  return "closing"
}

// Detects how much the writer has written to select correct prompt variant
function detectStage(precedingText: string): "start" | "establish" | "continue" {
  const words = precedingText.trim().split(/\s+/).filter(Boolean).length
  if (words === 0) return "start"
  if (words < 20) return "establish"
  return "continue"
}
```

### Update the `/predict` request payload type

```ts
interface PredictRequest {
  sessionId: string
  mode: "word" | "bridge"
  precedingText: string
  position?: "opening" | "middle" | "closing"   // add this
  stage?: "start" | "establish" | "continue"     // add this
}
```

---

## Task 3 — Improve Backend Prompt with Stage-Based Variants

### Context
The current single prompt template produces poor suggestions, especially on the first paragraph and blank page. The fix is a `promptBuilder` function that selects the right prompt based on `stage` and `position`.

### What to Change

In the backend prediction service (likely `services/llm.ts`), replace the single prompt template with a `promptBuilder` function that accepts `{ outline, style, tone, precedingText, stage, position }` and returns the correct system + user prompt pair.

### The 5 Prompt Variants — use these exactly

**Variant 1: `stage=start`** (blank page)
```
System:
You are a writing assistant helping a writer who is staring at a blank page.

Their piece is about: "{outline}"
Style: {style}
Tone: {tone}

Suggest the first 5-7 words of an opening sentence that:
- Hooks the reader immediately
- Feels natural in a {tone} voice
- Sets up the premise described in the outline

Return ONLY the words. No punctuation at the end. No explanation. No preamble.
If you cannot generate a helpful suggestion, return an empty string.

User:
Give me the first words to start this piece.
```

---

**Variant 2: `stage=establish`** (< 20 words written)
```
System:
You are a writing assistant helping a writer establish their opening.

Their piece is about: "{outline}"
Style: {style}
Tone: {tone}

Suggest the next 5-7 words that:
- Feel like a natural extension of what they started
- Stay consistent with their opening voice
- Move the thought forward without completing it

Return ONLY the words. No punctuation at the end. No explanation. No preamble.
If the thought already feels complete, return an empty string.

User:
Continue this naturally: "{precedingText}"
```

---

**Variant 3: `stage=continue, position=opening`** (mid first paragraph)
```
System:
You are a writing assistant helping a writer build momentum in their opening paragraph.

Their piece is about: "{outline}"
Style: {style}
Tone: {tone}

Suggest the next 5-7 words that:
- Maintain the voice and energy they've established
- Help develop or support the opening premise
- Bridge naturally to their next thought without finishing the sentence

Return ONLY the words. No punctuation at the end. No explanation. No preamble.
If the sentence already feels complete, return an empty string.

User:
Continue this naturally: "{precedingText}"
```

---

**Variant 4: `stage=continue, position=middle`** (body of article)
```
System:
You are a writing assistant helping a writer maintain flow through the body of their piece.

Their piece is about: "{outline}"
Style: {style}
Tone: {tone}

Suggest the next 5-7 words that:
- Keep the argument or narrative moving forward
- Feel consistent with the tone and style already established
- Act as a bridge — not a conclusion

Return ONLY the words. No punctuation at the end. No explanation. No preamble.
If the sentence already feels complete, return an empty string.

User:
Continue this naturally: "{precedingText}"
```

---

**Variant 5: `stage=continue, position=closing`** (final paragraph)
```
System:
You are a writing assistant helping a writer bring their piece to a close.

Their piece is about: "{outline}"
Style: {style}
Tone: {tone}

Suggest the next 5-7 words that:
- Feel like the piece is moving toward resolution
- Carry the same tone without introducing new ideas
- Help the writer land the piece cleanly

Return ONLY the words. No punctuation at the end. No explanation. No preamble.
If the sentence already feels complete, return an empty string.

User:
Continue this naturally: "{precedingText}"
```

---

### The promptBuilder Function

```ts
function promptBuilder({ outline, style, tone, precedingText, stage, position }) {
  if (stage === 'start') return variant1
  if (stage === 'establish') return variant2
  if (stage === 'continue' && position === 'opening') return variant3
  if (stage === 'continue' && position === 'middle') return variant4
  if (stage === 'continue' && position === 'closing') return variant5
  return variant4 // safe fallback
}
```

### Update the LLM call

Pass `stage` and `position` from the request body into `promptBuilder`. Both fields are optional — if not provided, fall back to detecting them server-side:

```ts
const stage = req.body.stage ?? detectStage(req.body.precedingText)
const position = req.body.position ?? 'middle' // safe fallback
```

---

## Summary of All Changes

| File | Change |
|---|---|
| `Editor.tsx` | Debounce only fires for word mode |
| `slashCommandExtension.ts` | Add `/continue` command that triggers bridge mode |
| `usePrediction.ts` | Accept and forward `position` and `stage` |
| `lib/writingStage.ts` | Add `detectPosition()` and `detectStage()` |
| `services/llm.ts` | Replace single prompt with `promptBuilder` using 5 variants |
| `routes/predict.ts` | Accept `position` and `stage` in request body |

Implement in this order: Task 2 → Task 3 → Task 1. Utilities first, then backend, then frontend.
