create index ai_conversations_user_updated_idx on public.ai_conversations(user_id, updated_at desc);
create index ai_messages_conversation_created_idx on public.ai_messages(conversation_id, created_at);
create index ai_messages_user_idx on public.ai_messages(user_id);
create index ai_cache_user_expires_idx on public.ai_cache(user_id, expires_at);
create index ai_cache_expires_idx on public.ai_cache(expires_at);
create index ai_usage_user_created_idx on public.ai_usage(user_id, created_at desc);
create index ai_usage_task_created_idx on public.ai_usage(task_type, created_at desc);
create index ai_usage_conversation_idx on public.ai_usage(conversation_id);
