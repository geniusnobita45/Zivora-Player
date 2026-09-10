-- All catalog ordinals are zero-based across seasons, including unpublished episodes.
create or replace function public.ai_media_scope(content_id uuid)
returns table(episode_id uuid, episode_order integer, media_version_id uuid, duration_s double precision)
language sql stable security invoker set search_path = ''
as $$
with ordered as (
  select e.id, e.active_media_version_id, e.runtime_seconds,
    (row_number() over(order by se.season_number, e.order_index, e.id) - 1)::integer as ordinal
  from public.episodes e join public.seasons se on se.id = e.season_id
  join public.shows sh on sh.id = se.show_id
  where sh.content_id = $1
), targets as (
  select null::uuid episode_id, 0 ordinal, c.active_media_version_id version_id, c.runtime_seconds
  from public.content c where c.id = $1 and c.state = 'READY' and c.active_media_version_id is not null
  union all
  select o.id, o.ordinal, o.active_media_version_id, o.runtime_seconds
  from ordered o join public.content c on c.id = $1 and c.state = 'READY'
)
select t.episode_id, t.ordinal, v.id,
  coalesce(tr.duration_s, t.runtime_seconds::double precision, 86400)
from targets t join public.media_versions v on v.id = t.version_id and v.state = 'READY'
left join public.transcripts tr on tr.media_version_id = v.id
$$;

create or replace function public.search_scenes(
  query_embedding extensions.vector(1536), query_text text, content_id uuid,
  boundary_episode_order integer, boundary_seconds double precision,
  filters jsonb default '{}'::jsonb, "limit" integer default 10
) returns setof public.ai_search_result
language plpgsql stable security invoker set search_path = '' as $$
begin
  if $3 is null or $4 is null or $4 < 0 or $5 is null or not ($5 between 0 and 86400)
    or $7 is null or $7 < 1 or $7 > 30 or $2 is null or length($2) > 2000
    or jsonb_typeof($6) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys($6) k where k not in
      ('episode_id','character_id','chapter_id','language','embedding_model','media_version_ids'))
    or ($1 is not null and extensions.vector_dims($1) <> 1536)
  then raise exception using errcode = '22023', message = 'Invalid retrieval request'; end if;
  if $6 ? 'media_version_ids' and
    (jsonb_typeof($6->'media_version_ids') <> 'array' or jsonb_array_length($6->'media_version_ids') > 10000)
  then raise exception using errcode = '22023', message = 'Invalid version filter'; end if;
  return query
  with safe as materialized (
    select s.id, m.episode_id, m.episode_order, s.media_version_id, s.start_s, s.end_s,
      s.title, s.summary as body,
      s.search_vector, emb.embedding, emb.embedding_model,
      coalesce(chars.ids, '{}'::uuid[]) as character_ids, ch.id as chapter_id, ch.title as chapter_title
    from public.scenes s
    join public.ai_media_scope($3) m on m.media_version_id = s.media_version_id
    left join public.scene_embeddings emb on emb.scene_id = s.id and emb.media_version_id = s.media_version_id
    left join public.transcripts tr on tr.media_version_id = s.media_version_id
    left join lateral (
      select array_agg(distinct ca.character_id) as ids from public.character_appearances ca
      join public.scenes cs on cs.id = ca.scene_id and cs.media_version_id = ca.media_version_id
      where ca.media_version_id = s.media_version_id
        and cs.start_s <= s.start_s and cs.end_s >= s.end_s
        and (m.episode_order < $4 or (m.episode_order = $4 and cs.end_s <= $5))
    ) chars on true
    left join lateral (
      select cp.id, cp.title from public.chapters cp
      where cp.media_version_id = s.media_version_id and cp.start_s <= s.start_s and cp.end_s >= s.end_s
        and (m.episode_order < $4 or (m.episode_order = $4 and cp.end_s <= $5))
      order by cp.start_s desc, cp.id limit 1
    ) ch on true
    where (m.episode_order < $4 or (m.episode_order = $4 and s.end_s <= $5))
      and (not ($6 ? 'episode_id') or m.episode_id = ($6->>'episode_id')::uuid)
      and (not ($6 ? 'character_id') or ($6->>'character_id')::uuid = any(chars.ids))
      and (not ($6 ? 'chapter_id') or ch.id = ($6->>'chapter_id')::uuid)
      and (not ($6 ? 'language') or tr.language = $6->>'language')
      and (not ($6 ? 'media_version_ids') or s.media_version_id::text in
        (select jsonb_array_elements_text($6->'media_version_ids')))
  ), lexical as (
    select s.id, ts_rank_cd(s.search_vector, websearch_to_tsquery('simple', $2))::double precision as relevance,
      row_number() over(order by ts_rank_cd(s.search_vector, websearch_to_tsquery('simple', $2)) desc, s.id) as rank
    from safe s where s.search_vector @@ websearch_to_tsquery('simple', $2)
    order by relevance desc, s.id limit $7 * 4
  ), semantic as (
    select s.id, greatest(-1.0, least(1.0, 1 - (s.embedding operator(extensions.<=>) $1))) as similarity,
      row_number() over(order by s.embedding operator(extensions.<=>) $1, s.id) as rank
    from safe s where $1 is not null and s.embedding is not null
      and (not ($6 ? 'embedding_model') or s.embedding_model = $6->>'embedding_model')
      and (s.embedding operator(extensions.<=>) $1) < 0.8
    order by s.embedding operator(extensions.<=>) $1, s.id limit $7 * 4
  ), fused as (
    select coalesce(l.id, v.id) id, coalesce(1.0/(60+l.rank),0) + coalesce(1.0/(60+v.rank),0) score,
      v.similarity, coalesce(l.relevance,0) relevance
    from lexical l full outer join semantic v on l.id = v.id
  )
  select s.id, 'scene'::text, $3, s.episode_id, s.media_version_id, s.episode_order,
    s.start_s, s.end_s, s.title, s.body, s.character_ids, s.chapter_id, s.chapter_title,
    f.score::double precision, f.similarity::double precision, f.relevance
  from fused f join safe s on s.id = f.id order by f.score desc, s.id limit $7;
