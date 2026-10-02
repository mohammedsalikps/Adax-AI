-- On its own: a new enum value cannot be used in the transaction that adds it
-- (0019 uses it in an index and in checks).
ALTER TYPE "public"."encounter_status" ADD VALUE 'discarded';