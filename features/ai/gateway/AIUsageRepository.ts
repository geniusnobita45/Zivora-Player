import { z } from "zod";
import { AITaskTypeSchema, CostTierSchema } from "./ModelRouter";

export const AIUsageRecordSchema = z
  .object({
    request_id: z.string().uuid(),
    user_id: z.string().uuid().nullable(),
    conversation_id: z.string().uuid().nullable(),
    task_type: AITaskTypeSchema,
    provider: z.string().min(1),
    model: z.string().min(1),
    cost_tier: CostTierSchema,
    attempts: z.number().int().min(1).max(20),
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    cost_usd: z.number().finite().nonnegative(),
    duration_ms: z.number().int().nonnegative(),
    success: z.boolean(),
    error_code: z.string().min(1).nullable(),
  })
  .strict();
export type AIUsageRecord = z.infer<typeof AIUsageRecordSchema>;

export interface AIUsageRepository {
  record(value: AIUsageRecord): Promise<void>;
}

export class SupabaseAIUsageRepository implements AIUsageRepository {
  constructor(private readonly insert: (value: AIUsageRecord) => PromiseLike<{ error: unknown }>) {}
  async record(value: AIUsageRecord): Promise<void> {
    const { error } = await this.insert(AIUsageRecordSchema.parse(value));
    if (error) throw new Error("AI usage accounting failed", { cause: error });
  }
}

export class MemoryAIUsageRepository implements AIUsageRepository {
  readonly records: AIUsageRecord[] = [];
  async record(value: AIUsageRecord): Promise<void> {
    this.records.push(AIUsageRecordSchema.parse(value));
  }
}