end;
$$;

create or replace function public.search_transcript(
  query_embedding extensions.vector(1536), query_text text, content_id uuid,
  boundary_episode_order integer, boundary_seconds double precision,
  filters jsonb default '{}'::jsonb, "limit" integer default 10
) returns setof public.ai_search_result
language plpgsql stable security invoker set search_path = '' as $$
begin
  if $3 is null or $4 is null or $4 < 0 or $5 is null or not ($5 between 0 and 86400)
    or $7 is null or $7 < 1 or $7 > 30 or $2 is null or length($2) > 2000
    or jsonb_typeof($6) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys($6) k where k not in
      ('episode_id','character_id','chapter_id','language','embedding_model','media_version_ids'))
    or ($1 is not null and extensions.vector_dims($1) <> 1536)
  then raise exception using errcode = '22023', message = 'Invalid retrieval request'; end if;
  if $6 ? 'media_version_ids' and
    (jsonb_typeof($6->'media_version_ids') <> 'array' or jsonb_array_length($6->'media_version_ids') > 10000)
  then raise exception using errcode = '22023', message = 'Invalid version filter'; end if;
  return query
  with safe as materialized (
    select s.id, m.episode_id, m.episode_order, s.media_version_id, s.start_s, s.end_s,
      coalesce(s.speaker, 'Dialogue') as title, s.text as body,
      s.search_vector, s.embedding, s.embedding_model,
      coalesce(chars.ids, '{}'::uuid[]) as character_ids, ch.id as chapter_id, ch.title as chapter_title
    from public.transcript_segments s
    join public.ai_media_scope($3) m on m.media_version_id = s.media_version_id
    
    left join public.transcripts tr on tr.media_version_id = s.media_version_id
    left join lateral (
      select array_agg(distinct ca.character_id) as ids from public.character_appearances ca
      join public.scenes cs on cs.id = ca.scene_id and cs.media_version_id = ca.media_version_id
      where ca.media_version_id = s.media_version_id
        and cs.start_s <= s.start_s and cs.end_s >= s.end_s
        and (m.episode_order < $4 or (m.episode_order = $4 and cs.end_s <= $5))
    ) chars on true
    left join lateral (
      select cp.id, cp.title from public.chapters cp
      where cp.media_version_id = s.media_version_id and cp.start_s <= s.start_s and cp.end_s >= s.end_s
        and (m.episode_order < $4 or (m.episode_order = $4 and cp.end_s <= $5))
      order by cp.start_s desc, cp.id limit 1
    ) ch on true
    where (m.episode_order < $4 or (m.episode_order = $4 and s.end_s <= $5))
      and (not ($6 ? 'episode_id') or m.episode_id = ($6->>'episode_id')::uuid)
      and (not ($6 ? 'character_id') or ($6->>'character_id')::uuid = any(chars.ids))
      and (not ($6 ? 'chapter_id') or ch.id = ($6->>'chapter_id')::uuid)
      and (not ($6 ? 'language') or tr.language = $6->>'language')
      and (not ($6 ? 'media_version_ids') or s.media_version_id::text in
        (select jsonb_array_elements_text($6->'media_version_ids')))
  ), lexical as (
    select s.id, ts_rank_cd(s.search_vector, websearch_to_tsquery('simple', $2))::double precision as relevance,
      row_number() over(order by ts_rank_cd(s.search_vector, websearch_to_tsquery('simple', $2)) desc, s.id) as rank
    from safe s where s.search_vector @@ websearch_to_tsquery('simple', $2)
    order by relevance desc, s.id limit $7 * 4
  ), semantic as (
    select s.id, greatest(-1.0, least(1.0, 1 - (s.embedding operator(extensions.<=>) $1))) as similarity,
      row_number() over(order by s.embedding operator(extensions.<=>) $1, s.id) as rank
    from safe s where $1 is not null and s.embedding is not null
      and (not ($6 ? 'embedding_model') or s.embedding_model = $6->>'embedding_model')
      and (s.embedding operator(extensions.<=>) $1) < 0.8
    order by s.embedding operator(extensions.<=>) $1, s.id limit $7 * 4
  ), fused as (
    select coalesce(l.id, v.id) id, coalesce(1.0/(60+l.rank),0) + coalesce(1.0/(60+v.rank),0) score,
      v.similarity, coalesce(l.relevance,0) relevance
    from lexical l full outer join semantic v on l.id = v.id
  )
  select s.id, 'transcript'::text, $3, s.episode_id, s.media_version_id, s.episode_order,
    s.start_s, s.end_s, s.title, s.body, s.character_ids, s.chapter_id, s.chapter_title,
    f.score::double precision, f.similarity::double precision, f.relevance
  from fused f join safe s on s.id = f.id order by f.score desc, s.id limit $7;
