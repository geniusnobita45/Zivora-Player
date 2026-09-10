create index audio_tracks_version_language_idx on public.audio_tracks(media_version_id, language);
create index subtitle_tracks_version_language_idx on public.subtitle_tracks(media_version_id, language);
