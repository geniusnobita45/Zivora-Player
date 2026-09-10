-- Base tables are service-only. Public catalog reads are granted through
-- public.public_catalog in the functions layer after that view is created.

alter table public.profiles enable row level security;
alter table public.preferences enable row level security;
alter table public.content enable row level security;
alter table public.shows enable row level security;
alter table public.seasons enable row level security;
alter table public.episodes enable row level security;
alter table public.genres enable row level security;
alter table public.content_genres enable row level security;
alter table public.media_versions enable row level security;
alter table public.manifests enable row level security;
alter table public.renditions enable row level security;
alter table public.audio_tracks enable row level security;
alter table public.subtitle_tracks enable row level security;
alter table public.thumbnails enable row level security;

revoke all on table public.profiles from public, anon, authenticated;
revoke all on table public.preferences from public, anon, authenticated;
revoke all on table public.content from public, anon, authenticated;
revoke all on table public.shows from public, anon, authenticated;
revoke all on table public.seasons from public, anon, authenticated;
revoke all on table public.episodes from public, anon, authenticated;
revoke all on table public.genres from public, anon, authenticated;
revoke all on table public.content_genres from public, anon, authenticated;
revoke all on table public.media_versions from public, anon, authenticated;
revoke all on table public.manifests from public, anon, authenticated;
revoke all on table public.renditions from public, anon, authenticated;
revoke all on table public.audio_tracks from public, anon, authenticated;
revoke all on table public.subtitle_tracks from public, anon, authenticated;
revoke all on table public.thumbnails from public, anon, authenticated;

grant select, insert, update, delete on table public.profiles to service_role;
grant select, insert, update, delete on table public.preferences to service_role;
grant select, insert, update, delete on table public.content to service_role;
grant select, insert, update, delete on table public.shows to service_role;
grant select, insert, update, delete on table public.seasons to service_role;
grant select, insert, update, delete on table public.episodes to service_role;
grant select, insert, update, delete on table public.genres to service_role;
grant select, insert, update, delete on table public.content_genres to service_role;
grant select, insert, update, delete on table public.media_versions to service_role;
grant select, insert, update, delete on table public.manifests to service_role;
grant select, insert, update, delete on table public.renditions to service_role;
grant select, insert, update, delete on table public.audio_tracks to service_role;
grant select, insert, update, delete on table public.subtitle_tracks to service_role;
grant select, insert, update, delete on table public.thumbnails to service_role;
