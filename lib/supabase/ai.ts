import "server-only";
import { z } from "zod";
import type { Json } from "./types";
import { createServerSupabaseClient } from "./server";
import { createServiceSupabaseClient } from "./service";
import { VerifiedUserSchema } from "@/services/security/PlaybackAuthorization";
import { AIRouteError, type AISession } from "@/services/security/AIRoute";
import { createAIGateway, SupabaseAIUsageRepository } from "@/features/ai/gateway";
import { AICache, CachedAnswerSchema } from "@/features/ai/cache/AICache";
import { AIOrchestrator } from "@/features/ai/orchestrator/AIOrchestrator";
import { resolveWatchState, MediaScopeSchema } from "@/features/ai/orchestrator/WatchStateResolver";
import { HybridRetriever } from "@/features/ai/retrieval/HybridRetriever";
import { KeywordSearch } from "@/features/ai/retrieval/KeywordSearch";
import { VectorSearch } from "@/features/ai/retrieval/VectorSearch";
import { CostTierSchema } from "@/features/ai/gateway/ModelRouter";

export async function aiSession(request: Request): Promise<AISession | null> {
  const header = request.headers.get("authorization");
  const bearer = header ? /^Bearer ([A-Za-z0-9._-]{1,8192})$/.exec(header) : null;
  if ((header && !bearer) || (!header && !request.headers.has("cookie"))) return null;
  const caller = await createServerSupabaseClient(bearer?.[1]);
  const auth = await caller.auth.getUser(bearer?.[1]);
  if (auth.error || !auth.data.user) return null;
  const user = VerifiedUserSchema.parse(auth.data.user);
  const db = createServiceSupabaseClient();
  return {
    userId: user.id,
    async consumeRateLimit(signal) {
      const { data, error } = await db
        .rpc("consume_ai_request", { user_id: user.id })
        .abortSignal(signal);
      if (error) throw error;
      return z.boolean().parse(data);
    },
    async answer(request, signal) {
      const contentResult = await db
        .from("content")
        .select("id,state,access_level")
        .eq("id", request.contentId)
        .abortSignal(signal)
        .maybeSingle();
      if (contentResult.error) throw contentResult.error;
      const content = z
        .object({
          id: z.string().uuid(),
          state: z.string(),
          access_level: z.enum(["public", "private"]),
        })
        .nullable()
        .parse(contentResult.data);
      if (!content || content.state !== "READY") throw new AIRouteError(404, "Content unavailable");
      if (content.access_level !== "public" && !user.app_metadata.content_ids.includes(content.id))
        throw new AIRouteError(403, "Content access required");

      const [scopeResult, progressResult, preferencesResult] = await Promise.all([
        db.rpc("ai_media_scope", { content_id: content.id }).abortSignal(signal),
        caller
          .from("watch_progress")
          .select("episode_id,furthest_position_s")
          .eq("user_id", user.id)
          .eq("content_id", content.id)
          .limit(10000)
          .abortSignal(signal),
        caller
          .from("ai_preferences")
          .select("enabled,maximum_cost_tier,allow_history")
          .eq("user_id", user.id)
          .abortSignal(signal)
          .maybeSingle(),
      ]);
      if (scopeResult.error || progressResult.error || preferencesResult.error)
        throw new Error("AI context unavailable");
      const scope = MediaScopeSchema.parse(scopeResult.data);
      const resolved = resolveWatchState(
        request.watchState,
        request.episodeId,
        scope,
        progressResult.data,
      );
      const preferences = z
        .object({
          enabled: z.boolean(),
          maximum_cost_tier: CostTierSchema,
          allow_history: z.boolean(),
        })
        .parse(
          preferencesResult.data ?? {
            enabled: true,
            maximum_cost_tier: "standard",
            allow_history: true,
          },
        );
      if (!preferences.enabled) throw new AIRouteError(403, "AI is disabled in preferences");
      if (request.conversationId) {
        const result = await caller
          .from("ai_conversations")
          .select("id,content_id,episode_id")
          .eq("id", request.conversationId)
          .eq("user_id", user.id)
          .abortSignal(signal)
          .maybeSingle();
        const conversation = z
          .object({
            id: z.string().uuid(),
            content_id: z.string().uuid().nullable(),
            episode_id: z.string().uuid().nullable(),
          })
          .nullable()
          .parse(result.data);
        if (result.error) throw result.error;
        if (
          !conversation ||
          conversation.content_id !== content.id ||
          conversation.episode_id !== request.episodeId
        )
          throw new AIRouteError(404, "Conversation unavailable");
      }
      const gateway = createAIGateway(
        process.env,
        new SupabaseAIUsageRepository(
          async (value) => await db.from("ai_usage").insert(value).abortSignal(signal),
        ),
      );
      const scopedAI = {
        embeddingModel: gateway.embeddingModel,
        generate: <T>(input: import("@/features/ai/gateway/AIProvider").StructuredRequest<T>) =>
          gateway.generate({
            ...input,
            taskType: "cheap_chat",
            options: {
              userId: user.id,
              conversationId: request.conversationId,
              timeoutMs: 6000,
              retries: 0,
              maximumCostTier: preferences.maximum_cost_tier,
            },
          }),
        embed: (input: import("@/features/ai/gateway/AIProvider").EmbedRequest) =>
          gateway.embed({
            ...input,
            options: {
              userId: user.id,
              conversationId: request.conversationId,
              timeoutMs: 6000,
              retries: 0,
              maximumCostTier: preferences.maximum_cost_tier,
            },
          }),
      };
      const cache = new AICache({
        async get(key, userId) {
          const { data, error } = await db
            .from("ai_cache")
            .select("response,expires_at")
            .eq("cache_key", key)
            .eq("user_id", userId)
            .gt("expires_at", new Date().toISOString())
            .abortSignal(signal)
            .maybeSingle();
          if (error) throw error;
          if (!data) return null;
          const row = z
            .object({ response: z.unknown(), expires_at: z.string().datetime({ offset: true }) })
            .parse(data);
          return Date.parse(row.expires_at) > Date.now()
            ? CachedAnswerSchema.parse(row.response)
            : null;
        },
        async put(key, userId, answer, expiresAt) {
          const { error } = await db
            .from("ai_cache")
            .upsert(
              {
                cache_key: key,
                user_id: userId,
                task_type: "cheap_chat",
                provider: "gateway",
                model: "grounded-answer-v1",
                response: answer as Json,
                expires_at: expiresAt,
              },
              { onConflict: "cache_key" },
            )
            .abortSignal(signal);
          if (error) throw error;
        },
      });
      const retriever = new HybridRetriever(
        new KeywordSearch(async (name, args, requestSignal) => {
          const query = db.rpc(name, { ...args, filters: args.filters as Json });
          const { data, error } = await query.abortSignal(requestSignal ?? signal);
          if (error) throw error;
          return data;
        }),
        new VectorSearch(scopedAI),
      );
      const orchestrator = new AIOrchestrator(scopedAI, retriever, cache, {
        async append(input, userId, answer) {
          // Opting out of history also prevents storing the question in a conversation.
          if (!preferences.allow_history) return null;
          const { data, error } = await db
            .rpc("append_ai_exchange", {
              user_id: userId,
              content_id: input.contentId,
              episode_id: input.episodeId,
              conversation_id: input.conversationId,
              question: input.question,
              response: answer as Json,
            })
            .abortSignal(signal);
          if (error) throw error;
          return z.string().uuid().parse(data);
        },
      });
      return orchestrator.ask(
        { ...request, watchState: resolved.state },
        {
          userId: user.id,
          duration: resolved.duration,
          mediaVersionIds: scope.map((row) => row.media_version_id),
          modelVersion: [
            gateway.embeddingModel,
            process.env.OPENAI_GENERATION_MODEL ?? "gpt-4.1-mini",
            "answer-v1",
          ].join(":"),
        },
        signal,
      );
    },
  };
}
