-- Slice V4, after the first full test run (0027 had already been applied to the development and test databases, so it is not edited).
-- Additive: two rows of the append-only privilege policy, no schema change and no data change.
--
-- mana_tool_calls and mana_message_sources are purely append-only: the application only inserts into them and reads them, and each has a row trigger that
-- refuses UPDATE and DELETE. A table with such a trigger belongs to the policy that the migrator applies to the application role after every migration
-- (REVOKE UPDATE, DELETE, TRUNCATE: the role is refused even before a trigger could run, and even when it takes a table lock), and the integrity tests insist
-- on that. mana_conversations and mana_messages are NOT in the policy: the application updates them (a conversation's handles and focus; a pending answer
-- until it finishes), under guard triggers of their own that refuse every other change once an answer is finished.
INSERT INTO meta.append_only_tables (table_name) VALUES ('mana_tool_calls'), ('mana_message_sources') ON CONFLICT DO NOTHING;