end;
$$;

-- One shared rate window across Vercel instances, using only the existing AI domain.
create or replace function public.consume_ai_request(user_id uuid)
returns boolean language plpgsql volatile security invoker set search_path = '' as $$
begin
  if $1 is null then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('ai-rate:' || $1::text, 0));
  if (select count(*) from public.ai_usage u where u.user_id = $1 and u.provider = 'rate-limit'
    and u.created_at > clock_timestamp() - interval '1 minute') >= 20 then return false; end if;
  insert into public.ai_usage(request_id,user_id,task_type,provider,model,cost_tier,attempts,duration_ms,success)
  values(gen_random_uuid(),$1,'cheap_chat','rate-limit','reservation','low',1,0,true);
  return true;
end;
$$;

create or replace function public.append_ai_exchange(
  user_id uuid, content_id uuid, episode_id uuid, conversation_id uuid, question text, response jsonb
) returns uuid language plpgsql volatile security invoker set search_path = '' as $$
declare conversation uuid;
begin
  if $1 is null or length(btrim($5)) not between 1 and 2000
    or jsonb_typeof($6) is distinct from 'object'
    or length(btrim($6->>'answer')) not between 1 and 10000
  then raise exception using errcode = '22023', message = 'Invalid AI exchange'; end if;
  if $4 is null then
    insert into public.ai_conversations(user_id,content_id,episode_id,title)
    values($1,$2,$3,left($5,100)) returning id into conversation;
  else
    select c.id into conversation from public.ai_conversations c
      where c.id=$4 and c.user_id=$1 and c.content_id=$2 and c.episode_id is not distinct from $3 for update;
    if conversation is null then raise exception using errcode='42501', message='Conversation unavailable'; end if;
  end if;
  insert into public.ai_messages(conversation_id,user_id,role,content,citations)
  values(conversation,$1,'user',$5,'[]'),(conversation,$1,'assistant',$6->>'answer',coalesce($6->'candidates','[]'));
  update public.ai_conversations set updated_at=now() where id=conversation;
  return conversation;
end;
$$;
