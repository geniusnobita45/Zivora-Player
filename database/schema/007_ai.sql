create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content_id uuid references public.content(id) on delete cascade,
  episode_id uuid references public.episodes(id) on delete cascade,
  title text check (title is null or length(btrim(title)) between 1 and 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null check (length(btrim(content)) between 1 and 100000),
  citations jsonb not null default '[]'::jsonb check (jsonb_typeof(citations) = 'array'),
  model text,
  created_at timestamptz not null default now()
);

create table public.ai_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  cache_key text not null unique check (cache_key ~ '^[a-f0-9]{64}$'),
  task_type text not null check (task_type in ('cheap_chat','complex_reasoning','embedding','transcription','vision')),
  provider text not null check (btrim(provider) <> ''),
  model text not null check (btrim(model) <> ''),
  response jsonb not null,
  expires_at timestamptz not null,
  hit_count bigint not null default 0 check (hit_count >= 0),
  created_at timestamptz not null default now()
);

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  user_id uuid references auth.users(id) on delete set null,
  conversation_id uuid references public.ai_conversations(id) on delete set null,
  task_type text not null check (task_type in ('cheap_chat','complex_reasoning','embedding','transcription','vision')),
  provider text not null check (btrim(provider) <> ''),
  model text not null check (btrim(model) <> ''),
  cost_tier text not null check (cost_tier in ('low','standard','premium')),
  attempts integer not null check (attempts between 1 and 20),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  total_tokens integer generated always as (input_tokens + output_tokens) stored,
  cost_usd numeric(12,8) not null default 0 check (cost_usd >= 0),
  duration_ms integer not null check (duration_ms >= 0),
  success boolean not null,
  error_code text,
  created_at timestamptz not null default now()
);

create table public.ai_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  maximum_cost_tier text not null default 'standard' check (maximum_cost_tier in ('low','standard','premium')),
  preferred_language text,
  allow_history boolean not null default true,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  updated_at timestamptz not null default now()
);
