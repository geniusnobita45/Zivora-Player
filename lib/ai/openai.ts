import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { z } from "zod";
import { aiJsonRequest } from "./http";

const UsageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative().default(0),
    output_tokens: z.number().int().nonnegative().default(0),
  })
  .passthrough();
const ResponseSchema = z
  .object({
    output_text: z.string().optional(),
    output: z
      .array(
        z
          .object({
            content: z.array(z.object({ text: z.string().optional() }).passthrough()).default([]),
          })
          .passthrough(),
      )
      .default([]),
    usage: UsageSchema.default({ input_tokens: 0, output_tokens: 0 }),
  })
  .passthrough();
const EmbeddingResponseSchema = z
  .object({
    data: z.array(
      z.object({
        index: z.number().int().nonnegative(),
        embedding: z.array(z.number().finite()),
      }),
    ),
    usage: z
      .object({
        prompt_tokens: z.number().int().nonnegative().default(0),
        total_tokens: z.number().int().nonnegative().default(0),
      })
      .passthrough()
      .default({ prompt_tokens: 0, total_tokens: 0 }),
  })
  .passthrough();
const TranscriptionResponseSchema = z
  .object({
    text: z.string(),
    language: z.string().optional(),
    duration: z.number().positive().optional(),
    usage: z
      .union([
        z
          .object({
            input_tokens: z.number().int().nonnegative(),
            output_tokens: z.number().int().nonnegative(),
          })
          .passthrough(),
        z.object({ seconds: z.number().nonnegative() }).passthrough(),
      ])
      .optional(),
    segments: z
      .array(
        z
          .object({
            start: z.number().nonnegative(),
            end: z.number().positive(),
            text: z.string(),
            speaker: z.string().nullable().optional(),
            confidence: z.number().min(0).max(1).nullable().optional(),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();

export interface OpenAIHttpConfig {
  apiKey: string;
  baseUrl?: string;
}

export async function openAIResponse(
  config: OpenAIHttpConfig,
  input: {
    model: string;
    system: string;
    prompt: string;
    images?: string[];
    signal?: AbortSignal;
  },
) {
  const response = await aiJsonRequest(
    `${config.baseUrl ?? "https://api.openai.com"}/v1/responses`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        instructions: input.system,
        input: input.images?.length
          ? [
              {
                role: "user",
                content: [
                  { type: "input_text", text: input.prompt },
                  ...input.images.map((image_url) => ({
                    type: "input_image",
                    image_url,
                  })),
                ],
              },
            ]
          : input.prompt,
      }),
      signal: input.signal,
    },
    ResponseSchema,
  );
  const text =
    response.output_text ??
    response.output
      .flatMap((item) => item.content)
      .map((item) => item.text ?? "")
      .join("");
  if (!text) throw new Error("OpenAI returned no output text");
  return {
    text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

export async function openAIEmbeddings(
  config: OpenAIHttpConfig,
  input: {
    model: string;
    values: readonly string[];
    dimensions: number;
    signal?: AbortSignal;
  },
) {
  const response = await aiJsonRequest(
    `${config.baseUrl ?? "https://api.openai.com"}/v1/embeddings`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        input: input.values,
        dimensions: input.dimensions,
        encoding_format: "float",
      }),
      signal: input.signal,
    },
    EmbeddingResponseSchema,
  );
  return {
    embeddings: response.data.sort((a, b) => a.index - b.index).map((item) => item.embedding),
    inputTokens: response.usage.prompt_tokens,
  };
}

export async function openAITranscription(
  config: OpenAIHttpConfig,
  input: {
    model: string;
    mediaPath: string;
    language?: string;
    signal?: AbortSignal;
  },
) {
  const bytes = await readFile(input.mediaPath);
  const form = new FormData();
  const fileBytes = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  form.set("file", new Blob([fileBytes]), input.mediaPath.split(/[\\/]/).at(-1) ?? "media.bin");
  form.set("model", input.model);
  form.set("response_format", "diarized_json");
  form.set("chunking_strategy", "auto");
  if (input.language) form.set("language", input.language);
  return aiJsonRequest(
    `${config.baseUrl ?? "https://api.openai.com"}/v1/audio/transcriptions`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${config.apiKey}` },
      body: form,
      signal: input.signal,
    },
    TranscriptionResponseSchema,
  );
}

export async function imageDataUrl(path: string): Promise<string> {
  const types: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
  };
  const mime = types[extname(path).toLowerCase()];
  if (!mime) throw new Error("Unsupported vision image type");
  return `data:${mime};base64,${(await readFile(path)).toString("base64")}`;
}
