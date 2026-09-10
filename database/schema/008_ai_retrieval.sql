-- Retrieval and orchestration reuse the frozen INTELLIGENCE and AI tables.
create type public.ai_search_result as (
  id uuid, kind text, content_id uuid, episode_id uuid, media_version_id uuid,
  episode_order integer, start_s double precision, end_s double precision, title text, text text,
  character_ids uuid[], chapter_id uuid, chapter_title text,
  fused_score double precision, vector_score double precision, keyword_score double precision
);
