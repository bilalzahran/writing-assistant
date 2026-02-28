import Anthropic from "@anthropic-ai/sdk";
import { postProcessSuggestion } from "../utils/textUtils.js";
import { log } from "../logger.js";

const client = new Anthropic();

type Position = "opening" | "middle" | "closing";
type Stage = "start" | "establish" | "continue";

interface SessionContext {
  outline: string;
  style: string;
  tone: string;
  thesis?: string;
}

interface PromptPair {
  system: string;
  user: string;
}

function promptBuilder({
  outline,
  style,
  tone,
  thesis,
  precedingText,
  stage,
  position,
}: {
  outline: string;
  style: string;
  tone: string;
  thesis?: string;
  precedingText: string;
  stage: Stage;
  position: Position;
}): PromptPair {
  const thesisLine = thesis ? `The article's core argument: "${thesis}"` : '';
  if (stage === "start") {
    return {
      system: `You are a writing assistant helping a writer who is staring at a blank page.

Their piece is about: "${outline}"
${thesisLine ? '\n' + thesisLine : ''}
Style: ${style}
Tone: ${tone}

Before generating your suggestion, identify which specific part of the outline the writer is currently working on based on their preceding text. Use that section to guide your suggestion — not the outline in general.

Suggest the first 5-7 words of an opening sentence that:
- Hooks the reader immediately
- Feels natural in a ${tone} voice
- Sets up the premise described in the outline

Return ONLY the words. No punctuation at the end. No explanation. No preamble.
If you cannot generate a helpful suggestion, return an empty string.`,
      user: "Give me the first words to start this piece.",
    };
  }

  if (stage === "establish") {
    return {
      system: `You are a writing assistant helping a writer establish their opening.

Their piece is about: "${outline}"
${thesisLine ? '\n' + thesisLine : ''}
Style: ${style}
Tone: ${tone}

Before generating your suggestion, identify which specific part of the outline the writer is currently working on based on their preceding text. Use that section to guide your suggestion — not the outline in general.

Suggest the next 5-7 words that:
- Feel like a natural extension of what they started
- Stay consistent with their opening voice
- Move the thought forward without completing it

Return ONLY the words. No punctuation at the end. No explanation. No preamble.
If the thought already feels complete, return an empty string.`,
      user: `Continue this naturally: "${precedingText}"`,
    };
  }

  if (position === "opening") {
    return {
      system: `You are a writing assistant helping a writer build momentum in their opening paragraph.

Their piece is about: "${outline}"
${thesisLine ? '\n' + thesisLine : ''}
Style: ${style}
Tone: ${tone}

Before generating your suggestion, identify which specific part of the outline the writer is currently working on based on their preceding text. Use that section to guide your suggestion — not the outline in general.

Suggest the next 5-7 words that:
- Maintain the voice and energy they've established
- Help develop or support the opening premise
- Bridge naturally to their next thought without finishing the sentence

Return ONLY the words. No punctuation at the end. No explanation. No preamble.
If the sentence already feels complete, return an empty string.`,
      user: `Continue this naturally: "${precedingText}"`,
    };
  }

  if (position === "closing") {
    return {
      system: `You are a writing assistant helping a writer bring their piece to a close.

Their piece is about: "${outline}"
${thesisLine ? '\n' + thesisLine : ''}
Style: ${style}
Tone: ${tone}

Before generating your suggestion, identify which specific part of the outline the writer is currently working on based on their preceding text. Use that section to guide your suggestion — not the outline in general.

Suggest the next 5-7 words that:
- Feel like the piece is moving toward resolution
- Carry the same tone without introducing new ideas
- Help the writer land the piece cleanly

Return ONLY the words. No punctuation at the end. No explanation. No preamble.
If the sentence already feels complete, return an empty string.`,
      user: `Continue this naturally: "${precedingText}"`,
    };
  }

  // stage=continue, position=middle (also the safe fallback)
  return {
    system: `You are a writing assistant helping a writer maintain flow through the body of their piece.

Their piece is about: "${outline}"
${thesisLine ? '\n' + thesisLine : ''}
Style: ${style}
Tone: ${tone}

Before generating your suggestion, identify which specific part of the outline the writer is currently working on based on their preceding text. Use that section to guide your suggestion — not the outline in general.

Suggest the next 5-7 words that:
- Keep the argument or narrative moving forward
- Feel consistent with the tone and style already established
- Act as a bridge — not a conclusion

Return ONLY the words. No punctuation at the end. No explanation. No preamble.
If the sentence already feels complete, return an empty string.`,
    user: `Continue this naturally: "${precedingText}"`,
  };
}

