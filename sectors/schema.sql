PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS registry_snapshot (
    snapshot_id TEXT PRIMARY KEY,
    retrieved_at TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    http_status INTEGER NOT NULL CHECK (http_status = 200),
    sha256 TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('live', 'local', 'synthetic'))
);

CREATE TABLE IF NOT EXISTS dim_broker (
    broker_version_id TEXT PRIMARY KEY,
    broker_code TEXT NOT NULL,
    broker_name TEXT NOT NULL,
    is_foreign INTEGER NOT NULL CHECK (is_foreign IN (0, 1)),
    cohort TEXT NOT NULL CHECK (cohort IN ('institutional', 'retail', 'mixed', 'unknown')),
    license_type TEXT,
    valid_from TEXT NOT NULL,
    valid_to TEXT,
    source_snapshot_id TEXT NOT NULL REFERENCES registry_snapshot(snapshot_id),
    attribute_hash TEXT NOT NULL,
    CHECK (valid_to IS NULL OR valid_from < valid_to)
);

CREATE UNIQUE INDEX IF NOT EXISTS one_current_broker
ON dim_broker(broker_code) WHERE valid_to IS NULL;

CREATE TRIGGER IF NOT EXISTS broker_no_overlap_insert
BEFORE INSERT ON dim_broker
WHEN EXISTS (
    SELECT 1 FROM dim_broker b WHERE b.broker_code = NEW.broker_code
    AND (b.valid_to IS NULL OR NEW.valid_from < b.valid_to)
    AND (NEW.valid_to IS NULL OR b.valid_from < NEW.valid_to)
)
BEGIN
    SELECT RAISE(ABORT, 'overlapping broker interval');
END;

CREATE TRIGGER IF NOT EXISTS broker_no_overlap_update
BEFORE UPDATE ON dim_broker
WHEN EXISTS (
    SELECT 1 FROM dim_broker b WHERE b.broker_code = NEW.broker_code
    AND b.broker_version_id != OLD.broker_version_id
    AND (b.valid_to IS NULL OR NEW.valid_from < b.valid_to)
    AND (NEW.valid_to IS NULL OR b.valid_from < NEW.valid_to)
)
BEGIN
    SELECT RAISE(ABORT, 'overlapping broker interval');
END;
