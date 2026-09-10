-- Protect monotonic progress even from a direct authenticated table update.
create function public.guard_playback_update() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.updated_at < '1970-01-01'::timestamptz or new.updated_at > now() + interval '5 minutes' then
    raise exception 'Invalid playback timestamp';
  end if;
  if TG_OP = 'UPDATE' then
    if new.user_id <> old.user_id or new.content_id <> old.content_id
       or new.episode_id is distinct from old.episode_id or new.id <> old.id then
      raise exception 'Playback identity is immutable';
    end if;
    if TG_TABLE_NAME = 'watch_progress' then
      new.furthest_position_s := greatest(new.furthest_position_s, old.furthest_position_s, new.position_s);
      if new.updated_at <= old.updated_at then
        new.position_s := old.position_s;
        new.duration_s := old.duration_s;
        new.updated_at := old.updated_at;
      end if;
    elsif new.updated_at <= old.updated_at then return old;
    end if;
  end if;
  return new;
end $$;
create trigger watch_progress_guard before insert or update on public.watch_progress
for each row execute function public.guard_playback_update();
create trigger bookmarks_guard before insert or update on public.bookmarks
for each row execute function public.guard_playback_update();
create trigger playback_sessions_guard before insert or update on public.playback_sessions
for each row execute function public.guard_playback_update();

create function public.upsert_progress(
  p_content_id uuid, p_episode_id uuid, p_position_s double precision,
  p_furthest_position_s double precision, p_duration_s double precision,
  p_updated_at timestamptz, p_session_id uuid default null
) returns public.watch_progress
language plpgsql security invoker set search_path = '' as $$
declare saved public.watch_progress; caller uuid := auth.uid();
begin
  if caller is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  insert into public.watch_progress(user_id, content_id, episode_id, position_s, furthest_position_s, duration_s, updated_at)
  values(caller, p_content_id, p_episode_id, p_position_s, greatest(p_position_s, p_furthest_position_s), p_duration_s, p_updated_at)
  on conflict (user_id, content_id, episode_id) do update set
    position_s = excluded.position_s,
    furthest_position_s = greatest(watch_progress.furthest_position_s, excluded.furthest_position_s),
    duration_s = excluded.duration_s, updated_at = excluded.updated_at
  returning * into saved;

  insert into public.watch_history(user_id, content_id, episode_id, position_s, completed, updated_at)
  values(caller, p_content_id, p_episode_id, saved.position_s, saved.position_s >= saved.duration_s - least(10, saved.duration_s * 0.05), saved.updated_at)
  on conflict (user_id, content_id, episode_id) do update set
    position_s = case when excluded.updated_at > watch_history.updated_at then excluded.position_s else watch_history.position_s end,
    completed = watch_history.completed or excluded.completed,
    updated_at = greatest(watch_history.updated_at, excluded.updated_at);
  if p_session_id is not null then
    insert into public.playback_sessions(id, user_id, content_id, episode_id, position_s, updated_at)
    values(p_session_id, caller, p_content_id, p_episode_id, p_position_s, p_updated_at)
    on conflict (id) do update set position_s = excluded.position_s, updated_at = excluded.updated_at;
  end if;
  return saved;
end $$;