export async function deriveThesis(
  outline: string,
  style: string,
  tone: string,
): Promise<string> {
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 80,
      messages: [{
        role: 'user',
        content: `Given this article outline: "${outline}"
Style: ${style} | Tone: ${tone}

In one sentence, state the concrete argument or solution this article makes.
Be specific — reference actual methods, tools, or outcomes mentioned in the outline.
If the outline mentions specific technologies, libraries, or metrics, include them.

Return ONLY the one sentence. No preamble. No punctuation at the end.`
      }]
    });
    const text = response.content
      .filter(block => block.type === 'text')
      .map(block => (block as { type: 'text'; text: string }).text)
      .join('')
      .trim();
    return text ?? '';
  } catch {
    return '';
  }
}

export async function getWordSuggestion(
  precedingText: string,
): Promise<string> {
  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 5,
      temperature: 0.3,
      system: `You are a word completion assistant.
Predict the single next word the writer is most likely to type.

Rules:
- Return ONLY one word, nothing else
- No punctuation, no explanation
- If the text ends mid-word, complete that word
- If the text ends at a word boundary, predict the next word`,
      messages: [
        {
          role: "user",
          content: `What is the next word? "${precedingText}"`,
        },
      ],
    });
    const block = message.content[0];
    if (!block || block.type !== "text") return "";

    return postProcessSuggestion(block.text);
  } catch (error) {
    log.error({ err: error }, "LLM word call failed");
    return "";
  }
}

export async function getBridgeSuggestion(
  precedingText: string,
  context: SessionContext,
  position: Position = "middle",
  stage: Stage = "continue",
): Promise<string> {
  try {
    const { system, user } = promptBuilder({
      outline: context.outline,
      style: context.style,
      tone: context.tone,
      thesis: context.thesis,
      precedingText,
      stage,
      position,
    });

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 20,
      temperature: 0.7,
      system,
      messages: [{ role: "user", content: user }],
    });
    const block = message.content[0];
    if (!block || block.type !== "text") return "";

    return postProcessSuggestion(block.text);
  } catch (error) {
    log.error({ err: error }, "LLM call failed");
    return "";
  }
}

export async function getNextSuggestion(
  lastParagraph: string,
  context: SessionContext,
  currentSection?: string,
): Promise<{ phrase: string; angle: string }> {
  try {
    const currentSectionLine = currentSection
      ? `\nThe writer just finished working on this section of the outline:\n"${currentSection}"\n`
      : "";
    const afterLine = currentSection
      ? `\nBased on the outline, identify what logically comes AFTER "${currentSection}".\nThat is the territory for your suggestion.\n`
      : "\nBased on the outline, identify what logically comes next after what they just wrote.\nThat is the territory for your suggestion.\n";

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 120,
      temperature: 0.7,
      system: `You are a writing assistant helping a writer transition to their next section.

Their full outline: "${context.outline}"
${context.thesis ? `\nThe article's core argument: "${context.thesis}"` : ''}
Style: ${context.style}
Tone: ${context.tone}
${currentSectionLine}
Their last paragraph:
"${lastParagraph}"
${afterLine}
Return a JSON object with exactly two fields:
- "phrase": the first 5-7 words to open the next section. Natural, ${context.tone} voice. No punctuation at the end.
- "angle": one concrete sentence describing the specific topic or argument to develop next. Reference actual concepts from the outline — be specific, not generic.

Return ONLY valid JSON. No explanation. No preamble. No markdown backticks.
If you cannot determine a helpful next section, return: {"phrase": "", "angle": ""}`,
      messages: [{ role: "user", content: "What should I write next?" }],
    });
    const block = message.content[0];
    if (!block || block.type !== "text") return { phrase: "", angle: "" };
    const text = block.text;
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) return { phrase: "", angle: "" };
    const parsed = JSON.parse(text.slice(start, end + 1));
    return {
      phrase: parsed.phrase?.trim().replace(/[.,!?]$/, "") ?? "",
      angle: parsed.angle?.trim() ?? "",
    };
  } catch (error) {
    log.error({ err: error }, "LLM next call failed");
    return { phrase: "", angle: "" };
  }
}
