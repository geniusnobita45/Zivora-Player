-- AUTH, CATALOG, and MEDIA domain schema.
-- This file is the first input to database/migrations/build.ts.

create type public.content_state as enum (
  'UPLOADED',
  'PROCESSING',
  'AI_PROCESSING',
  'VALIDATING',
  'READY',
  'FAILED'
);

create type public.content_type as enum (
  'movie',
  'series',
  'anime',
  'concert',
  'long_video'
);

create type public.manifest_kind as enum (
  'MASTER',
  'VIDEO',
  'AUDIO',
  'SUBTITLE'
);

-- AUTH

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length check (
    display_name is null or char_length(display_name) between 1 and 100
  )
);

create table public.preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  locale text not null default 'en',
  autoplay boolean not null default true,
  preferred_audio_language text,
  preferred_subtitle_language text,
  subtitles_enabled boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint preferences_locale_not_blank check (btrim(locale) <> ''),
  constraint preferences_audio_language_not_blank check (
    preferred_audio_language is null or btrim(preferred_audio_language) <> ''
  ),
  constraint preferences_subtitle_language_not_blank check (
    preferred_subtitle_language is null or btrim(preferred_subtitle_language) <> ''
  ),
  constraint preferences_settings_object check (jsonb_typeof(settings) = 'object')
);

-- CATALOG

create table public.content (
  id uuid primary key default gen_random_uuid(),
  type public.content_type not null,
  title text not null,
  synopsis text,
  state public.content_state not null default 'UPLOADED',
  active_media_version_id uuid,
  release_date date,
  runtime_seconds integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_title_not_blank check (btrim(title) <> ''),
  constraint content_synopsis_not_blank check (synopsis is null or btrim(synopsis) <> ''),
  constraint content_runtime_positive check (runtime_seconds is null or runtime_seconds > 0),
  constraint content_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create table public.shows (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null unique references public.content (id) on delete cascade,
  original_language text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shows_language_not_blank check (
    original_language is null or btrim(original_language) <> ''
  )
);

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references public.shows (id) on delete cascade,
  season_number integer not null,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seasons_number_nonnegative check (season_number >= 0),
  constraint seasons_title_not_blank check (title is null or btrim(title) <> ''),
  constraint seasons_show_number_unique unique (show_id, season_number)
);

create table public.episodes (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id) on delete cascade,
  title text not null,
  synopsis text,
  order_index integer not null,
  runtime_seconds integer,
  active_media_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint episodes_title_not_blank check (btrim(title) <> ''),
  constraint episodes_synopsis_not_blank check (synopsis is null or btrim(synopsis) <> ''),
  constraint episodes_order_nonnegative check (order_index >= 0),
  constraint episodes_runtime_positive check (runtime_seconds is null or runtime_seconds > 0),
  constraint episodes_season_order_unique unique (season_id, order_index)
);

create table public.genres (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  created_at timestamptz not null default now(),
  constraint genres_name_not_blank check (btrim(name) <> ''),
  constraint genres_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint genres_name_unique unique (name),
  constraint genres_slug_unique unique (slug)
);

