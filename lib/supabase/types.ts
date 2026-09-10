export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type AISearchRow = {
  id: string;
  kind: "scene" | "transcript";
  content_id: string;
  episode_id: string | null;
  media_version_id: string;
  episode_order: number;
  start_s: number;
  end_s: number;
  title: string;
  text: string;
  character_ids: string[];
  chapter_id: string | null;
  chapter_title: string | null;
  fused_score: number;
  vector_score: number | null;
  keyword_score: number;
};
type AISearchFunction = {
  Args: {
    query_embedding: string | null;
    query_text: string;
    content_id: string;
    boundary_episode_order: number;
    boundary_seconds: number;
    filters?: Json;
    limit?: number;
  };
  Returns: AISearchRow[];
};

type OwnedPlaybackRow = {
  id: string;
  user_id: string;
  content_id: string;
  episode_id: string | null;
  position_s: number;
  updated_at: string;
};
export type WatchProgressRow = OwnedPlaybackRow & {
  furthest_position_s: number;
  duration_s: number;
};
type PlaybackTable<Row, Insert> = {
  Row: Row;
  Insert: Insert;
  Update: Partial<Insert>;
  Relationships: [];
};
type WatchHistoryRow = OwnedPlaybackRow & { completed: boolean; started_at: string };
type BookmarkRow = OwnedPlaybackRow & { title: string; deleted: boolean };
type PlaybackSessionRow = OwnedPlaybackRow & { started_at: string };
type PlaybackPreferencesRow = {
  user_id: string;
  auto_next: boolean;
  volume: number;
  muted: boolean;
  playback_rate: number;
  updated_at: string;
};
type ObservabilityRow = {
  id: string;
  session_id: string;
  user_id: string | null;
  content_id: string;
  episode_id: string | null;
  media_version_id: string | null;
  occurred_at: string;
  device: string;
  browser: string;
  network: string;
};
type PlaybackEventRow = ObservabilityRow & {
  received_at: string;
  event_type: string;
  position_s: number | null;
  startup_ms: number | null;
  watch_duration_ms: number | null;
  total_buffer_ms: number | null;
  completion_percentage: number | null;
  failed_requests: number | null;
  os: string;
  payload: Json;
};
type PlaybackErrorRow = ObservabilityRow & {
  code: string;
  category: string;
  fatal: boolean;
  recoverable: boolean;
};
type BufferingEventRow = ObservabilityRow & { position_s: number | null; duration_ms: number };
type SeekEventRow = ObservabilityRow & {
  from_position_s: number;
  to_position_s: number;
  latency_ms: number | null;
};
type QualityEventRow = ObservabilityRow & {
  rendition_id: string;
  rendition_height: number | null;
  rendition_bitrate: number | null;
  bandwidth_estimate: number | null;
};
type IntelligenceTable<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};
type IntelligenceTimedRow = {
  id: string;
  media_version_id: string;
  start_s: number;
  end_s: number;
  created_at: string;
};
type TranscriptRow = {
  id: string;
  media_version_id: string;
  language: string;
  duration_s: number;
  provider: string;
  model: string;
  source_checksum: string;
  created_at: string;
  updated_at: string;
};
type TranscriptSegmentRow = IntelligenceTimedRow & {
  transcript_id: string;
  sequence_index: number;
  speaker: string | null;
  text: string;
  confidence: number | null;
  search_vector: string;
  embedding: string | null;
  embedding_model: string | null;
};
type SceneRow = IntelligenceTimedRow & {
  scene_index: number;
  title: string;
  summary: string;
  visual_confidence: number | null;
  search_vector: string;
};
type SceneEmbeddingRow = {
  id: string;
  scene_id: string;
  media_version_id: string;
  embedding: string;
  embedding_model: string;
  created_at: string;
};
type CharacterRow = {
  id: string;
  content_id: string;
  name: string;
  description: string;
  aliases: string[];
  first_appearance_s: number | null;
  created_at: string;
  updated_at: string;
};
type CharacterAppearanceRow = {
  id: string;
  character_id: string;
  scene_id: string;
  media_version_id: string;
  confidence: number;
  is_first_appearance: boolean;
  created_at: string;
};
type ChapterRow = IntelligenceTimedRow & { chapter_index: number; title: string; summary: string };
type SkipSegmentRow = IntelligenceTimedRow & {
  kind: "intro" | "recap" | "credits";
  confidence: number;
  evidence: Json;
};
type RecapSegmentRow = IntelligenceTimedRow & {
  kind: "episode" | "what_did_i_miss";
  summary: string;
};
type EntityRow = {
  id: string;
  media_version_id: string;
  scene_id: string | null;
  transcript_segment_id: string | null;
  entity_type: "person" | "place" | "organization" | "object" | "event" | "other";
  name: string;
  normalized_name: string;
  confidence: number;
  created_at: string;
};
type AIConversationRow = {
  id: string;
  user_id: string;
  content_id: string | null;
  episode_id: string | null;
  title: string | null;
  created_at: string;
  updated_at: string;
};
type AIMessageRow = {
  id: string;
  conversation_id: string;
  user_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  citations: Json;
  model: string | null;
  created_at: string;
};
type AICacheRow = {
  id: string;
  user_id: string | null;
  cache_key: string;
  task_type: "cheap_chat" | "complex_reasoning" | "embedding" | "transcription" | "vision";
  provider: string;
  model: string;
  response: Json;
  expires_at: string;
  hit_count: number;
  created_at: string;
};
type AIUsageRow = {
  id: string;
  request_id: string;
  user_id: string | null;
  conversation_id: string | null;
  task_type: "cheap_chat" | "complex_reasoning" | "embedding" | "transcription" | "vision";
  provider: string;
  model: string;
  cost_tier: "low" | "standard" | "premium";
  attempts: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  duration_ms: number;
  success: boolean;
  error_code: string | null;
  created_at: string;
};
type AIPreferencesRow = {
  user_id: string;
  enabled: boolean;
  maximum_cost_tier: "low" | "standard" | "premium";
  preferred_language: string | null;
  allow_history: boolean;
  settings: Json;
  updated_at: string;
};

