-- The loop applies: revoke all on table public.playback_events from public, anon, authenticated
do $$ declare name text; begin
  foreach name in array array['playback_events','playback_errors','buffering_events','seek_events','quality_events'] loop
    execute format('alter table public.%I enable row level security', name);
    execute format('revoke all on table public.%I from public, anon, authenticated', name);
    execute format('grant select, insert, update, delete on table public.%I to service_role', name);
  end loop;
end $$;

revoke all on table public.analytics_video_startup_time from public, anon, authenticated;
revoke all on table public.analytics_seek_response_time from public, anon, authenticated;
revoke all on table public.analytics_rebuffer_ratio from public, anon, authenticated;
revoke all on table public.analytics_playback_error_rate from public, anon, authenticated;
revoke all on table public.analytics_average_selected_quality from public, anon, authenticated;
grant select on table public.analytics_video_startup_time, public.analytics_seek_response_time,
  public.analytics_rebuffer_ratio, public.analytics_playback_error_rate,
  public.analytics_average_selected_quality to service_role;
