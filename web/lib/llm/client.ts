import "server-only";
import OpenAI from "openai";

const MODEL = "openai/gpt-5.6-luna";

let client: OpenAI | null = null;

/**
 * OpenRouter's chat-completions API is OpenAI-compatible, so the OpenAI SDK
 * works unchanged against its base URL. Server-only: the key must never reach
 * the client bundle, and `server-only` makes that a build-time error rather
 * than a runtime leak if a "use client" file ever imports this by mistake.
 */
export function getLlmClient(): OpenAI {
  if (client) return client;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set — required to run the analyst.");
  }
  client = new OpenAI({ apiKey, baseURL: "https://openrouter.ai/api/v1" });
  return client;
}

export const LLM_MODEL = MODEL;
