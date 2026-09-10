create or replace function public.guard_ai_message_owner()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.ai_conversations c
    where c.id = new.conversation_id and c.user_id = new.user_id
  ) then
    raise exception using errcode = '23503', message = 'Message owner must match conversation owner';
  end if;
  return new;
end;
$$;

create trigger ai_messages_owner_guard
before insert or update on public.ai_messages
for each row execute function public.guard_ai_message_owner();

revoke all on function public.guard_ai_message_owner() from public, anon, authenticated;
grant execute on function public.guard_ai_message_owner() to service_role;
