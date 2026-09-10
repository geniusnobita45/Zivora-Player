-- All RPCs are invoker functions granted only to service_role in the final layer.
-- One advisory lock per parent serializes reservations, activation and rollback.
create function public.reserve_media_version(p_content_id uuid, p_episode_id uuid default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare n integer; c public.content%rowtype; v public.media_versions%rowtype; prefix text;
begin
  if p_content_id is null then raise exception 'Content is required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(coalesce(p_episode_id, p_content_id)::text, 0));
  select * into strict c from public.content where id = p_content_id for update;
  if p_episode_id is not null then
    perform 1 from public.episodes e join public.seasons s on s.id = e.season_id
      join public.shows sh on sh.id = s.show_id where e.id = p_episode_id and sh.content_id = p_content_id;
    if not found then raise exception 'Episode does not belong to content'; end if;
  end if;
  select coalesce(max(version_number), 0) + 1 into n from public.media_versions
    where (p_episode_id is null and content_id = p_content_id) or (p_episode_id is not null and episode_id = p_episode_id);
  prefix := 'media/' || p_content_id || '/' || case when p_episode_id is null then '' else p_episode_id || '/' end || 'v' || n || '/';
  insert into public.media_versions(content_id, episode_id, version_number, r2_prefix, checksums, storage_access)
    values(case when p_episode_id is null then p_content_id else null end, p_episode_id, n, prefix, '{}'::jsonb, c.access_level)
    returning * into v;
  return jsonb_build_object('id', v.id, 'contentId', p_content_id, 'episodeId', p_episode_id,
    'versionNumber', n, 'prefix', prefix, 'access', c.access_level);
end $$;

create function public.register_media_version(version_id uuid, media jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare v public.media_versions%rowtype;
begin
  select * into strict v from public.media_versions where id = $1 for update;
  if v.state <> 'UPLOADED' or v.published_at is not null then raise exception 'Reservation cannot be registered again'; end if;
  if jsonb_typeof(media->'checksums') is distinct from 'object' or media->'checksums' = '{}'::jsonb then raise exception 'Checksums are required'; end if;
  if exists(select 1 from jsonb_each_text(media->'checksums') a where a.value is null or a.value !~ '^[a-f0-9]{64}$' or a.key !~ '^[A-Za-z0-9_-][A-Za-z0-9._-]*(/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$') then raise exception 'Invalid checksums'; end if;
  if jsonb_typeof(media->'manifests') is distinct from 'array' or jsonb_typeof(media->'renditions') is distinct from 'array'
    or jsonb_typeof(media->'audio_tracks') is distinct from 'array' or jsonb_typeof(media->'subtitle_tracks') is distinct from 'array'
    or jsonb_typeof(media->'thumbnails') is distinct from 'array' then raise exception 'Media inventories must be arrays'; end if;
  if jsonb_array_length(media->'renditions') <> 4 or jsonb_array_length(media->'audio_tracks') < 1
    or jsonb_array_length(media->'thumbnails') < 1 then raise exception 'Incomplete media inventory'; end if;
  -- Intelligence and local validation already ran at ingestion. Record the frozen
  -- processing progression together with registration in this single transaction.
  update public.media_versions set state = 'PROCESSING' where id = $1;
  update public.media_versions set state = 'AI_PROCESSING' where id = $1;
  update public.media_versions set state = 'VALIDATING', checksums = media->'checksums' where id = $1;
  insert into public.manifests(media_version_id, kind, path, checksum_sha256)
    select $1, x.kind::public.manifest_kind, x.path, x.checksum_sha256
    from jsonb_to_recordset(media->'manifests') x(kind text, path text, checksum_sha256 text);
  insert into public.renditions(media_version_id, quality_id, width, height, video_bitrate, max_rate, buffer_size, playlist_path, checksum_sha256)
    select $1, x.quality_id, x.width, x.height, x.video_bitrate, x.max_rate, x.buffer_size, x.playlist_path, x.checksum_sha256
    from jsonb_to_recordset(media->'renditions') x(quality_id text, width integer, height integer, video_bitrate integer, max_rate integer, buffer_size integer, playlist_path text, checksum_sha256 text);
  insert into public.audio_tracks(media_version_id, language, label, playlist_path, checksum_sha256, is_default)
    select $1, x.language, x.label, x.playlist_path, x.checksum_sha256, x.is_default
    from jsonb_to_recordset(media->'audio_tracks') x(language text, label text, playlist_path text, checksum_sha256 text, is_default boolean);
  insert into public.subtitle_tracks(media_version_id, language, label, playlist_path, checksum_sha256, is_default, is_forced)
    select $1, x.language, x.label, x.playlist_path, x.checksum_sha256, x.is_default, x.is_forced
    from jsonb_to_recordset(media->'subtitle_tracks') x(language text, label text, playlist_path text, checksum_sha256 text, is_default boolean, is_forced boolean);
  insert into public.thumbnails(media_version_id, sprite_prefix, sprite_checksums, vtt_path, vtt_checksum_sha256)
    select $1, x.sprite_prefix, x.sprite_checksums, x.vtt_path, x.vtt_checksum_sha256
    from jsonb_to_recordset(media->'thumbnails') x(sprite_prefix text, sprite_checksums jsonb, vtt_path text, vtt_checksum_sha256 text);
end $$;

create function public.ready_media_version(version_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare v public.media_versions%rowtype;
begin
  select * into strict v from public.media_versions where id = $1 for update;
  if v.state <> 'VALIDATING' then raise exception 'Only validated media can become READY'; end if;
  if (select count(*) from public.manifests where media_version_id = $1 and kind = 'MASTER') <> 1
    or (select count(*) from public.renditions where media_version_id = $1) <> 4
    or (select count(*) from public.audio_tracks where media_version_id = $1 and is_default) <> 1
    or not exists(select 1 from public.thumbnails where media_version_id = $1) then raise exception 'Incomplete registered media'; end if;
  if exists (
    select 1 from (
      select path, checksum_sha256 from public.manifests where media_version_id = $1
      union all select playlist_path, checksum_sha256 from public.renditions where media_version_id = $1
      union all select playlist_path, checksum_sha256 from public.audio_tracks where media_version_id = $1
      union all select playlist_path, checksum_sha256 from public.subtitle_tracks where media_version_id = $1
      union all select vtt_path, vtt_checksum_sha256 from public.thumbnails where media_version_id = $1
    ) a where v.checksums->>a.path is distinct from a.checksum_sha256
  ) then raise exception 'Registered paths must match validated checksums'; end if;
  if exists(select 1 from public.thumbnails t where t.media_version_id = $1 and (t.sprite_checksums = '{}'::jsonb or exists(
    select 1 from jsonb_each_text(t.sprite_checksums) s where v.checksums->>s.key is distinct from s.value or s.key not like t.sprite_prefix || '%'
  ))) then raise exception 'Thumbnail sprites must match validated checksums'; end if;
  update public.media_versions set state = 'READY' where id = $1;
end $$;

create or replace function public.publish_media_version(version_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v public.media_versions%rowtype; prior uuid; access text; parent uuid;
begin
  select coalesce(episode_id, content_id) into strict parent from public.media_versions where id = $1;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(parent::text, 0));
  select * into strict v from public.media_versions where id = $1 for update;
  if v.state <> 'READY' then raise exception 'Media version must be READY'; end if;
  if v.content_id is not null then
    select active_media_version_id, access_level into prior, access from public.content where id = v.content_id for update;
  else
    select active_media_version_id into prior from public.episodes where id = v.episode_id for update;
    select c.access_level into access from public.episodes e join public.seasons s on s.id = e.season_id
      join public.shows sh on sh.id = s.show_id join public.content c on c.id = sh.content_id where e.id = v.episode_id;
  end if;
  if access is distinct from v.storage_access then raise exception 'Storage access no longer matches content'; end if;
  if prior = v.id and v.published_at is not null then return v.id; end if;
  if v.published_at is not null then raise exception 'Published versions can only be reactivated through rollback'; end if;
  update public.media_versions set previous_media_version_id = prior, published_at = now() where id = $1;
  if v.content_id is not null then
    update public.content set active_media_version_id = v.id, updated_at = now() where id = v.content_id;
  else
    update public.episodes set active_media_version_id = v.id, updated_at = now() where id = v.episode_id;
  end if;
  return v.id;
end $$;

create or replace function public.rollback_media_version(content_or_episode_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare current_id uuid; current_v public.media_versions%rowtype; prior public.media_versions%rowtype; is_content boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text, 0));
  if (select count(*) from public.content where id = $1) + (select count(*) from public.episodes where id = $1) <> 1 then raise exception 'Parent is missing or ambiguous'; end if;
  select exists(select 1 from public.content where id = $1) into is_content;
  if is_content then select active_media_version_id into current_id from public.content where id = $1 for update;
  else select active_media_version_id into current_id from public.episodes where id = $1 for update; end if;
  select * into strict current_v from public.media_versions where id = current_id for update;
  select * into strict prior from public.media_versions where id = current_v.previous_media_version_id for update;
  if prior.state <> 'READY' or prior.published_at is null or prior.storage_access <> current_v.storage_access
    or prior.content_id is distinct from current_v.content_id or prior.episode_id is distinct from current_v.episode_id then raise exception 'Invalid rollback target'; end if;
  if is_content then update public.content set active_media_version_id = prior.id, updated_at = now() where id = $1;
  else update public.episodes set active_media_version_id = prior.id, updated_at = now() where id = $1; end if;
  return prior.id;
end $$;

create function public.fail_media_version(version_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.media_versions set state = 'FAILED' where id = $1 and published_at is null;
end $$;

create function public.guard_published_media()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.published_at is not null and (tg_op = 'DELETE' or new is distinct from old) then raise exception 'Published media versions are immutable'; end if;
  if tg_op = 'DELETE' then return old; end if;
  if old.state = 'READY' and (new.checksums is distinct from old.checksums or new.state not in ('READY','FAILED')) then raise exception 'Validated media is immutable'; end if;
  if new.content_id is distinct from old.content_id or new.episode_id is distinct from old.episode_id
    or new.r2_prefix <> old.r2_prefix or new.version_number <> old.version_number or new.storage_access <> old.storage_access then raise exception 'Version allocation is immutable'; end if;
  return new;
end $$;
create trigger guard_published_media before update or delete on public.media_versions for each row execute function public.guard_published_media();

create function public.guard_media_assets()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare target uuid; status public.content_state;
begin
  if tg_op <> 'INSERT' then
    select state into status from public.media_versions where id = old.media_version_id for update;
    if status = 'READY' then raise exception 'READY media assets are immutable'; end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  target := new.media_version_id;
  select state into status from public.media_versions where id = target for update;
  if status = 'READY' then raise exception 'READY media assets are immutable'; end if;
  return new;
end $$;
create trigger guard_manifests before insert or update or delete on public.manifests for each row execute function public.guard_media_assets();
create trigger guard_renditions before insert or update or delete on public.renditions for each row execute function public.guard_media_assets();
create trigger guard_audio_tracks before insert or update or delete on public.audio_tracks for each row execute function public.guard_media_assets();
create trigger guard_subtitle_tracks before insert or update or delete on public.subtitle_tracks for each row execute function public.guard_media_assets();
create trigger guard_thumbnails before insert or update or delete on public.thumbnails for each row execute function public.guard_media_assets();

create function public.guard_content_access()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.access_level <> old.access_level and exists (
    select 1 from public.media_versions v where v.content_id = old.id or v.episode_id in (
      select e.id from public.episodes e join public.seasons s on s.id = e.season_id join public.shows sh on sh.id = s.show_id where sh.content_id = old.id
    )
  ) then raise exception 'Content access cannot change after a storage reservation'; end if;
  return new;
end $$;
create trigger guard_content_access before update on public.content for each row execute function public.guard_content_access();
