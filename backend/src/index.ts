import Fastify from "fastify";
import cors from "@fastify/cors";
import { log } from "./logger.js";
import { sessionRoutes } from "./routes/session.js";
import { predictRoutes } from "./routes/predict.js";

const app = Fastify({ loggerInstance: log });

app.register(cors, {
  origin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
});

app.register(sessionRoutes);
app.register(predictRoutes);

async function start(): Promise<void> {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "0.0.0.0";

  await app.listen({ port, host });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received — shutting down`);
  await app.close();
  process.exit(0);
};

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