create table public.content_genres (
  content_id uuid not null references public.content (id) on delete cascade,
  genre_id uuid not null references public.genres (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (content_id, genre_id)
);

-- MEDIA

create table public.media_versions (
  id uuid primary key default gen_random_uuid(),
  content_id uuid references public.content (id) on delete restrict,
  episode_id uuid references public.episodes (id) on delete restrict,
  version_number integer not null,
  r2_prefix text not null,
  state public.content_state not null default 'UPLOADED',
  checksums jsonb not null,
  previous_media_version_id uuid references public.media_versions (id) on delete restrict,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  constraint media_versions_exactly_one_parent check (
    num_nonnulls(content_id, episode_id) = 1
  ),
  constraint media_versions_version_positive check (version_number > 0),
  constraint media_versions_r2_prefix_not_blank check (btrim(r2_prefix) <> ''),
  constraint media_versions_checksums_object check (jsonb_typeof(checksums) = 'object'),
  constraint media_versions_previous_not_self check (
    previous_media_version_id is null or previous_media_version_id <> id
  ),
  constraint media_versions_r2_prefix_unique unique (r2_prefix),
  constraint media_versions_content_version_unique unique (content_id, version_number),
  constraint media_versions_episode_version_unique unique (episode_id, version_number),
  constraint media_versions_content_identity_unique unique (content_id, id),
  constraint media_versions_episode_identity_unique unique (episode_id, id)
);

alter table public.content
  add constraint content_active_media_version_fkey
  foreign key (id, active_media_version_id)
  references public.media_versions (content_id, id)
  on delete restrict
  deferrable initially immediate;

alter table public.episodes
  add constraint episodes_active_media_version_fkey
  foreign key (id, active_media_version_id)
  references public.media_versions (episode_id, id)
  on delete restrict
  deferrable initially immediate;

create table public.manifests (
  id uuid primary key default gen_random_uuid(),
  media_version_id uuid not null references public.media_versions (id) on delete cascade,
  kind public.manifest_kind not null,
  path text not null,
  checksum_sha256 text not null,
  created_at timestamptz not null default now(),
  constraint manifests_path_not_blank check (btrim(path) <> ''),
  constraint manifests_checksum_sha256_format check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  constraint manifests_version_path_unique unique (media_version_id, path)
);

create table public.renditions (
  id uuid primary key default gen_random_uuid(),
  media_version_id uuid not null references public.media_versions (id) on delete cascade,
  quality_id text not null,
  width integer not null,
  height integer not null,
  codec text not null default 'h264',
  video_bitrate integer not null,
  max_rate integer not null,
  buffer_size integer not null,
  keyframe_interval_seconds numeric(5, 3) not null default 2,
  segment_duration_seconds numeric(5, 3) not null default 4,
  playlist_path text not null,
  checksum_sha256 text not null,
  created_at timestamptz not null default now(),
  constraint renditions_quality_ladder check (
    (quality_id, width, height) in (
      ('1080p', 1920, 1080),
      ('720p', 1280, 720),
      ('480p', 854, 480),
      ('360p', 640, 360)
    )
  ),
  constraint renditions_h264_only check (codec = 'h264'),
  constraint renditions_rates_positive check (
    video_bitrate > 0 and max_rate >= video_bitrate and buffer_size > 0
  ),
  constraint renditions_keyframes_aligned check (keyframe_interval_seconds = 2),
  constraint renditions_four_second_segments check (segment_duration_seconds = 4),
  constraint renditions_playlist_not_blank check (btrim(playlist_path) <> ''),
  constraint renditions_checksum_sha256_format check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  constraint renditions_version_quality_unique unique (media_version_id, quality_id),
  constraint renditions_version_playlist_unique unique (media_version_id, playlist_path)
);

create table public.audio_tracks (
  id uuid primary key default gen_random_uuid(),
  media_version_id uuid not null references public.media_versions (id) on delete cascade,
  language text not null,
  label text not null,
  codec text not null default 'aac',
  channels integer,
  bitrate integer not null default 192000,
  sample_rate integer not null default 48000,
  playlist_path text not null,
  checksum_sha256 text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  constraint audio_tracks_language_not_blank check (btrim(language) <> ''),
  constraint audio_tracks_label_not_blank check (btrim(label) <> ''),
  constraint audio_tracks_aac_only check (codec = 'aac'),
  constraint audio_tracks_channels_positive check (channels is null or channels > 0),
  constraint audio_tracks_bitrate_positive check (bitrate > 0),
  constraint audio_tracks_sample_rate_positive check (sample_rate > 0),
  constraint audio_tracks_playlist_not_blank check (btrim(playlist_path) <> ''),
  constraint audio_tracks_checksum_sha256_format check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  constraint audio_tracks_version_language_unique unique (media_version_id, language),
  constraint audio_tracks_version_playlist_unique unique (media_version_id, playlist_path)
);

create table public.subtitle_tracks (
  id uuid primary key default gen_random_uuid(),
  media_version_id uuid not null references public.media_versions (id) on delete cascade,
  language text not null,
  label text not null,
  format text not null default 'webvtt',
  playlist_path text not null,
  checksum_sha256 text not null,
  is_default boolean not null default false,
  is_forced boolean not null default false,
  created_at timestamptz not null default now(),
  constraint subtitle_tracks_language_not_blank check (btrim(language) <> ''),
  constraint subtitle_tracks_label_not_blank check (btrim(label) <> ''),
  constraint subtitle_tracks_webvtt_only check (format = 'webvtt'),
  constraint subtitle_tracks_playlist_not_blank check (btrim(playlist_path) <> ''),
  constraint subtitle_tracks_checksum_sha256_format check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  constraint subtitle_tracks_version_language_unique unique (media_version_id, language),
  constraint subtitle_tracks_version_playlist_unique unique (media_version_id, playlist_path)
);

create table public.thumbnails (
  id uuid primary key default gen_random_uuid(),
  media_version_id uuid not null references public.media_versions (id) on delete cascade,
  interval_seconds integer not null default 5,
  width integer not null default 320,
  height integer not null default 180,
  sprite_columns integer not null default 10,
  sprite_rows integer not null default 10,
  sprite_prefix text not null,
  sprite_checksums jsonb not null,
  vtt_path text not null,
  vtt_checksum_sha256 text not null,
  created_at timestamptz not null default now(),
  constraint thumbnails_five_second_interval check (interval_seconds = 5),
  constraint thumbnails_dimensions check (width = 320 and height = 180),
  constraint thumbnails_grid check (sprite_columns = 10 and sprite_rows = 10),
  constraint thumbnails_sprite_prefix_not_blank check (btrim(sprite_prefix) <> ''),
  constraint thumbnails_sprite_checksums_object check (jsonb_typeof(sprite_checksums) = 'object'),
  constraint thumbnails_vtt_path_not_blank check (btrim(vtt_path) <> ''),
  constraint thumbnails_vtt_checksum_sha256_format check (
    vtt_checksum_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint thumbnails_version_vtt_unique unique (media_version_id, vtt_path)
);
