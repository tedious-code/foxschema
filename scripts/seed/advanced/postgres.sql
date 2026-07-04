-- FoxSchema ADVANCED seed — PostgreSQL
-- Schema pair: demo_c (source) vs demo_d (target).
-- Additive to demo_a/demo_b (which the baseline E2E suite depends on — do not fold
-- these cases into 01_seed.sql). Load via: bash scripts/seed/seed-advanced.sh postgres
--
-- Case matrix (shared across all dialect files; deviations noted inline):
--   B1  3-level ADDED FK chain           regions ← warehouses ← shipments
--   B2  Self-referencing FK (ADDED)      employees.manager_id → employees.id
--   B3  Portable type matrix             t_all_types — canonically identical across
--                                        dialects in demo_c; demo_d narrows types
--                                        (drives NARROWING_TYPE_CHANGE warnings)
--   B4  Column collation diff            t_collation (pg/mysql/mariadb/sqlserver)
--   B5  Sequence attribute diff          seq_batch (all except MySQL)
--   B6  Materialized view ADDED          mv_daily_sales (pg matview / db2 MQT only)
--   B7  Composite unique + named FK      inventory (demo_d: weaker unique, no FK)
--   B8  Identity vs plain column         audit_events.id
--   B9  Routine signature diff           fn_ship_cost(weight, zone) vs (weight)
--   B10 Skip-failures candidate          v_orphan selects t_only_in_c — deploying the
--                                        view WITHOUT the table fails ⇒ exercises the
--                                        "Skip failures" execution mode deterministically
--   B11 CHECK constraints (robustness)   t_checks — identical both sides; FoxSchema
--                                        doesn't read CHECKs, must not break introspection
--   B12 Timestamp precision diff         t_time_precision.ts3 (3) vs (6)
--   B13 REMOVED table                    demo_d.t_deprecated_cache
--   B14 Trigger riding an ADDED table    trg_shipments_touch on shipments

DROP SCHEMA IF EXISTS demo_c CASCADE;
DROP SCHEMA IF EXISTS demo_d CASCADE;
CREATE SCHEMA demo_c;
CREATE SCHEMA demo_d;

-- ============================================================
-- demo_c (source)
-- ============================================================

-- [B5] Sequence with every attribute set
CREATE SEQUENCE demo_c.seq_batch START WITH 500 INCREMENT BY 5 MINVALUE 1 MAXVALUE 1000000 CACHE 20 CYCLE;

-- [B1] Three-level FK chain — creation must be ordered regions → warehouses → shipments
CREATE TABLE demo_c.regions (
    id   SERIAL PRIMARY KEY,
    code CHAR(3)      NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL
);
CREATE TABLE demo_c.warehouses (
    id        SERIAL PRIMARY KEY,
    region_id INTEGER NOT NULL REFERENCES demo_c.regions(id),
    name      VARCHAR(120) NOT NULL,
    capacity  INTEGER NOT NULL DEFAULT 1000
);
CREATE TABLE demo_c.shipments (
    id           SERIAL PRIMARY KEY,
    warehouse_id INTEGER NOT NULL REFERENCES demo_c.warehouses(id),
    tracking_no  VARCHAR(40) NOT NULL UNIQUE,
    weight_kg    DECIMAL(8,2) NOT NULL,
    shipped_at   TIMESTAMP
);
CREATE INDEX idx_c_shipments_wh ON demo_c.shipments(warehouse_id);

-- [B2] Self-referencing FK
CREATE TABLE demo_c.employees (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(150) NOT NULL,
    manager_id INTEGER REFERENCES demo_c.employees(id)
);

-- [B3] Portable type matrix — canonical: smallint, integer, bigint, decimal(12,4),
-- char(8), varchar(120), text, blob, date, timestamp. Cross-dialect compare of
-- demo_c.t_all_types between any two engines should be UNCHANGED (Oracle deviates
-- on smallint/bigint — its numeric model parses both to integer; documented).
CREATE TABLE demo_c.t_all_types (
    id          INTEGER NOT NULL PRIMARY KEY,
    c_smallint  SMALLINT,
    c_integer   INTEGER,
    c_bigint    BIGINT,
    c_decimal   NUMERIC(12,4),
    c_char      CHAR(8),
    c_varchar   VARCHAR(120),
    c_text      TEXT,
    c_blob      BYTEA,
    c_date      DATE,
    c_ts        TIMESTAMP
);

