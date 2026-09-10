revoke all on function public.reserve_media_version(uuid, uuid) from public, anon, authenticated;
revoke all on function public.register_media_version(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.ready_media_version(uuid) from public, anon, authenticated;
revoke all on function public.fail_media_version(uuid) from public, anon, authenticated;
revoke all on function public.guard_published_media() from public, anon, authenticated;
revoke all on function public.guard_media_assets() from public, anon, authenticated;
revoke all on function public.guard_content_access() from public, anon, authenticated;
grant execute on function public.reserve_media_version(uuid, uuid) to service_role;
grant execute on function public.register_media_version(uuid, jsonb) to service_role;
grant execute on function public.ready_media_version(uuid) to service_role;
grant execute on function public.fail_media_version(uuid) to service_role;
-- Replacement functions retain the service-only ACL from migration 001.
