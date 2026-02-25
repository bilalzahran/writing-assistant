import Anthropic from "@anthropic-ai/sdk";
import { postProcessSuggestion } from "../utils/textUtils.js";
import { log } from "../logger.js";

const client = new Anthropic();

type Position = "opening" | "middle" | "closing";

interface SessionContext {
  outline: string;
  style: string;
  tone: string;
}

const POSITION_GUIDANCE: Record<Position, string> = {
  opening:
    "The writer is at the OPENING of the article. Your suggestion must directly reflect the outline's premise or hook. If the preceding text is sparse, lean on the outline to establish the starting angle — do not drift from it.",
  middle:
    "The writer is in the MIDDLE of the article. Your suggestion should maintain the argument's flow as laid out in the outline. Bridge ideas already introduced toward what the outline still promises.",
  closing:
    "The writer is near the CLOSING of the article. Your suggestion should guide toward a conclusion that resolves the outline's core premise. Help wrap up, not open new threads.",
};

function buildSystemPrompt(ctx: SessionContext, position: Position): string {
  return `You are a writing assistant that helps writers find the right words.
Your job is to suggest the next 5-7 words that naturally bridge the current sentence — not complete it. You are a guide, not a ghostwriter.

Writing context:
- Style: ${ctx.style}
- Tone: ${ctx.tone}

Article outline (PRIMARY DIRECTIVE — your suggestion must be grounded in and aligned with this outline, especially when the preceding text is short or ambiguous):
${ctx.outline}

Position in article: ${position.toUpperCase()}
${POSITION_GUIDANCE[position]}

Rules:
- Return ONLY the word suggestion, no punctuation at the end
- Suggest exactly 5-7 words
- Never complete the full sentence
- Never add explanation or commentary
- Match the style and tone strictly
- If the preceding text already feels complete, return empty string`;
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
): Promise<string> {
  try {
    log.info("Goes here");
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 20,
      temperature: 0.7,
      system: buildSystemPrompt(context, position),
      messages: [
        {
          role: "user",
          content: `Continue this naturally: "${precedingText}"`,
        },
      ],
    });
    const block = message.content[0];
    if (!block || block.type !== "text") return "";

    return postProcessSuggestion(block.text);
  } catch (error) {
    log.error({ err: error }, "LLM call failed");
    return "";
  }
}
