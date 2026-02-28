import type { FastifyInstance } from "fastify";
import { cache, TTL } from "../services/cache.js";
import { getNextSuggestion } from "../services/llm.js";
import { hashKey } from "../utils/hash.js";
import { log } from "../logger.js";

interface NextBody {
  sessionId: string;
  lastParagraph: string;
  currentSection?: string;
}

interface SessionContext {
  outline: string;
  style: string;
  tone: string;
}

export async function nextRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: NextBody }>("/next", async (request, reply) => {
    const { sessionId, lastParagraph, currentSection } = request.body ?? {};

    if (!sessionId || lastParagraph === undefined || lastParagraph === null) {
      return reply.status(400).send({ error: "missing required field" });
    }

    // Fall back to empty context if session has expired
    const context = cache.get<SessionContext>(`session:${sessionId}`) ?? {
      outline: "",
      style: "",
      tone: "",
    };

    const truncated = lastParagraph.slice(-500);
    const section = currentSection ?? "";
    const cacheKey = `next:${hashKey(sessionId, truncated + section)}`;
    const cached = cache.get<{ phrase: string; angle: string }>(cacheKey);
    if (cached !== null) {
      return reply.send({ ...cached, cached: true });
    }

    const result = await getNextSuggestion(
      truncated,
      context,
      section || undefined,
    );
    log.info("Result: " + result);
    cache.set(cacheKey, result, TTL.PREDICTION);
    return reply.send({ ...result, cached: false });
  });
}
