create index ai_usage_rate_window_idx on public.ai_usage(user_id,created_at) where provider = 'rate-limit';
create index scenes_version_end_idx on public.scenes(media_version_id,end_s);
create index transcript_segments_version_end_idx on public.transcript_segments(media_version_id,end_s);
