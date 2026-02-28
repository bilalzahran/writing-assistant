# Writing Assistant — Task 6: Auto-Derive Thesis at Session Creation

## Context

Suggestion quality is still drifting because the LLM only knows the article's **topic** (outline) but not its **argument** (thesis). When the writer is mid-sentence setting up a contrast or solution, the model pattern-matches to generic phrases instead of pointing toward the article's specific answer.

Example of the problem:
```
Preceding text: "So how to solve this problem? rather than"
Current suggestion: "treating everything as one monolithic block"  ← generic
Expected suggestion: "loading it all at once, stream"              ← grounded in article's answer
```

The fix is to automatically derive a concrete thesis from the outline at session creation — one LLM call, happens once, stored in session cache alongside outline/style/tone. The user never sees it or fills it in.

---

## Why Thesis is Separate from Outline

| Field | Purpose | Example |
|---|---|---|
| `outline` | What the article is about (topic) | "How Go's io package reduces memory usage" |
| `thesis` | What the article argues (answer) | "By streaming with io.Reader instead of loading all at once, memory drops from GB to MB" |

The outline is abstract. The thesis is concrete. The model needs the concrete answer to generate suggestions that point toward it.

---

## Backend Changes

### 1. Update `POST /session` Route

After receiving the session payload, make one LLM call to derive the thesis. Store it in the session cache alongside the other fields. The client never sends or receives `thesis` — it's internal.

```ts
// routes/session.ts

const { outline, style, tone } = req.body

// derive thesis silently
const thesis = await deriveThesis(outline, style, tone)

// store everything in cache
cache.set(`session:${sessionId}`, {
  outline,
  style,
  tone,
  thesis  // new field
})

return { sessionId }
```

### 2. Add `deriveThesis` Function to `services/llm.ts`

```ts
export async function deriveThesis(
  outline: string,
  style: string,
  tone: string
): Promise<string> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 80,
      messages: [
        {
          role: 'user',
          content: `Given this article outline: "${outline}"
Style: ${style} | Tone: ${tone}

In one sentence, state the concrete argument or solution this article makes.
Be specific — reference actual methods, tools, or outcomes mentioned in the outline.
If the outline mentions specific technologies, libraries, or metrics, include them.

Return ONLY the one sentence. No preamble. No punctuation at the end.`
        }
      ]
    })

    const text = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
      .trim()

    return text ?? ''
  } catch {
    return '' // fail silently — session still works without thesis
  }
}
```

**Notes:**
- `max_tokens: 80` — one sentence is enough, hard cap keeps it fast
- Fails silently — if derivation fails, session still creates successfully, just without thesis enrichment
- Called once per session, not per prediction — latency cost is acceptable

### 3. Update All Prompt Variants in `promptBuilder` — `services/llm.ts`

In every prompt variant (all 5 stage/position combinations), add the thesis line after the outline field.

**The line to add to every variant:**

```
The article's core argument: "{thesis}"
```

Place it immediately after the outline line, before the grounding instruction from Task 5.

**Example — updated `stage=start` variant showing placement:**

```
System:
You are a writing assistant helping a writer who is staring at a blank page.

Their piece is about: "{outline}"
The article's core argument: "{thesis}"
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

Apply the same `The article's core argument: "{thesis}"` line to all 5 variants. If `thesis` is empty string, omit the line entirely — do not inject an empty field into the prompt.

```ts
const thesisLine = thesis 
  ? `The article's core argument: "${thesis}"` 
  : ''
```

### 4. Update `/next` Prompt in `services/llm.ts`

Add thesis to the `/next` prompt as well, same placement — after outline, before the current section line:

```
Their full outline: "{outline}"
The article's core argument: "{thesis}"
Style: {style}
Tone: {tone}

The writer just finished working on this section of the outline:
"{currentSection}"
...
```

---

## How to Test

**Verify thesis derivation:**

Call `POST /session` with your Go io.Reader article context:
```json
{
  "outline": "How Go's io package can reduce memory usage on production",
  "style": "conversational",
  "tone": "calm"
}
```

Check the session cache directly — `thesis` should be something like:
> *"By using Go's io.Reader and io.Writer interfaces to stream data instead of loading it all at once, memory usage drops from gigabytes to megabytes in production"*

**Verify suggestion improvement:**

Use this preceding text to trigger `/continue`:
```
"So how to solve this problem? rather than"
```

Before this task: suggestion is generic — *"treating everything as one monolithic block"*

After this task: suggestion should reference streaming or io — *"loading it all at once, stream"* or *"reading everything upfront, process"*

**Verify graceful fallback:**

Temporarily break the `deriveThesis` call (throw an error). Session creation should still succeed and return a `sessionId`. Suggestions should still work, just without thesis grounding.

---

## Files to Modify

| File | Change |
|---|---|
| `routes/session.ts` | Call `deriveThesis`, store result in session cache |
| `services/llm.ts` | Add `deriveThesis()` function |
| `services/llm.ts` | Add thesis line to all 5 `promptBuilder` variants |
| `services/llm.ts` | Add thesis line to `/next` prompt |

---

## Implementation Order

```
1. Add deriveThesis() function to services/llm.ts
2. Update routes/session.ts to call it and store thesis
3. Update promptBuilder — add thesis line to all 5 variants
4. Update /next prompt — add thesis line
5. Test with curl before touching frontend
```

No frontend changes needed — thesis is entirely internal to the backend.
