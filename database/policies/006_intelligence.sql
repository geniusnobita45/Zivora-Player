do $$ declare name text; begin
  foreach name in array array['transcripts','transcript_segments','scenes','scene_embeddings','characters','character_appearances','chapters','skip_segments','recap_segments','entities'] loop
    execute format('alter table public.%I enable row level security', name);
    execute format('revoke all on table public.%I from public, anon, authenticated', name);
    execute format('grant select, insert, update, delete on table public.%I to service_role', name);
  end loop;
end $$;
