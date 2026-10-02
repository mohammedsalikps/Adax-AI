-- Deliberately broken: the first statement succeeds, the second fails.
-- A transactional runner must leave neither the table nor a ledger row behind.
CREATE TABLE spike_should_not_exist (id int PRIMARY KEY);
THIS IS NOT VALID SQL;
