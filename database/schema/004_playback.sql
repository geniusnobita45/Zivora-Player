create table public.watch_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content_id uuid not null references public.content(id) on delete cascade,
  episode_id uuid references public.episodes(id) on delete cascade,
  position_s double precision not null check (position_s between 0 and 86400),
  furthest_position_s double precision not null check (furthest_position_s between position_s and 86400),
  duration_s double precision not null check (duration_s > 0 and duration_s <= 86400 and position_s <= duration_s),
  updated_at timestamptz not null,
  unique nulls not distinct (user_id, content_id, episode_id)
);
create table public.watch_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content_id uuid not null references public.content(id) on delete cascade,
  episode_id uuid references public.episodes(id) on delete cascade,
  position_s double precision not null check (position_s between 0 and 86400),
  completed boolean not null default false,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null,
  unique nulls not distinct (user_id, content_id, episode_id)
);
create table public.bookmarks (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  content_id uuid not null references public.content(id) on delete cascade,
  episode_id uuid references public.episodes(id) on delete cascade,
  position_s double precision not null check (position_s between 0 and 86400),
  title text not null check (length(btrim(title)) between 1 and 300),
  deleted boolean not null default false,
  updated_at timestamptz not null
);
create table public.playback_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  content_id uuid not null references public.content(id) on delete cascade,
  episode_id uuid references public.episodes(id) on delete cascade,
  position_s double precision not null check (position_s between 0 and 86400),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null
);
create table public.playback_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  auto_next boolean not null default true,
  volume double precision not null default 1 check (volume between 0 and 1),
  muted boolean not null default false,
  playback_rate double precision not null default 1 check (playback_rate between 0.25 and 3),
  updated_at timestamptz not null default now()
);
