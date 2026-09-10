-- Private is the safe default. Public versions use a separate public R2 bucket.
alter table public.content add column access_level text not null default 'private'
  check (access_level in ('private', 'public'));
alter table public.media_versions add column storage_access text not null default 'private'
  check (storage_access in ('private', 'public'));

-- Several audio/subtitle tracks may share a language (commentary, forced captions).
alter table public.audio_tracks drop constraint audio_tracks_version_language_unique;
alter table public.subtitle_tracks drop constraint subtitle_tracks_version_language_unique;
