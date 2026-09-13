-- Extensions required by the platform.
-- pgcrypto/uuid-ossp: UUID generation.
-- vector: pgvector for knowledge base semantic search.
-- supabase_vault: application-managed integration secrets (Qwen/Telegram).
-- pg_cron + pg_net: scheduled scanning (Supabase Cron) calling the app's API.
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;
create extension if not exists supabase_vault with schema vault;
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
