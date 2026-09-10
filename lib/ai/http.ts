import { z } from "zod";

const ErrorBodySchema = z.object({ error: z.unknown().optional() }).passthrough();

export async function aiJsonRequest<S extends z.ZodTypeAny>(
  url: string,
  init: RequestInit,
  schema: S,
): Promise<z.output<S>> {
  const response = await fetch(z.string().url().parse(url), init);
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (cause) {
    throw new Error("AI provider returned invalid JSON", { cause });
  }
  if (!response.ok) {
    const error = ErrorBodySchema.parse(body).error;
    throw new Error(
      `AI provider request failed with HTTP ${response.status}: ${JSON.stringify(error)}`,
    );
  }
  return schema.parse(body);
}

export function parseJsonText(text: unknown): unknown {
  const value = z.string().min(1).parse(text).trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(value);
  return JSON.parse(fenced?.[1] ?? value) as unknown;
}
