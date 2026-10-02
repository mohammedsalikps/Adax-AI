-- Extensions used across the MVP schema (verified present in the bundled
-- PostgreSQL 17.10 binaries by spikes/postgres):
--   pgcrypto  gen_random_bytes / digest (gen_random_uuid() is core since PG 13)
--   citext    case-insensitive identifiers (e.g. MRN, usernames)
--   pg_trgm   fuzzy patient-name search
CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS citext;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
