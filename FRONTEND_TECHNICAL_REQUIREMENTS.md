# Writing Assistant — Frontend Technical Requirements (PoC)

## Overview

A Notion-inspired writing editor with ghost-text suggestions. The UI should feel calm, minimal, and focused — nothing competes with the writing itself. The ghost text is the hero feature; everything else is secondary.

---

## Stack

- **Framework**: React + Vite (via shadcn template)
- **Component Library**: shadcn/ui (Nova style, Stone theme, Remix icons, Inter font)
- **Scaffold command**:
```bash
npx shadcn@latest create --preset "https://ui.shadcn.com/init?base=radix&style=nova&baseColor=stone&theme=stone&iconLibrary=remixicon&font=inter&menuAccent=subtle&menuColor=inverted&radius=none&template=vite&rtl=false" --template vite
```
- **Rich text editor**: [Tiptap](https://tiptap.dev/) — headless, extensible, Notion-like behavior out of the box
- **HTTP client**: `axios` or native `fetch`
- **State**: React `useState` / `useRef` (no external state lib needed for PoC)

---

## Pages / Views

### 1. Session Setup Screen

Shown before the editor loads. User defines their writing context here.

**Fields**
- `Outline` — textarea, what the article/piece is about
- `Style` — dropdown: `Conversational`, `Academic`, `Journalistic`, `Casual`
- `Tone` — dropdown: `Calm`, `Energetic`, `Wise`, `Playful`

**Behavior**
- On submit → call `POST /session` → store returned `sessionId` in component state (or localStorage for persistence)
- On success → navigate to the Editor screen
- Show loading state on the button while waiting

**Validation**
- All fields required before enabling submit
- Outline max: 300 characters (show character count)

---

### 2. Editor Screen

The main writing surface. Full page, distraction-free.

**Layout**
```
┌─────────────────────────────────────┐
│  [Logo / App name]      [Settings]  │  ← minimal top bar
├─────────────────────────────────────┤
│                                     │
│   [Article title input]             │
│                                     │
│   [Tiptap editor body]              │
│                                     │
│                                     │
└─────────────────────────────────────┘
```

- Max content width: `720px`, centered
- No sidebars for PoC
- Top bar should be minimal — just app name and a settings icon to go back to session setup

---

## Core Feature — Ghost Text

### How It Works (User Perspective)

1. User types in the editor
2. After pausing for **700ms**, the app sends a prediction request
3. A suggestion appears inline after the cursor in **muted/ghost style** (lighter color, slightly italic)
4. User presses `Tab` to accept the suggestion — it gets inserted as real text
5. User presses `Escape` or keeps typing to dismiss

### Mode Detection (Client Responsibility)

Before sending the request, the client detects the mode:

```ts
function detectMode(precedingText: string): "word" | "bridge" {
  const trimmed = precedingText.trimEnd()
  const lastChar = trimmed[trimmed.length - 1]
  // if last char is NOT a space, user is mid-word
  return lastChar === ' ' || lastChar === undefined ? 'bridge' : 'word'
}
```

### Preceding Text Extraction

```ts
function getPrecedingText(editor: Editor): string {
  const text = editor.getText()
  const cursorPos = editor.state.selection.anchor
  const raw = text.slice(0, cursorPos)
  // take last 500 chars only
  return raw.slice(-500)
}
```

### Trigger Logic (Debounce)

```ts
// trigger on every keystroke, but debounce the actual API call
const debouncedPredict = useMemo(
  () => debounce(async (precedingText: string) => {
    const mode = detectMode(precedingText)
    const suggestion = await fetchPrediction(sessionId, mode, precedingText)
    setSuggestion(suggestion)
  }, 700),
  [sessionId]
)

// call on every editor update
editor.on('update', () => {
  const text = getPrecedingText(editor)
  debouncedPredict(text)
})
```

**Cancel debounce** when:
- User presses `Tab` (accepting) — clear and reset
- User presses `Escape` — clear and reset
- Editor loses focus — clear suggestion

### Ghost Text Rendering

Tiptap does not natively support inline ghost text. Implement using a **Tiptap Decoration** (ProseMirror plugin):

```ts
// Create a custom Tiptap extension that renders ghost text
// as a ProseMirror decoration at the current cursor position
// The decoration renders a <span> with ghost styling, not real doc content
```

Ghost text styles:
```css
.ghost-text {
  color: var(--stone-400);       /* muted, clearly not real text */
  font-style: italic;
  pointer-events: none;
  user-select: none;
}
```

### Accepting / Dismissing

```ts
// Tab key → accept
editor.commands.insertContent(currentSuggestion)
setSuggestion('')

// Escape or any key other than Tab → dismiss
setSuggestion('')
```

---

## Notion-style Slash Commands

When user types `/` on an empty line, show a floating command menu.

**Trigger**: `/` at start of an empty block

**Commands to support for PoC**

| Command | Action |
|---|---|
| `/h1` | Heading 1 |
| `/h2` | Heading 2 |
| `/h3` | Heading 3 |
| `/bullet` | Bullet list |
| `/numbered` | Numbered list |
| `/quote` | Blockquote |
| `/divider` | Horizontal rule |
| `/bold` | Toggle bold on current line |

**Implementation**: Use Tiptap's built-in `@tiptap/extension-slash-commands` or implement manually using the `Suggestion` utility from `@tiptap/suggestion`.

**Menu UI**
- Floating popover anchored below the cursor
- Keyboard navigable (arrow keys + Enter)
- Filter commands as user types after `/`
- Dismiss on `Escape` or click outside

---

## API Integration

### Session Init

```ts
// called once on session setup form submit
async function createSession(outline: string, style: string, tone: string) {
  const res = await fetch('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outline, style, tone })
  })
  const { sessionId } = await res.json()
  return sessionId
}
```

### Prediction Request

```ts
async function fetchPrediction(
  sessionId: string,
  mode: 'word' | 'bridge',
  precedingText: string
): Promise<string> {
  try {
    const res = await fetch('/api/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, mode, precedingText })
    })
    const { suggestion } = await res.json()
    return suggestion ?? ''
  } catch {
    return '' // fail silently — never break the editor
  }
}
```

**Always fail silently** — if the request fails or times out, just return empty string. No error toasts, no broken states.

---

## State Shape

```ts
interface EditorState {
  sessionId: string
  suggestion: string         // current ghost text
  isLoadingPrediction: boolean
}
```

Keep it minimal. No need for complex state management for PoC.

---

## UX Details

| Behavior | Spec |
|---|---|
| Ghost text appears | After 700ms pause in typing |
| Ghost text dismissed | On any keystroke except Tab |
| Ghost text accepted | Tab key |
| Slash menu opens | `/` on empty line |
| Slash menu closes | Escape or click outside |
| Prediction loading state | No spinner — just show nothing until suggestion arrives |
| Empty suggestion | Simply show nothing, no placeholder |

**No loading spinners for ghost text** — if the suggestion isn't ready, the user just sees nothing. A spinner would be more distracting than helpful.

---

## File Structure (Suggested)

```
/src
  /components
    SessionSetup.tsx          # session form screen
    Editor.tsx                # main editor screen
    GhostText.tsx             # Tiptap decoration extension
    SlashMenu.tsx             # slash command floating menu
  /hooks
    usePrediction.ts          # debounce + fetch logic
    useSession.ts             # session creation + storage
  /lib
    api.ts                    # fetchPrediction, createSession
    detectMode.ts             # word vs bridge mode detection
    getPrecedingText.ts       # extract last 500 chars at cursor
  /extensions
    ghostTextExtension.ts     # Tiptap ProseMirror plugin
    slashCommandExtension.ts  # Tiptap slash command plugin
  App.tsx
  main.tsx
```

---

## Dependencies to Install

```bash
# Tiptap core + extensions
npm install @tiptap/react @tiptap/pm @tiptap/starter-kit
npm install @tiptap/extension-placeholder
npm install @tiptap/extension-heading
npm install @tiptap/extension-bullet-list
npm install @tiptap/extension-ordered-list
npm install @tiptap/extension-blockquote
npm install @tiptap/extension-horizontal-rule
npm install @tiptap/suggestion

# Utility
npm install lodash        # for debounce
npm install @types/lodash
```

---

## Non-Goals for PoC

- Document save / persistence (no database)
- Multiple documents
- Collaborative editing
- Mobile responsiveness
- Markdown export
- Undo/redo for accepted suggestions (native browser undo handles this)
- Suggestion history or analytics
