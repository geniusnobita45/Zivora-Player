create index playback_events_session_occurred_idx on public.playback_events (session_id, occurred_at desc);
create index playback_events_occurred_idx on public.playback_events (occurred_at desc);
create index playback_errors_occurred_idx on public.playback_errors (occurred_at desc);
create index buffering_events_session_occurred_idx on public.buffering_events (session_id, occurred_at desc);
create index seek_events_occurred_idx on public.seek_events (occurred_at desc);
create index quality_events_dimensions_idx on public.quality_events (device, browser, network, rendition_id);
