-- AUTH, CATALOG, and MEDIA domain indexes.
-- Unique constraints in the schema already provide their own B-tree indexes.

create index content_ready_catalog_idx
  on public.content (created_at desc, id)
  where state = 'READY' and active_media_version_id is not null;

create index content_active_media_version_idx
  on public.content (active_media_version_id)
  where active_media_version_id is not null;

create index episodes_active_media_version_idx
  on public.episodes (active_media_version_id)
  where active_media_version_id is not null;

create index content_genres_genre_id_idx
  on public.content_genres (genre_id, content_id);

create index media_versions_previous_media_version_id_idx
  on public.media_versions (previous_media_version_id)
  where previous_media_version_id is not null;

create index media_versions_content_state_created_idx
  on public.media_versions (content_id, state, created_at desc)
  where content_id is not null;

create index media_versions_episode_state_created_idx
  on public.media_versions (episode_id, state, created_at desc)
  where episode_id is not null;

create index manifests_media_version_kind_idx
  on public.manifests (media_version_id, kind);

create unique index manifests_one_master_per_version_idx
  on public.manifests (media_version_id)
  where kind = 'MASTER';

create unique index audio_tracks_one_default_per_version_idx
  on public.audio_tracks (media_version_id)
  where is_default;

create unique index subtitle_tracks_one_default_per_version_idx
  on public.subtitle_tracks (media_version_id)
  where is_default;

create index subtitle_tracks_forced_idx
  on public.subtitle_tracks (media_version_id, language)
  where is_forced;
