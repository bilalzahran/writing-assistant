import type { FastifyInstance } from "fastify";
import { v4 as uuidv4 } from "uuid";
import { cache, TTL } from "../services/cache.js";

interface SessionBody {
  outline: string;
  style: string;
  tone: string;
}

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: SessionBody }>("/session", async (request, reply) => {
    const { outline, style, tone } = request.body ?? {};

    for (const field of ["outline", "style", "tone"] as const) {
      if (!request.body?.[field]) {
        return reply
          .status(400)
          .send({ error: `missing required field: ${field}` });
      }
    }

    const sessionId = uuidv4();
    cache.set(`session:${sessionId}`, { outline, style, tone }, TTL.SESSION);

    return reply.status(201).send({ sessionId });
  });
}
