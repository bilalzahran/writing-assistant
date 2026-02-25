import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

export const log = pino(
  isDev
    ? { transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } } }
    : {}
);
