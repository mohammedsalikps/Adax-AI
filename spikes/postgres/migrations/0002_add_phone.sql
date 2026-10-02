ALTER TABLE spike_patients ADD COLUMN phone text;

CREATE INDEX spike_patients_name_trgm ON spike_patients USING gin (full_name gin_trgm_ops);
