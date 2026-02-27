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
}

interface PromptPair {
  system: string;
  user: string;
}

function promptBuilder({
  outline,
  style,
  tone,
  precedingText,
  stage,
  position,
}: {
  outline: string;
  style: string;
  tone: string;
  precedingText: string;
  stage: Stage;
  position: Position;
}): PromptPair {
  if (stage === "start") {
    return {
      system: `You are a writing assistant helping a writer who is staring at a blank page.

Their piece is about: "${outline}"
Style: ${style}
Tone: ${tone}

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
Style: ${style}
Tone: ${tone}

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
Style: ${style}
Tone: ${tone}

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
Style: ${style}
Tone: ${tone}

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
Style: ${style}
Tone: ${tone}

Suggest the next 5-7 words that:
- Keep the argument or narrative moving forward
- Feel consistent with the tone and style already established
- Act as a bridge — not a conclusion

Return ONLY the words. No punctuation at the end. No explanation. No preamble.
If the sentence already feels complete, return an empty string.`,
    user: `Continue this naturally: "${precedingText}"`,
  };
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
