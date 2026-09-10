do $$ declare name text; begin
  foreach name in array array['ai_conversations','ai_messages','ai_cache','ai_usage','ai_preferences'] loop
    execute format('alter table public.%I enable row level security', name);
    execute format('revoke all on table public.%I from public, anon, authenticated', name);
    execute format('grant select, insert, update, delete on table public.%I to service_role', name);
  end loop;
end $$;

grant select, insert, update, delete on public.ai_conversations, public.ai_messages, public.ai_preferences to authenticated;
grant select on public.ai_usage to authenticated;

create policy ai_conversations_select_own on public.ai_conversations for select to authenticated using ((select auth.uid()) = user_id);
create policy ai_conversations_insert_own on public.ai_conversations for insert to authenticated with check ((select auth.uid()) = user_id);
create policy ai_conversations_update_own on public.ai_conversations for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy ai_conversations_delete_own on public.ai_conversations for delete to authenticated using ((select auth.uid()) = user_id);

create policy ai_messages_select_own on public.ai_messages for select to authenticated using ((select auth.uid()) = user_id);
create policy ai_messages_insert_own on public.ai_messages for insert to authenticated with check ((select auth.uid()) = user_id);
create policy ai_messages_update_own on public.ai_messages for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy ai_messages_delete_own on public.ai_messages for delete to authenticated using ((select auth.uid()) = user_id);

create policy ai_usage_select_own on public.ai_usage for select to authenticated using ((select auth.uid()) = user_id);

create policy ai_preferences_select_own on public.ai_preferences for select to authenticated using ((select auth.uid()) = user_id);
create policy ai_preferences_insert_own on public.ai_preferences for insert to authenticated with check ((select auth.uid()) = user_id);
create policy ai_preferences_update_own on public.ai_preferences for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy ai_preferences_delete_own on public.ai_preferences for delete to authenticated using ((select auth.uid()) = user_id);