-- [B4] Explicit column collation ("C" is always available; demo_d uses a different one)
CREATE TABLE demo_c.t_collation (
    id      INTEGER NOT NULL PRIMARY KEY,
    name_ci VARCHAR(80) COLLATE "C",
    plain   VARCHAR(80)
);

-- [B7] Composite unique + named FK with ON DELETE CASCADE
CREATE TABLE demo_c.inventory (
    id           SERIAL PRIMARY KEY,
    warehouse_id INTEGER NOT NULL,
    sku          VARCHAR(50) NOT NULL,
    qty          INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT uq_inventory_wh_sku UNIQUE (warehouse_id, sku),
    CONSTRAINT fk_inventory_wh FOREIGN KEY (warehouse_id) REFERENCES demo_c.warehouses(id) ON DELETE CASCADE
);

-- [B8] Identity PK (demo_d has a plain INTEGER)
CREATE TABLE demo_c.audit_events (
    id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type VARCHAR(50) NOT NULL,
    payload    TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- [B11] CHECK constraints — identical in both schemas; must not disturb compare
CREATE TABLE demo_c.t_checks (
    id    INTEGER NOT NULL PRIMARY KEY,
    qty   INTEGER NOT NULL CHECK (qty >= 0),
    price DECIMAL(10,2) CHECK (price > 0)
);

-- [B12] Timestamp precision — canonical model drops precision, raw compare keeps it
CREATE TABLE demo_c.t_time_precision (
    id  INTEGER NOT NULL PRIMARY KEY,
    ts3 TIMESTAMP(3),
    ts6 TIMESTAMP(6)
);

-- [B10] Skip-failures pair: v_orphan is only valid if t_only_in_c is deployed with it
CREATE TABLE demo_c.t_only_in_c (
    id   SERIAL PRIMARY KEY,
    note VARCHAR(200)
);
CREATE VIEW demo_c.v_orphan AS
SELECT id, note FROM demo_c.t_only_in_c WHERE note IS NOT NULL;

-- View joining the ADDED chain
CREATE VIEW demo_c.v_shipment_status AS
SELECT s.id, s.tracking_no, s.weight_kg, w.name AS warehouse, r.code AS region
FROM   demo_c.shipments s
JOIN   demo_c.warehouses w ON w.id = s.warehouse_id
JOIN   demo_c.regions r    ON r.id = w.region_id;

-- [B6] Materialized view (ADDED — absent in demo_d)
CREATE MATERIALIZED VIEW demo_c.mv_daily_sales AS
SELECT s.warehouse_id, COUNT(*) AS shipment_count, SUM(s.weight_kg) AS total_weight
FROM   demo_c.shipments s
GROUP BY s.warehouse_id;

-- [B9] Routine with a two-parameter signature (demo_d has one parameter)
CREATE OR REPLACE FUNCTION demo_c.fn_ship_cost(p_weight DECIMAL, p_zone INTEGER)
RETURNS DECIMAL LANGUAGE plpgsql AS $$
BEGIN
  RETURN p_weight * 2.5 * p_zone;
END;
$$;

CREATE OR REPLACE PROCEDURE demo_c.sp_restock(p_warehouse INTEGER, p_sku VARCHAR, p_qty INTEGER)
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE demo_c.inventory SET qty = qty + p_qty
  WHERE warehouse_id = p_warehouse AND sku = p_sku;
END;
$$;

-- [B14] Trigger on an ADDED table — rides the shipments CREATE step
CREATE OR REPLACE FUNCTION demo_c._trg_shipments_touch()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.shipped_at = COALESCE(NEW.shipped_at, NOW());
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_shipments_touch
BEFORE INSERT ON demo_c.shipments
FOR EACH ROW EXECUTE FUNCTION demo_c._trg_shipments_touch();

-- Sample data (execute paths should run against non-empty tables)
INSERT INTO demo_c.regions (code, name) VALUES ('EMA', 'Europe/Middle East'), ('APA', 'Asia Pacific'), ('AMR', 'Americas');
INSERT INTO demo_c.warehouses (region_id, name, capacity) VALUES (1, 'Rotterdam Hub', 5000), (2, 'Singapore Hub', 8000);
INSERT INTO demo_c.shipments (warehouse_id, tracking_no, weight_kg) VALUES (1, 'TRK-0001', 12.50), (1, 'TRK-0002', 3.75), (2, 'TRK-0003', 140.00);
INSERT INTO demo_c.employees (name, manager_id) VALUES ('Ava CEO', NULL), ('Ben Lead', 1), ('Cy Dev', 2);
INSERT INTO demo_c.t_all_types (id, c_smallint, c_integer, c_bigint, c_decimal, c_char, c_varchar, c_text, c_date, c_ts)
VALUES (1, 1, 100, 10000000000, 1234.5678, 'ABC', 'hello', 'lorem ipsum', '2026-01-15', '2026-01-15 10:30:00');
INSERT INTO demo_c.inventory (warehouse_id, sku, qty) VALUES (1, 'SKU-RED', 25), (2, 'SKU-BLU', 60);
INSERT INTO demo_c.t_only_in_c (note) VALUES ('only exists in demo_c');
REFRESH MATERIALIZED VIEW demo_c.mv_daily_sales;

-- ============================================================
-- demo_d (target)
-- ============================================================

-- [B5] Same sequence name, different attributes
CREATE SEQUENCE demo_d.seq_batch START WITH 1 INCREMENT BY 1;

-- [B3] Narrowed/drifted type matrix:
--   c_bigint  → INTEGER      (the migration widens it back to BIGINT — no warning)
--   c_decimal → NUMERIC(14,6)(wider: the c→d migration NARROWS to (12,4) ⇒ warning)
--   c_varchar → VARCHAR(200) (wider: narrows to 120 ⇒ warning)
--   c_blob    → missing      (column ADDED by migration)
--   c_legacy  → extra        (column REMOVED by migration)
CREATE TABLE demo_d.t_all_types (
    id          INTEGER NOT NULL PRIMARY KEY,
    c_smallint  SMALLINT,
    c_integer   INTEGER,
    c_bigint    INTEGER,
    c_decimal   NUMERIC(14,6),
    c_char      CHAR(8),
    c_varchar   VARCHAR(200),
    c_text      TEXT,
    c_date      DATE,
    c_ts        TIMESTAMP,
    c_legacy    VARCHAR(20)
);

-- [B4] Different collation on name_ci
CREATE TABLE demo_d.t_collation (
    id      INTEGER NOT NULL PRIMARY KEY,
    name_ci VARCHAR(80),
    plain   VARCHAR(80)
);

-- [B7] Weaker unique (single column), no FK
CREATE TABLE demo_d.inventory (
    id           SERIAL PRIMARY KEY,
    warehouse_id INTEGER NOT NULL,
    sku          VARCHAR(50) NOT NULL,
    qty          INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT uq_inventory_wh_sku UNIQUE (warehouse_id)
);

-- [B8] Plain INTEGER PK — no identity
CREATE TABLE demo_d.audit_events (
    id         INTEGER PRIMARY KEY,
    event_type VARCHAR(50) NOT NULL,
    payload    TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- [B11] Identical CHECKs
CREATE TABLE demo_d.t_checks (
    id    INTEGER NOT NULL PRIMARY KEY,
    qty   INTEGER NOT NULL CHECK (qty >= 0),
    price DECIMAL(10,2) CHECK (price > 0)
);

-- [B12] ts3 has precision 6 here (raw-string MODIFIED, canonically equal)
CREATE TABLE demo_d.t_time_precision (
    id  INTEGER NOT NULL PRIMARY KEY,
    ts3 TIMESTAMP(6),
    ts6 TIMESTAMP(6)
);

-- [B9] One-parameter signature
CREATE OR REPLACE FUNCTION demo_d.fn_ship_cost(p_weight DECIMAL)
RETURNS DECIMAL LANGUAGE plpgsql AS $$
BEGIN
  RETURN p_weight * 3.0;
END;
$$;

-- [B13] Exists only in the target → REMOVED
CREATE TABLE demo_d.t_deprecated_cache (
    cache_key  VARCHAR(100) PRIMARY KEY,
    cache_val  TEXT,
    expires_at TIMESTAMP
);
