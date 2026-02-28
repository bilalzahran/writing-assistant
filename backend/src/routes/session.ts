import type { FastifyInstance } from "fastify";
import { v4 as uuidv4 } from "uuid";
import { cache, TTL } from "../services/cache.js";
import { deriveThesis } from "../services/llm.js";

interface SessionBody {
  outline: string;
  style: string;
  tone: string;
}

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: SessionBody }>("/session", async (request, reply) => {
    const { outline, style, tone } = request.body ?? {};

    if (!outline) {
      return reply.status(400).send({ error: "missing required field: outline" });
    }

    const sessionId = uuidv4();
    const thesis = await deriveThesis(outline, style ?? '', tone ?? '');
    cache.set(`session:${sessionId}`, { outline, style, tone, thesis }, TTL.SESSION);

    return reply.status(201).send({ sessionId });
  });
}
