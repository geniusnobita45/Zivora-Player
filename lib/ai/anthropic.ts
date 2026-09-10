import { z } from "zod";
import { aiJsonRequest } from "./http";

const AnthropicResponseSchema = z
  .object({
    content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()),
    usage: z.object({
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative(),
    }),
  })
  .passthrough();

export async function anthropicMessage(
  config: { apiKey: string; baseUrl?: string },
  input: { model: string; system: string; prompt: string; signal?: AbortSignal },
) {
  const response = await aiJsonRequest(
    `${config.baseUrl ?? "https://api.anthropic.com"}/v1/messages`,
    {
      method: "POST",
      headers: {
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        max_tokens: 4096,
        system: input.system,
        messages: [{ role: "user", content: input.prompt }],
      }),
      signal: input.signal,
    },
    AnthropicResponseSchema,
  );
  const text = response.content
    .filter((item) => item.type === "text")
    .map((item) => item.text ?? "")
    .join("");
  if (!text) throw new Error("Anthropic returned no output text");
  return {
    text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}
