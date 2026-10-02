-- Extensions the MVP plan depends on. If the embedded binaries omit contrib
-- modules, this migration fails and the spike reports it.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE spike_patients (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  mrn         citext      NOT NULL UNIQUE,
  full_name   text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
