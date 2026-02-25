import type { FastifyInstance } from "fastify";
import { cache, TTL } from "../services/cache.js";
import { getWordSuggestion, getBridgeSuggestion } from "../services/llm.js";
import { hashKey } from "../utils/hash.js";
import { truncatePrecedingText } from "../utils/textUtils.js";
import { log } from "../logger.js";

type Mode = "word" | "bridge";
type Position = "opening" | "middle" | "closing";

interface PredictBody {
  sessionId: string;
  mode: Mode;
  precedingText: string;
  position?: Position;
}

interface SessionContext {
  outline: string;
  style: string;
  tone: string;
}

export async function predictRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: PredictBody }>("/predict", async (request, reply) => {
    const { sessionId, mode, precedingText, position = "middle" } = request.body ?? {};

    // Validate required fields
    for (const field of ["sessionId", "mode", "precedingText"] as const) {
      if (
        request.body?.[field] === undefined ||
        request.body?.[field] === null
      ) {
        return reply
          .status(400)
          .send({ error: `missing required field: ${field}` });
      }
    }

    if (mode !== "word" && mode !== "bridge") {
      return reply.status(400).send({ error: "mode must be word or bridge" });
    }

    // Empty precedingText — return early
    if (!precedingText) {
      return reply.send({
        mode,
        suggestion: "",
        confidence: 0.85,
        cached: false,
      });
    }

    const text = truncatePrecedingText(precedingText);

    const cacheKey = `predict:${hashKey(sessionId, text)}`;
    const cached = cache.get<string>(cacheKey);
    if (cached !== null) {
      return reply.send({
        mode,
        suggestion: cached,
        confidence: 0.85,
        cached: true,
      });
    }

    if (mode === "word") {
      const suggestion = await getWordSuggestion(text);
      cache.set(cacheKey, suggestion, TTL.PREDICTION);
      return reply.send({ mode, suggestion, confidence: 0.85, cached: false });
    }

    // Bridge mode — needs session context
    const context = cache.get<SessionContext>(`session:${sessionId}`);
    if (!context) {
      return reply.status(404).send({ error: "Session not found or expired" });
    }

    const suggestion = await getBridgeSuggestion(text, context, position);
    cache.set(cacheKey, suggestion, TTL.PREDICTION);

    return reply.send({ mode, suggestion, confidence: 0.85, cached: false });
  });
}