export type Database = {
  public: {
    Tables: {
      ai_conversations: IntelligenceTable<AIConversationRow>;
      ai_messages: IntelligenceTable<AIMessageRow>;
      ai_cache: IntelligenceTable<AICacheRow>;
      ai_usage: PlaybackTable<
        AIUsageRow,
        Omit<AIUsageRow, "id" | "total_tokens" | "created_at"> & {
          id?: string;
          created_at?: string;
        }
      >;
      ai_preferences: IntelligenceTable<AIPreferencesRow>;
      transcripts: IntelligenceTable<TranscriptRow>;
      transcript_segments: IntelligenceTable<TranscriptSegmentRow>;
      scenes: IntelligenceTable<SceneRow>;
      scene_embeddings: IntelligenceTable<SceneEmbeddingRow>;
      characters: IntelligenceTable<CharacterRow>;
      character_appearances: IntelligenceTable<CharacterAppearanceRow>;
      chapters: IntelligenceTable<ChapterRow>;
      skip_segments: IntelligenceTable<SkipSegmentRow>;
      recap_segments: IntelligenceTable<RecapSegmentRow>;
      entities: IntelligenceTable<EntityRow>;
      watch_progress: PlaybackTable<
        WatchProgressRow,
        Omit<WatchProgressRow, "id"> & { id?: string }
      >;
      watch_history: PlaybackTable<
        WatchHistoryRow,
        Omit<WatchHistoryRow, "id" | "started_at" | "completed"> & {
          id?: string;
          started_at?: string;
          completed?: boolean;
        }
      >;
      bookmarks: PlaybackTable<BookmarkRow, Omit<BookmarkRow, "deleted"> & { deleted?: boolean }>;
      playback_sessions: PlaybackTable<
        PlaybackSessionRow,
        Omit<PlaybackSessionRow, "started_at"> & { started_at?: string }
      >;
      playback_preferences: PlaybackTable<
        PlaybackPreferencesRow,
        Partial<PlaybackPreferencesRow> & { user_id: string }
      >;
      playback_events: PlaybackTable<
        PlaybackEventRow,
        Omit<PlaybackEventRow, "id" | "received_at"> & { id?: string; received_at?: string }
      >;
      playback_errors: PlaybackTable<
        PlaybackErrorRow,
        Omit<PlaybackErrorRow, "id"> & { id?: string }
      >;
      buffering_events: PlaybackTable<
        BufferingEventRow,
        Omit<BufferingEventRow, "id"> & { id?: string }
      >;
      seek_events: PlaybackTable<SeekEventRow, Omit<SeekEventRow, "id"> & { id?: string }>;
      quality_events: PlaybackTable<QualityEventRow, Omit<QualityEventRow, "id"> & { id?: string }>;
      audio_tracks: {
        Row: {
          bitrate: number;
          channels: number | null;
          checksum_sha256: string;
          codec: string;
          created_at: string;
          id: string;
          is_default: boolean;
          label: string;
          language: string;
          media_version_id: string;
          playlist_path: string;
          sample_rate: number;
        };
        Insert: {
          bitrate?: number;
          channels?: number | null;
          checksum_sha256: string;
          codec?: string;
          created_at?: string;
          id?: string;
          is_default?: boolean;
          label: string;
          language: string;
          media_version_id: string;
          playlist_path: string;
          sample_rate?: number;
        };
        Update: {
          bitrate?: number;
          channels?: number | null;
          checksum_sha256?: string;
          codec?: string;
          created_at?: string;
          id?: string;
          is_default?: boolean;
          label?: string;
          language?: string;
          media_version_id?: string;
          playlist_path?: string;
          sample_rate?: number;
        };
        Relationships: [
          {
            foreignKeyName: "audio_tracks_media_version_id_fkey";
            columns: ["media_version_id"];
            isOneToOne: false;
            referencedRelation: "media_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      content: {
        Row: {
          access_level: string;
          active_media_version_id: string | null;
          created_at: string;
          id: string;
          metadata: Json;
          release_date: string | null;
          runtime_seconds: number | null;
          state: Database["public"]["Enums"]["content_state"];
          synopsis: string | null;
          title: string;
          type: Database["public"]["Enums"]["content_type"];
          updated_at: string;
        };
        Insert: {
          access_level?: string;
          active_media_version_id?: string | null;
          created_at?: string;
          id?: string;
          metadata?: Json;
          release_date?: string | null;
          runtime_seconds?: number | null;
          state?: Database["public"]["Enums"]["content_state"];
          synopsis?: string | null;
          title: string;
          type: Database["public"]["Enums"]["content_type"];
          updated_at?: string;
        };
        Update: {
          access_level?: string;
          active_media_version_id?: string | null;
          created_at?: string;
          id?: string;
          metadata?: Json;
          release_date?: string | null;
          runtime_seconds?: number | null;
          state?: Database["public"]["Enums"]["content_state"];
          synopsis?: string | null;
          title?: string;
          type?: Database["public"]["Enums"]["content_type"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "content_active_media_version_fkey";
            columns: ["id", "active_media_version_id"];
            isOneToOne: false;
            referencedRelation: "media_versions";
            referencedColumns: ["content_id", "id"];
          },
        ];
      };
      content_genres: {
        Row: {
          content_id: string;
          created_at: string;
          genre_id: string;
        };
        Insert: {
          content_id: string;
          created_at?: string;
          genre_id: string;
        };
        Update: {
          content_id?: string;
          created_at?: string;
          genre_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "content_genres_content_id_fkey";
            columns: ["content_id"];
            isOneToOne: false;
            referencedRelation: "content";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "content_genres_genre_id_fkey";
            columns: ["genre_id"];
            isOneToOne: false;
            referencedRelation: "genres";
            referencedColumns: ["id"];
          },
        ];
      };
      episodes: {
        Row: {
          active_media_version_id: string | null;
          created_at: string;
          id: string;
          order_index: number;
          runtime_seconds: number | null;
          season_id: string;
          synopsis: string | null;
          title: string;
          updated_at: string;
        };
        Insert: {
          active_media_version_id?: string | null;
          created_at?: string;
          id?: string;
          order_index: number;
          runtime_seconds?: number | null;
          season_id: string;
          synopsis?: string | null;
          title: string;
          updated_at?: string;
        };
        Update: {
          active_media_version_id?: string | null;
          created_at?: string;
          id?: string;
          order_index?: number;
          runtime_seconds?: number | null;
          season_id?: string;
          synopsis?: string | null;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "episodes_active_media_version_fkey";
            columns: ["id", "active_media_version_id"];
            isOneToOne: false;
            referencedRelation: "media_versions";
            referencedColumns: ["episode_id", "id"];
          },
          {
            foreignKeyName: "episodes_season_id_fkey";
            columns: ["season_id"];
            isOneToOne: false;
            referencedRelation: "seasons";
            referencedColumns: ["id"];
          },
        ];
      };
      genres: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          slug: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          slug: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          slug?: string;
        };
        Relationships: [];
      };
      manifests: {
        Row: {
          checksum_sha256: string;
          created_at: string;
          id: string;
          kind: Database["public"]["Enums"]["manifest_kind"];
          media_version_id: string;
          path: string;
        };
        Insert: {
          checksum_sha256: string;
          created_at?: string;
          id?: string;
          kind: Database["public"]["Enums"]["manifest_kind"];
          media_version_id: string;
          path: string;
        };
        Update: {
          checksum_sha256?: string;
          created_at?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["manifest_kind"];
          media_version_id?: string;
          path?: string;
        };
        Relationships: [
          {
            foreignKeyName: "manifests_media_version_id_fkey";
            columns: ["media_version_id"];
            isOneToOne: false;
            referencedRelation: "media_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      media_versions: {
        Row: {
          storage_access: string;
          checksums: Json;
          content_id: string | null;
          created_at: string;
          episode_id: string | null;
          id: string;
          previous_media_version_id: string | null;
          published_at: string | null;
          r2_prefix: string;
          state: Database["public"]["Enums"]["content_state"];
          version_number: number;
        };
        Insert: {
          storage_access?: string;
          checksums: Json;
          content_id?: string | null;
          created_at?: string;
          episode_id?: string | null;
          id?: string;
          previous_media_version_id?: string | null;
          published_at?: string | null;
          r2_prefix: string;
          state?: Database["public"]["Enums"]["content_state"];
          version_number: number;
        };
        Update: {
          storage_access?: string;
          checksums?: Json;
          content_id?: string | null;
          created_at?: string;
          episode_id?: string | null;
          id?: string;
          previous_media_version_id?: string | null;
          published_at?: string | null;
          r2_prefix?: string;
          state?: Database["public"]["Enums"]["content_state"];
          version_number?: number;
        };
        Relationships: [
          {
            foreignKeyName: "media_versions_content_id_fkey";
            columns: ["content_id"];
            isOneToOne: false;
            referencedRelation: "content";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "media_versions_episode_id_fkey";
            columns: ["episode_id"];
            isOneToOne: false;
            referencedRelation: "episodes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "media_versions_previous_media_version_id_fkey";
            columns: ["previous_media_version_id"];
            isOneToOne: false;
            referencedRelation: "media_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      preferences: {
        Row: {
          autoplay: boolean;
          created_at: string;
          locale: string;
          preferred_audio_language: string | null;
          preferred_subtitle_language: string | null;
          settings: Json;
          subtitles_enabled: boolean;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          autoplay?: boolean;
          created_at?: string;
          locale?: string;
          preferred_audio_language?: string | null;
          preferred_subtitle_language?: string | null;
          settings?: Json;
          subtitles_enabled?: boolean;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          autoplay?: boolean;
          created_at?: string;
          locale?: string;
          preferred_audio_language?: string | null;
          preferred_subtitle_language?: string | null;
          settings?: Json;
          subtitles_enabled?: boolean;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "preferences_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          display_name: string | null;
          id: string;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          id: string;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      renditions: {
        Row: {
          buffer_size: number;
          checksum_sha256: string;
          codec: string;
          created_at: string;
          height: number;
          id: string;
          keyframe_interval_seconds: number;
          max_rate: number;
          media_version_id: string;
          playlist_path: string;
          quality_id: string;
          segment_duration_seconds: number;
          video_bitrate: number;
          width: number;
        };
        Insert: {
          buffer_size: number;
          checksum_sha256: string;
          codec?: string;
          created_at?: string;
          height: number;
          id?: string;
          keyframe_interval_seconds?: number;
          max_rate: number;
          media_version_id: string;
          playlist_path: string;
          quality_id: string;
          segment_duration_seconds?: number;
          video_bitrate: number;
          width: number;
        };
        Update: {
          buffer_size?: number;
          checksum_sha256?: string;
          codec?: string;
          created_at?: string;
          height?: number;
          id?: string;
          keyframe_interval_seconds?: number;
          max_rate?: number;
          media_version_id?: string;
          playlist_path?: string;
          quality_id?: string;
          segment_duration_seconds?: number;
          video_bitrate?: number;
          width?: number;
        };
        Relationships: [
          {
            foreignKeyName: "renditions_media_version_id_fkey";
            columns: ["media_version_id"];
            isOneToOne: false;
            referencedRelation: "media_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      seasons: {
        Row: {
          created_at: string;
          id: string;
          season_number: number;
          show_id: string;
          title: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          season_number: number;
          show_id: string;
          title?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          season_number?: number;
          show_id?: string;
          title?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "seasons_show_id_fkey";
            columns: ["show_id"];
            isOneToOne: false;
            referencedRelation: "shows";
            referencedColumns: ["id"];
          },
        ];
      };
      shows: {
        Row: {
          content_id: string;
          created_at: string;
          id: string;
          original_language: string | null;
          updated_at: string;
        };
        Insert: {
          content_id: string;
          created_at?: string;
          id?: string;
          original_language?: string | null;
          updated_at?: string;
        };
        Update: {
          content_id?: string;
          created_at?: string;
          id?: string;
          original_language?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shows_content_id_fkey";
            columns: ["content_id"];
            isOneToOne: true;
            referencedRelation: "content";
            referencedColumns: ["id"];
          },
        ];
      };
      subtitle_tracks: {
        Row: {
          kind: "original" | "literal" | "natural";
          has_speaker_names: boolean;
          has_context_hints: boolean;
          checksum_sha256: string;
          created_at: string;
          format: string;
          id: string;
          is_default: boolean;
          is_forced: boolean;
          label: string;
          language: string;
          media_version_id: string;
          playlist_path: string;
        };
        Insert: {
          kind?: "original" | "literal" | "natural";
          has_speaker_names?: boolean;
          has_context_hints?: boolean;
          checksum_sha256: string;
          created_at?: string;
          format?: string;
          id?: string;
          is_default?: boolean;
          is_forced?: boolean;
          label: string;
          language: string;
          media_version_id: string;
          playlist_path: string;
        };
        Update: {
          kind?: "original" | "literal" | "natural";
          has_speaker_names?: boolean;
          has_context_hints?: boolean;
          checksum_sha256?: string;
          created_at?: string;
          format?: string;
          id?: string;
          is_default?: boolean;
          is_forced?: boolean;
          label?: string;
          language?: string;
          media_version_id?: string;
          playlist_path?: string;
        };
        Relationships: [
          {
            foreignKeyName: "subtitle_tracks_media_version_id_fkey";
            columns: ["media_version_id"];
            isOneToOne: false;
            referencedRelation: "media_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      thumbnails: {
        Row: {
          created_at: string;
          height: number;
          id: string;
          interval_seconds: number;
          media_version_id: string;
          sprite_checksums: Json;
          sprite_columns: number;
          sprite_prefix: string;
          sprite_rows: number;
          vtt_checksum_sha256: string;
          vtt_path: string;
          width: number;
        };
        Insert: {
          created_at?: string;
          height?: number;
          id?: string;
          interval_seconds?: number;
          media_version_id: string;
          sprite_checksums: Json;
          sprite_columns?: number;
          sprite_prefix: string;
          sprite_rows?: number;
          vtt_checksum_sha256: string;
          vtt_path: string;
          width?: number;
        };
        Update: {
          created_at?: string;
          height?: number;
          id?: string;
          interval_seconds?: number;
          media_version_id?: string;
          sprite_checksums?: Json;
          sprite_columns?: number;
          sprite_prefix?: string;
          sprite_rows?: number;
          vtt_checksum_sha256?: string;
          vtt_path?: string;
          width?: number;
        };
        Relationships: [
          {
            foreignKeyName: "thumbnails_media_version_id_fkey";
            columns: ["media_version_id"];
            isOneToOne: false;
            referencedRelation: "media_versions";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      public_catalog: {
        Row: {
          active_media_version_id: string | null;
          created_at: string | null;
          id: string | null;
          release_date: string | null;
          runtime_seconds: number | null;
          synopsis: string | null;
          title: string | null;
          type: Database["public"]["Enums"]["content_type"] | null;
          updated_at: string | null;
        };
        Relationships: [];
      };
      analytics_video_startup_time: {
        Row: { samples: number | null; p50_ms: number | null; p95_ms: number | null };
        Relationships: [];
      };
      analytics_seek_response_time: {
        Row: { samples: number | null; p50_ms: number | null; p95_ms: number | null };
        Relationships: [];
      };
      analytics_rebuffer_ratio: {
        Row: { samples: number | null; ratio: number | null };
        Relationships: [];
      };
      analytics_playback_error_rate: {
        Row: { sessions: number | null; failed_sessions: number | null; error_rate: number | null };
        Relationships: [];
      };
      analytics_average_selected_quality: {
        Row: {
          device: string | null;
          browser: string | null;
          network: string | null;
          rendition_id: string | null;
          rendition_height: number | null;
          rendition_bitrate: number | null;
          selections: number | null;
          average_bandwidth_estimate: number | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      search_scenes: AISearchFunction;
      search_transcript: AISearchFunction;
      ai_media_scope: {
        Args: { content_id: string };
        Returns: {
          episode_id: string | null;
          episode_order: number;
          media_version_id: string;
          duration_s: number;
        }[];
      };
      consume_ai_request: { Args: { user_id: string }; Returns: boolean };
      append_ai_exchange: {
        Args: {
          user_id: string;
          content_id: string;
          episode_id: string | null;
          conversation_id: string | null;
          question: string;
          response: Json;
        };
        Returns: string;
      };
      upsert_progress: {
        Args: {
          p_content_id: string;
          p_episode_id: string | null;
          p_position_s: number;
          p_furthest_position_s: number;
          p_duration_s: number;
          p_updated_at: string;
          p_session_id?: string | null;
        };
        Returns: WatchProgressRow;
      };
      reserve_media_version: {
        Args: { p_content_id: string; p_episode_id?: string | null };
        Returns: Json;
      };
      register_media_version: { Args: { version_id: string; media: Json }; Returns: undefined };
      ready_media_version: { Args: { version_id: string }; Returns: undefined };
      fail_media_version: { Args: { version_id: string }; Returns: undefined };
      publish_media_version: {
        Args: { version_id: string };
        Returns: string;
      };
      rollback_media_version: {
        Args: { content_or_episode_id: string };
        Returns: string;
      };
    };
    Enums: {
      content_state:
        "UPLOADED" | "PROCESSING" | "AI_PROCESSING" | "VALIDATING" | "READY" | "FAILED";
      content_type: "movie" | "series" | "anime" | "concert" | "long_video";
      manifest_kind: "MASTER" | "VIDEO" | "AUDIO" | "SUBTITLE";
    };
    CompositeTypes: { ai_search_result: AISearchRow };
  };
};

type PublicSchema = Database[Extract<keyof Database, "public">];

export type Tables<
  PublicTableNameOrOptions extends
    keyof (PublicSchema["Tables"] & PublicSchema["Views"]) | { schema: keyof Database },
  TableName extends (PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
      Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer Row;
    }
    ? Row
    : never
  : PublicTableNameOrOptions extends keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    ? (PublicSchema["Tables"] & PublicSchema["Views"])[PublicTableNameOrOptions] extends {
        Row: infer Row;
      }
      ? Row
      : never
    : never;

export type TablesInsert<
  PublicTableNameOrOptions extends keyof PublicSchema["Tables"] | { schema: keyof Database },
  TableName extends (PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer Insert;
    }
    ? Insert
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends { Insert: infer Insert }
      ? Insert
      : never
    : never;

export type TablesUpdate<
  PublicTableNameOrOptions extends keyof PublicSchema["Tables"] | { schema: keyof Database },
  TableName extends (PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer Update;
    }
    ? Update
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends { Update: infer Update }
      ? Update
      : never
    : never;

export type Enums<
  PublicEnumNameOrOptions extends keyof PublicSchema["Enums"] | { schema: keyof Database },
  EnumName extends (PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : PublicEnumNameOrOptions extends keyof PublicSchema["Enums"]
    ? PublicSchema["Enums"][PublicEnumNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      content_state: ["UPLOADED", "PROCESSING", "AI_PROCESSING", "VALIDATING", "READY", "FAILED"],
      content_type: ["movie", "series", "anime", "concert", "long_video"],
      manifest_kind: ["MASTER", "VIDEO", "AUDIO", "SUBTITLE"],
    },
  },
} as const;
