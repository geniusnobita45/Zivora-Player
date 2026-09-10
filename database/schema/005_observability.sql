-- OBSERVABILITY. Client metadata is deliberately coarse; no raw user agent, URL, stack, or IP is stored.
create table public.playback_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  user_id uuid references auth.users(id) on delete set null,
  content_id uuid not null references public.content(id) on delete restrict,
  episode_id uuid references public.episodes(id) on delete set null,
  media_version_id uuid references public.media_versions(id) on delete set null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  event_type text not null check (event_type in ('session_started','playing','paused','session_snapshot','ended','buffering','seek','quality','error')),
  position_s double precision check (position_s is null or position_s between 0 and 86400),
  startup_ms double precision check (startup_ms is null or startup_ms between 0 and 86400000),
  watch_duration_ms double precision check (watch_duration_ms is null or watch_duration_ms between 0 and 86400000),
  total_buffer_ms double precision check (total_buffer_ms is null or total_buffer_ms between 0 and 86400000),
  completion_percentage double precision check (completion_percentage is null or completion_percentage between 0 and 100),
  failed_requests integer check (failed_requests is null or failed_requests between 0 and 10000),
  device text not null check (char_length(device) between 1 and 80),
  browser text not null check (char_length(browser) between 1 and 80),
  os text not null check (char_length(os) between 1 and 80),
  network text not null check (char_length(network) between 1 and 80),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object')
);

create table public.playback_errors (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  user_id uuid references auth.users(id) on delete set null,
  content_id uuid not null references public.content(id) on delete restrict,
  episode_id uuid references public.episodes(id) on delete set null,
  media_version_id uuid references public.media_versions(id) on delete set null,
  occurred_at timestamptz not null,
  code text not null check (char_length(code) between 1 and 120),
  category text not null check (category in ('network','manifest','media','drm','adapter','unknown')),
  fatal boolean not null,
  recoverable boolean not null,
  device text not null check (char_length(device) between 1 and 80),
  browser text not null check (char_length(browser) between 1 and 80),
  network text not null check (char_length(network) between 1 and 80)
);

create table public.buffering_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  user_id uuid references auth.users(id) on delete set null,
  content_id uuid not null references public.content(id) on delete restrict,
  episode_id uuid references public.episodes(id) on delete set null,
  media_version_id uuid references public.media_versions(id) on delete set null,
  occurred_at timestamptz not null,
  position_s double precision check (position_s is null or position_s between 0 and 86400),
  duration_ms double precision not null check (duration_ms between 0 and 86400000),
  device text not null check (char_length(device) between 1 and 80),
  browser text not null check (char_length(browser) between 1 and 80),
  network text not null check (char_length(network) between 1 and 80)
);

create table public.seek_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  user_id uuid references auth.users(id) on delete set null,
  content_id uuid not null references public.content(id) on delete restrict,
  episode_id uuid references public.episodes(id) on delete set null,
  media_version_id uuid references public.media_versions(id) on delete set null,
  occurred_at timestamptz not null,
  from_position_s double precision not null check (from_position_s between 0 and 86400),
  to_position_s double precision not null check (to_position_s between 0 and 86400),
  latency_ms double precision check (latency_ms is null or latency_ms between 0 and 86400000),
  device text not null check (char_length(device) between 1 and 80),
  browser text not null check (char_length(browser) between 1 and 80),
  network text not null check (char_length(network) between 1 and 80)
);

create table public.quality_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  user_id uuid references auth.users(id) on delete set null,
  content_id uuid not null references public.content(id) on delete restrict,
  episode_id uuid references public.episodes(id) on delete set null,
  media_version_id uuid references public.media_versions(id) on delete set null,
  occurred_at timestamptz not null,
  rendition_id text not null check (char_length(rendition_id) between 1 and 120),
  rendition_height integer check (rendition_height is null or rendition_height between 1 and 16384),
  rendition_bitrate integer check (rendition_bitrate is null or rendition_bitrate between 1 and 200000000),
  bandwidth_estimate double precision check (bandwidth_estimate is null or bandwidth_estimate between 0 and 10000000000),
  device text not null check (char_length(device) between 1 and 80),
  browser text not null check (char_length(browser) between 1 and 80),
  network text not null check (char_length(network) between 1 and 80)
);
