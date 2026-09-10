-- Keep the existing MEDIA trust boundary. No anonymous/authenticated table access.
revoke all on function public.register_media_version(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.register_media_version(uuid, jsonb) to service_role;
