import { z } from "zod";
import type { IntelligenceStage } from "./CheckpointStore";
import { stableUuid } from "./types";

export interface IntelligenceRepository {
  setContentState(contentId: string, state: "AI_PROCESSING"): Promise<void>;
  saveStage(
    mediaVersionId: string,
    contentId: string,
    stage: IntelligenceStage,
    value: unknown,
  ): Promise<void>;
}
export interface SupabaseWriteClient {
  from(table: string): {
    upsert(values: unknown, options?: unknown): PromiseLike<{ error: unknown }>;
    update(values: unknown): { eq(column: string, value: string): PromiseLike<{ error: unknown }> };
  };
}
function rows(value: unknown) {
  return z.array(z.record(z.unknown())).parse(value);
}
async function checked(operation: PromiseLike<{ error: unknown }>) {
  const result = await operation;
  if (result.error) throw new Error("Intelligence persistence failed");
}
export class SupabaseIntelligenceRepository implements IntelligenceRepository {
  constructor(private readonly client: SupabaseWriteClient) {}
  async setContentState(contentId: string, state: "AI_PROCESSING") {
    await checked(
      this.client.from("content").update({ state }).eq("id", z.string().uuid().parse(contentId)),
    );
  }
  async saveStage(
    mediaVersionId: string,
    contentId: string,
    stage: IntelligenceStage,
    value: unknown,
  ) {
    const id = z.string().uuid().parse(mediaVersionId),
      content = z.string().uuid().parse(contentId),
      data = z.record(z.unknown()).parse(value);
    if (stage === "transcription") {
      const transcriptId = data.transcriptId;
      await checked(
        this.client.from("transcripts").upsert(
          {
            id: transcriptId,
            media_version_id: id,
            language: data.language,
            duration_s: data.duration,
            provider: data.provider,
            model: data.model,
            source_checksum: data.sourceChecksum,
          },
          { onConflict: "media_version_id" },
        ),
      );
      await checked(
        this.client.from("transcript_segments").upsert(
          rows(data.segments).map((segment) => ({
            id: segment.id,
            transcript_id: transcriptId,
            media_version_id: id,
            sequence_index: segment.index,
            start_s: segment.start,
            end_s: segment.end,
            speaker: segment.speaker,
            text: segment.text,
            confidence: segment.confidence,
          })),
          { onConflict: "id" },
        ),
      );
      return;
    }
    if (stage === "scenes") {
      await checked(
        this.client.from("scenes").upsert(
          rows(value).map((scene) => ({
            id: scene.id,
            media_version_id: id,
            scene_index: scene.index,
            start_s: scene.start,
            end_s: scene.end,
            title: scene.title,
            summary: scene.summary,
            visual_confidence: scene.visualConfidence,
          })),
          { onConflict: "id" },
        ),
      );
      return;
    }
    if (stage === "characters") {
      const characters = rows(value);
      await checked(
        this.client.from("characters").upsert(
          characters.map((character) => ({
            id: character.id,
            content_id: content,
            name: character.name,
            description: character.description,
            aliases: character.aliases,
            first_appearance_s: character.firstAppearance,
          })),
          { onConflict: "id" },
        ),
      );
      const appearances = characters.flatMap((character) =>
        z
          .array(z.string().uuid())
          .parse(character.sceneIds)
          .map((sceneId, index) => ({
            id: stableUuid(id, "appearance", character.id as string, sceneId),
            character_id: character.id,
            scene_id: sceneId,
            media_version_id: id,
            confidence: 1,
            is_first_appearance: index === 0,
          })),
      );
      await checked(
        this.client
          .from("character_appearances")
          .upsert(appearances, { onConflict: "character_id,scene_id" }),
      );
      await checked(
        this.client.from("entities").upsert(
          appearances.map((appearance) => {
            const character = characters.find((item) => item.id === appearance.character_id)!;
            const name = z.string().min(1).parse(character.name);
            return {
              id: stableUuid(id, "entity", appearance.scene_id, name),
              media_version_id: id,
              scene_id: appearance.scene_id,
              transcript_segment_id: null,
              entity_type: "person",
              name,
              normalized_name: name.toLocaleLowerCase(),
              confidence: appearance.confidence,
            };
          }),
          { onConflict: "id" },
        ),
      );
      return;
    }
    if (stage === "embeddings") {
      const embeddings = rows(value),
        scenes = embeddings.filter((item) => item.source === "scene"),
        transcripts = embeddings.filter((item) => item.source === "transcript");
      await checked(
        this.client.from("scene_embeddings").upsert(
          scenes.map((item) => ({
            id: item.id,
            scene_id: item.sourceId,
            media_version_id: id,
            embedding: item.embedding,
            embedding_model: item.model,
          })),
          { onConflict: "scene_id" },
        ),
      );
      for (const item of transcripts)
        await checked(
          this.client
            .from("transcript_segments")
            .update({ embedding: item.embedding, embedding_model: item.model })
            .eq("id", z.string().uuid().parse(item.sourceId)),
        );
      return;
    }
    const table = {
      chapters: "chapters",
      recaps: "recap_segments",
      "skip-detection": "skip_segments",
    }[stage];
    const source = stage === "skip-detection" ? z.record(z.unknown()).parse(value).segments : value;
    await checked(
      this.client.from(table).upsert(
        rows(source).map((item) =>
          stage === "chapters"
            ? {
                id: item.id,
                media_version_id: id,
                chapter_index: item.index,
                start_s: item.start,
                end_s: item.end,
                title: item.title,
                summary: item.summary,
              }
            : stage === "recaps"
              ? {
                  id: item.id,
                  media_version_id: id,
                  kind: item.kind,
                  start_s: item.start,
                  end_s: item.end,
                  summary: item.summary,
                }
              : {
                  id: item.id,
                  media_version_id: id,
                  kind: item.kind,
                  start_s: item.start,
                  end_s: item.end,
                  confidence: item.confidence,
                  evidence: item.evidence,
                },
        ),
        { onConflict: "id" },
      ),
    );
  }
}
