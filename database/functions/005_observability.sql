create view public.analytics_video_startup_time
with (security_invoker = true, security_barrier = true) as
select count(*)::bigint as samples,
       percentile_cont(0.5) within group (order by startup_ms)::double precision as p50_ms,
       percentile_cont(0.95) within group (order by startup_ms)::double precision as p95_ms
from public.playback_events
where event_type = 'session_started' and startup_ms is not null;

create view public.analytics_seek_response_time
with (security_invoker = true, security_barrier = true) as
select count(*)::bigint as samples,
       percentile_cont(0.5) within group (order by latency_ms)::double precision as p50_ms,
       percentile_cont(0.95) within group (order by latency_ms)::double precision as p95_ms
from public.seek_events
where latency_ms is not null;

create view public.analytics_rebuffer_ratio
with (security_invoker = true, security_barrier = true) as
with latest as (
  select distinct on (session_id) session_id, total_buffer_ms, watch_duration_ms
  from public.playback_events
  where event_type = 'session_snapshot'
  order by session_id, occurred_at desc, id desc
)
select count(*)::bigint as samples,
       coalesce(sum(total_buffer_ms) / nullif(sum(watch_duration_ms), 0), 0)::double precision as ratio
from latest;

create view public.analytics_playback_error_rate
with (security_invoker = true, security_barrier = true) as
with sessions as (
  select distinct session_id from public.playback_events where event_type = 'session_snapshot'
), failures as (
  select distinct session_id from public.playback_errors
)
select count(sessions.session_id)::bigint as sessions,
       count(failures.session_id)::bigint as failed_sessions,
       coalesce(count(failures.session_id)::double precision / nullif(count(sessions.session_id), 0), 0)::double precision as error_rate
from sessions left join failures using (session_id);

create view public.analytics_average_selected_quality
with (security_invoker = true, security_barrier = true) as
select device, browser, network, rendition_id, rendition_height, rendition_bitrate,
       count(*)::bigint as selections,
       avg(bandwidth_estimate)::double precision as average_bandwidth_estimate
from public.quality_events
group by device, browser, network, rendition_id, rendition_height, rendition_bitrate;
