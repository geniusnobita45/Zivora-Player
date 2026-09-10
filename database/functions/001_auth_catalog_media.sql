-- Atomic media publication, rollback, and the public catalog facade.

create or replace function public.publish_media_version(version_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_version public.media_versions%rowtype;
  prior_version_id uuid;
begin
  select mv.*
  into target_version
  from public.media_versions as mv
  where mv.id = $1
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = format('Media version %s does not exist', $1);
  end if;

  if target_version.state <> 'READY' then
    raise exception using
      errcode = '23514',
      message = format('Media version %s must be READY before publication', $1);
  end if;

  if target_version.published_at is not null then
    raise exception using
      errcode = '23505',
      message = format('Media version %s has already been published', $1);
  end if;

  if target_version.content_id is not null then
    select c.active_media_version_id
    into prior_version_id
    from public.content as c
    where c.id = target_version.content_id
    for update;

    if not found then
      raise exception using
        errcode = '23503',
        message = format('Content %s does not exist', target_version.content_id);
    end if;

    if prior_version_id = target_version.id then
      raise exception using
        errcode = '23505',
        message = format('Media version %s is already active', target_version.id);
    end if;

    if prior_version_id is not null and not exists (
      select 1
      from public.media_versions as prior
      where prior.id = prior_version_id
        and prior.content_id = target_version.content_id
        and prior.state = 'READY'
    ) then
      raise exception using
        errcode = '23514',
        message = 'The currently active content media version is not READY';
    end if;

    update public.media_versions
    set previous_media_version_id = prior_version_id,
        published_at = now()
    where id = target_version.id;

    update public.content
    set active_media_version_id = target_version.id,
        updated_at = now()
    where id = target_version.content_id;
  else
    select e.active_media_version_id
    into prior_version_id
    from public.episodes as e
    where e.id = target_version.episode_id
    for update;

    if not found then
      raise exception using
        errcode = '23503',
        message = format('Episode %s does not exist', target_version.episode_id);
    end if;

    if prior_version_id = target_version.id then
      raise exception using
        errcode = '23505',
        message = format('Media version %s is already active', target_version.id);
    end if;

    if prior_version_id is not null and not exists (
      select 1
      from public.media_versions as prior
      where prior.id = prior_version_id
        and prior.episode_id = target_version.episode_id
        and prior.state = 'READY'
    ) then
      raise exception using
        errcode = '23514',
        message = 'The currently active episode media version is not READY';
    end if;

    update public.media_versions
    set previous_media_version_id = prior_version_id,
        published_at = now()
    where id = target_version.id;

    update public.episodes
    set active_media_version_id = target_version.id,
        updated_at = now()
    where id = target_version.episode_id;
  end if;

  return target_version.id;
end;
$$;

create or replace function public.rollback_media_version(content_or_episode_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  parent_count integer;
  current_version_id uuid;
  current_version public.media_versions%rowtype;
  prior_version public.media_versions%rowtype;
  is_content boolean;
begin
  select
    (select count(*) from public.content as c where c.id = $1)
    + (select count(*) from public.episodes as e where e.id = $1)
  into parent_count;

  if parent_count = 0 then
    raise exception using
      errcode = 'P0002',
      message = format('Content or episode %s does not exist', $1);
  end if;

  if parent_count > 1 then
    raise exception using
      errcode = '21000',
      message = format('Identifier %s matches both content and episode rows', $1);
  end if;

  select exists (select 1 from public.content as c where c.id = $1)
  into is_content;

  if is_content then
    select c.active_media_version_id
    into current_version_id
    from public.content as c
    where c.id = $1
    for update;
  else
    select e.active_media_version_id
    into current_version_id
    from public.episodes as e
    where e.id = $1
    for update;
  end if;

  if current_version_id is null then
    raise exception using
      errcode = 'P0002',
      message = format('Content or episode %s has no active media version', $1);
  end if;

  select mv.*
  into current_version
  from public.media_versions as mv
  where mv.id = current_version_id
  for update;

  if current_version.previous_media_version_id is null then
    raise exception using
      errcode = 'P0002',
      message = format('Media version %s has no rollback target', current_version.id);
  end if;

  select mv.*
  into prior_version
  from public.media_versions as mv
  where mv.id = current_version.previous_media_version_id
  for update;

  if not found or prior_version.state <> 'READY' then
    raise exception using
      errcode = '23514',
      message = 'The rollback target does not exist or is not READY';
  end if;

  if is_content then
    if prior_version.content_id <> $1 or prior_version.episode_id is not null then
      raise exception using
        errcode = '23514',
        message = 'The rollback target does not belong to the requested content';
    end if;

    update public.content
    set active_media_version_id = prior_version.id,
        updated_at = now()
    where id = $1;
  else
    if prior_version.episode_id <> $1 or prior_version.content_id is not null then
      raise exception using
        errcode = '23514',
        message = 'The rollback target does not belong to the requested episode';
    end if;

    update public.episodes
    set active_media_version_id = prior_version.id,
        updated_at = now()
    where id = $1;
  end if;

  return prior_version.id;
end;
$$;

revoke all on function public.publish_media_version(uuid) from public, anon, authenticated;
revoke all on function public.rollback_media_version(uuid) from public, anon, authenticated;
grant execute on function public.publish_media_version(uuid) to service_role;
grant execute on function public.rollback_media_version(uuid) to service_role;

-- This view intentionally uses its owner's rights because anon/authenticated have
-- no base-table privileges. The security barrier and fixed projection/filter make
-- it the sole public catalog read surface without exposing ingestion metadata.
create view public.public_catalog
with (security_barrier = true, security_invoker = false)
as
select
  c.id,
  c.type,
  c.title,
  c.synopsis,
  c.release_date,
  c.runtime_seconds,
  c.active_media_version_id,
  c.created_at,
  c.updated_at
from public.content as c
where c.state = 'READY'
  and c.active_media_version_id is not null
  and exists (
    select 1
    from public.media_versions as mv
    where mv.id = c.active_media_version_id
      and mv.content_id = c.id
      and mv.state = 'READY'
  );

revoke all on table public.public_catalog from public;
grant select on table public.public_catalog to anon, authenticated, service_role;

comment on view public.public_catalog is
  'Public READY-only catalog facade. Base catalog and media tables remain inaccessible to anon and authenticated roles.';
