import type { AIProvider } from "../gateway/AIProvider";
import type { HybridRetriever } from "../retrieval/HybridRetriever";
import { SpoilerGuard } from "../spoiler-guard/SpoilerGuard";
import { retrievalConfidence } from "../confidence/ConfidenceService";
import { AICache, cacheKey } from "../cache/AICache";
import { directCommand, seekCommand } from "../commands/AICommands";
import { IntentRouter } from "./IntentRouter";
import { ContextBuilder } from "./ContextBuilder";
import {
  AIRequestSchema,
  AIAnswerSchema,
  AuthorizedContextSchema,
  type AIAnswer,
  type AIRequest,
  type AuthorizedContext,
} from "./contracts";
export interface ConversationStore {
  append(request: AIRequest, userId: string, answer: AIAnswer): Promise<string | null>;
}
export class AIOrchestrator {
  constructor(
    private readonly ai: Pick<AIProvider, "generate">,
    private readonly retrieval: Pick<HybridRetriever, "retrieve">,
    private readonly cache: AICache,
    private readonly conversations: ConversationStore,
    private readonly now: () => number = Date.now,
  ) {}
  async ask(input: unknown, authorization: AuthorizedContext, signal?: AbortSignal) {
    const request = AIRequestSchema.parse(input);
    const auth = AuthorizedContextSchema.parse(authorization);
    const intent = new IntentRouter().route(request.question);
    const boundary = new SpoilerGuard().boundary(request.watchState, request.mode);
    const key = cacheKey(request, auth, intent, boundary);
    let answer: AIAnswer | null = null;
    if (intent === "control_player") {
      const command = directCommand(
        request.question,
        request.watchState.currentPosition,
        auth.duration,
        this.now(),
      );
      answer = command
        ? { answer: "Player command ready.", confidence: 1, candidates: [], command }
        : {
            answer: "Specify a playback control such as play, pause, mute, or set speed to 2x.",
            confidence: 0,
            candidates: [],
          };
    } else {
      answer = await this.cache.get(key, auth.userId);
      if (!answer) {
        const rows = await this.retrieval.retrieve(
          {
            contentId: request.contentId,
            query: request.question,
            boundary,
            filters: { ...request.filters, media_version_ids: auth.mediaVersionIds },
            limit: 10,
          },
          signal,
        );
        const context = new ContextBuilder().build(
          request.question,
          request.language,
          intent,
          rows,
          boundary,
        );
        if (!context.evidenceIds.size) {
          answer = {
            answer: "I don't have enough watched evidence to answer that yet.",
            confidence: 0,
            candidates: [],
          };
        } else {
          const generated = AIAnswerSchema.parse(
            await this.ai.generate({
              system: context.system,
              prompt: context.prompt,
              schema: AIAnswerSchema,
              schemaName: "zivora_grounded_answer",
              signal,
            }),
          );
          const confidence = Math.min(
            generated.confidence,
            retrievalConfidence(rows[0]?.fused_score ?? 0, rows[1]?.fused_score ?? 0),
          );
          const seen = new Set<string>();
          const candidates = generated.candidates.flatMap((candidate) => {
            const matches = rows.filter(
              (row) =>
                context.evidenceIds.has(row.id) &&
                (!candidate.evidenceId || row.id === candidate.evidenceId) &&
                (candidate.episodeId === undefined || row.episode_id === candidate.episodeId) &&
                row.start_s === candidate.timestamp,
            );
            if (matches.length !== 1 || seen.has(matches[0].id)) return [];
            const row = matches[0];
            seen.add(row.id);
            return [
              {
                ...candidate,
                label: row.title.slice(0, 500),
                evidenceId: row.id,
                episodeId: row.episode_id,
                confidence: Math.min(
                  candidate.confidence,
                  confidence,
                  retrievalConfidence(
                    row.fused_score,
                    Math.max(
                      0,
                      ...rows
                        .filter((other) => other.id !== row.id)
                        .map((other) => other.fused_score),
                    ),
                  ),
                ),
              },
            ];
          });
          answer = {
            answer: generated.answer,
            confidence:
              candidates.length === 1 ? Math.min(confidence, candidates[0].confidence) : confidence,
            candidates,
          };
        }
        await this.cache.put(key, auth.userId, answer);
      }
      const command = seekCommand(
        answer,
        request.episodeId,
        request.watchState.currentEpisodeOrder,
        boundary,
        request.watchState.currentPosition,
        auth.duration,
        this.now(),
      );
      if (command) answer = { ...answer, command };
    }
    const result = AIAnswerSchema.parse(answer);
    const conversationId = await this.conversations.append(request, auth.userId, result);
    return { ...result, conversationId, intent, boundary };
  }
}
