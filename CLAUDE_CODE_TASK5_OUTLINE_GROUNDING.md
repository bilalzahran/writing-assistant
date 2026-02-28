# Writing Assistant — Task 5: Outline Grounding for Better Suggestions

## Context

The current suggestion quality feels off because the LLM treats the outline as loose background context. It has no mechanism to locate itself within the outline before generating a suggestion — so it drifts and produces generic output.

This task adds **outline grounding** to both `/predict` (bridge mode) and `/next`:

- `/predict` (bridge mode) → Option B: single call, instruct the model to locate itself first
- `/next` → Option C: client detects current outline section, sends it explicitly in payload

---

## Backend Changes

### 1. Update `promptBuilder` in `llm.ts` — Bridge Mode (Option B)

In every bridge mode prompt variant (start, establish, opening, middle, closing), add an explicit grounding instruction before the suggestion rule.

**The key addition to add to ALL 5 variants — insert after the outline field, before the rules:**

```
Before generating your suggestion, identify which specific part of 
the outline the writer is currently working on based on their 
preceding text. Use that section to guide your suggestion — 
not the outline in general.
```

**Example — updated `stage=start` variant:**

```
System:
You are a writing assistant helping a writer who is staring at a blank page.

Their piece is about: "{outline}"
Style: {style}
Tone: {tone}

Before generating your suggestion, identify which specific part of
the outline the writer is currently working on based on their
preceding text. Use that section to guide your suggestion —
not the outline in general.

Suggest the first 5-7 words of an opening sentence that:
- Hooks the reader immediately
- Feels natural in a {tone} voice
- Sets up the premise described in the outline

Return ONLY the words. No punctuation at the end. No explanation. No preamble.
If you cannot generate a helpful suggestion, return an empty string.

User:
Give me the first words to start this piece.
```

Apply this same grounding instruction to all 5 variants in `promptBuilder`. The instruction always goes after the outline field and before the rules list. Do not change anything else in the existing variants.

---

### 2. Update `/next` Route and Prompt — (Option C)

The `/next` endpoint now accepts a new optional field `currentSection` in the request body. This is the outline section the writer is currently transitioning *from*, detected client-side.

**Updated request shape:**

```json
{
  "sessionId": "abc123",
  "lastParagraph": "Rather than load everything into memory, stream your data one by one.",
  "currentSection": "streaming as a solution — rather than loading everything, process data one row at a time"
}
```

**Updated `/next` prompt — replace the existing prompt entirely:**

```
System:
You are a writing assistant helping a writer transition to their next section.

Their full outline: "{outline}"
Style: {style}
Tone: {tone}

The writer just finished working on this section of the outline:
"{currentSection}"

Their last paragraph:
"{lastParagraph}"

Based on the outline, identify what logically comes AFTER "{currentSection}".
That is the territory for your suggestion.

Return a JSON object with exactly two fields:
- "phrase": the first 5-7 words to open the next section. Natural, {tone} voice. No punctuation at the end.
- "angle": one concrete sentence describing the specific topic or argument to develop next. Reference actual concepts from the outline — be specific, not generic.

Return ONLY valid JSON. No explanation. No preamble. No markdown backticks.
If you cannot determine a helpful next section, return: {"phrase": "", "angle": ""}

User:
What should I write next?
```

**Handle missing `currentSection` gracefully:**

```ts
const currentSection = req.body.currentSection ?? ''

// if empty, fall back to a version without it
// just remove the "writer just finished working on this section" line from the prompt
```

---

## Frontend Changes

### 3. Add `detectOutlineSection` Utility

Add this function to `lib/writingStage.ts`:

```ts
export function detectOutlineSection(
  outline: string,
  precedingText: string
): string {
  if (!outline || !precedingText) return ''

  const sections = outline
    .split(/\n+/)
    .map(s => s.trim())
    .filter(Boolean)

  if (sections.length === 0) return ''

  const recentWords = precedingText
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 4) // ignore short/stop words

  // score each section by keyword overlap with precedingText
  const scored = sections.map(section => {
    const sectionWords = section.toLowerCase().split(/\s+/).filter(w => w.length > 4)
    const overlap = sectionWords.filter(w => recentWords.includes(w)).length
    return { section, overlap }
  })

  // return the section with the highest keyword overlap
  const best = scored.sort((a, b) => b.overlap - a.overlap)[0]

  // only return if there's at least some overlap, else return first section
  return best.overlap > 0 ? best.section : sections[0]
}
```

### 4. Update `/next` Slash Command in `slashCommandExtension.ts`

When `/next` is triggered, extract `currentSection` and include it in the API call:

```ts
// inside the /next command handler
const lastParagraph = getLastParagraph(editor)
const fullText = editor.getText()
const outline = session.outline // however you currently access session context client-side

const currentSection = detectOutlineSection(outline, lastParagraph)

const { phrase, angle } = await fetchNext(sessionId, lastParagraph, currentSection)
```

### 5. Update `fetchNext` in `lib/api.ts`

Add `currentSection` as an optional parameter:

```ts
export async function fetchNext(
  sessionId: string,
  lastParagraph: string,
  currentSection?: string
): Promise<{ phrase: string; angle: string }> {
  try {
    const res = await fetch('/api/next', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, lastParagraph, currentSection })
    })
    const data = await res.json()
    return {
      phrase: data.phrase ?? '',
      angle: data.angle ?? ''
    }
  } catch {
    return { phrase: '', angle: '' }
  }
}
```

---

## Files to Modify

| File | Change |
|---|---|
| `services/llm.ts` | Add grounding instruction to all 5 `promptBuilder` variants |
| `routes/next.ts` | Accept `currentSection` in request body, pass to prompt |
| `services/llm.ts` | Replace `/next` prompt with updated version using `currentSection` |
| `lib/writingStage.ts` | Add `detectOutlineSection()` utility |
| `slashCommandExtension.ts` | Extract and pass `currentSection` when `/next` fires |
| `lib/api.ts` | Add `currentSection` param to `fetchNext()` |

---

## Implementation Order

```
1. Backend first — update promptBuilder (bridge mode grounding)
2. Backend — update /next prompt and route to accept currentSection
3. Frontend — add detectOutlineSection utility
4. Frontend — update /next slash command to extract and send currentSection
5. Frontend — update fetchNext to pass currentSection
```

Test backend changes manually with curl before touching the frontend.

---

## How to Test

**Bridge mode grounding:**
- Write 2-3 sentences clearly about one section of your outline
- Trigger `/continue`
- Suggestion should reference concepts from that specific outline section, not the outline broadly

**`/next` with `currentSection`:**
- Finish a paragraph clearly about one outline section
- Trigger `/next`
- The `angle` in the response should reference what comes *after* that section in the outline, not a random part of it

**Edge case — outline with no keyword overlap:**
- Write something vague that doesn't match any outline section keywords
- `detectOutlineSection` should fall back to `sections[0]`
- `/next` should still return a reasonable suggestion based on the first outline section
