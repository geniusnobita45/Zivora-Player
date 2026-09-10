do $$ declare name text; begin
  foreach name in array array['watch_progress','watch_history','bookmarks','playback_sessions','playback_preferences'] loop
    execute format('alter table public.%I enable row level security', name);
    execute format('revoke all on public.%I from public, anon, authenticated', name);
    execute format('grant select, insert, update on public.%I to authenticated', name);
    execute format('grant select, insert, update, delete on public.%I to service_role', name);
    execute format('create policy own_rows on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', name);
  end loop;
end $$;
-- Tombstones synchronize bookmark removals; progress cannot be deleted to reset its high-water mark.
revoke all on function public.guard_playback_update() from public, anon, authenticated;
revoke all on function public.upsert_progress(uuid, uuid, double precision, double precision, double precision, timestamptz, uuid) from public, anon;
grant execute on function public.upsert_progress(uuid, uuid, double precision, double precision, double precision, timestamptz, uuid) to authenticated;
