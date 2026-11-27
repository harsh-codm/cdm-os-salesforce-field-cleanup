-- CR-P1-01 added proposals.org_id to the model and init.sql, but init.sql only
-- runs on a fresh volume. Databases created before that change have no column,
-- and every proposal INSERT fails with UndefinedColumn. Idempotent; existing
-- rows are back-filled with 'UNKNOWN' (their org was never recorded).
BEGIN;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS org_id VARCHAR(64);
UPDATE proposals SET org_id = 'UNKNOWN' WHERE org_id IS NULL;
ALTER TABLE proposals ALTER COLUMN org_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS ix_proposals_org_id ON proposals (org_id);
COMMIT;
