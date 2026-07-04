-- FoxSchema ADVANCED seed — Oracle Free 23c
-- User/schema pair: demo_c (source) vs demo_d (target). Run as SYSTEM.
-- Case matrix: see scripts/seed/advanced/postgres.sql (B1–B14).
-- Oracle deviations:
--   B4 skipped — per-column collation needs extended NLS setup and FoxSchema
--      normalizes the USING_NLS_COMP placeholder to "no collation" anyway.
--   B6 skipped — the Oracle provider does not introspect materialized views.
--   B3 note — Oracle's catalog reports every integer-family column
--      (INTEGER/SMALLINT/NUMBER(19)) as bare NUMBER in ALL_TAB_COLUMNS, which
--      parses canonically to 'decimal', so cross-dialect compare of t_all_types
--      against other engines flags id/c_smallint/c_integer/c_bigint as
--      MODIFIED. Expected — the other six columns compare UNCHANGED.
-- Load via: bash scripts/seed/seed-advanced.sh oracle

BEGIN EXECUTE IMMEDIATE 'DROP USER demo_c CASCADE'; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP USER demo_d CASCADE'; EXCEPTION WHEN OTHERS THEN NULL; END;
/

CREATE USER demo_c IDENTIFIED BY foxpass QUOTA UNLIMITED ON USERS;
GRANT CREATE SESSION, CREATE TABLE, CREATE VIEW, CREATE SEQUENCE,
      CREATE PROCEDURE, CREATE TRIGGER, CREATE TYPE TO demo_c;

CREATE USER demo_d IDENTIFIED BY foxpass QUOTA UNLIMITED ON USERS;
GRANT CREATE SESSION, CREATE TABLE, CREATE VIEW, CREATE SEQUENCE,
      CREATE PROCEDURE, CREATE TRIGGER, CREATE TYPE TO demo_d;

-- ============================================================
-- demo_c (source)
-- ============================================================
ALTER SESSION SET CURRENT_SCHEMA = demo_c;

-- [B5] Sequence with every attribute set
CREATE SEQUENCE demo_c.seq_batch START WITH 500 INCREMENT BY 5 MINVALUE 1 MAXVALUE 1000000 CACHE 20 CYCLE;

-- [B1] Three-level FK chain
CREATE TABLE demo_c.regions (
    id   NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code CHAR(3)       NOT NULL UNIQUE,
    name VARCHAR2(100) NOT NULL
);
CREATE TABLE demo_c.warehouses (
    id        NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    region_id NUMBER NOT NULL,
    name      VARCHAR2(120) NOT NULL,
    capacity  NUMBER(10) DEFAULT 1000 NOT NULL,
    CONSTRAINT fk_wh_region FOREIGN KEY (region_id) REFERENCES demo_c.regions(id)
);
CREATE TABLE demo_c.shipments (
    id           NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    warehouse_id NUMBER NOT NULL,
    tracking_no  VARCHAR2(40) NOT NULL UNIQUE,
    weight_kg    NUMBER(8,2) NOT NULL,
    shipped_at   TIMESTAMP,
    CONSTRAINT fk_ship_wh FOREIGN KEY (warehouse_id) REFERENCES demo_c.warehouses(id)
);
CREATE INDEX demo_c.idx_c_shipments_wh ON demo_c.shipments(warehouse_id);

-- [B2] Self-referencing FK
CREATE TABLE demo_c.employees (
    id         NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       VARCHAR2(150) NOT NULL,
    manager_id NUMBER,
    CONSTRAINT fk_emp_mgr FOREIGN KEY (manager_id) REFERENCES demo_c.employees(id)
);

-- [B3] Portable type matrix (see the Oracle numeric-model note in the header)
CREATE TABLE demo_c.t_all_types (
    id          INTEGER NOT NULL PRIMARY KEY,
    c_smallint  SMALLINT,
    c_integer   INTEGER,
    c_bigint    NUMBER(19),
    c_decimal   NUMBER(12,4),
    c_char      CHAR(8),
    c_varchar   VARCHAR2(120),
    c_text      CLOB,
    c_blob      BLOB,
    c_date      DATE,
    c_ts        TIMESTAMP
);

-- [B7] Composite unique + named FK with ON DELETE CASCADE
CREATE TABLE demo_c.inventory (
    id           NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    warehouse_id NUMBER NOT NULL,
    sku          VARCHAR2(50) NOT NULL,
    qty          NUMBER(10) DEFAULT 0 NOT NULL,
    CONSTRAINT uq_inventory_wh_sku UNIQUE (warehouse_id, sku),
    CONSTRAINT fk_inventory_wh FOREIGN KEY (warehouse_id) REFERENCES demo_c.warehouses(id) ON DELETE CASCADE
);

-- [B8] Identity PK (demo_d has a plain NUMBER)
CREATE TABLE demo_c.audit_events (
    id         NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type VARCHAR2(50) NOT NULL,
    payload    CLOB,
    created_at TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
);

-- [B11] CHECK constraints — identical in both schemas
CREATE TABLE demo_c.t_checks (
    id    INTEGER NOT NULL PRIMARY KEY,
    qty   NUMBER(10) NOT NULL CHECK (qty >= 0),
    price NUMBER(10,2) CHECK (price > 0)
);

-- [B12] Timestamp precision
CREATE TABLE demo_c.t_time_precision (
    id  INTEGER NOT NULL PRIMARY KEY,
    ts3 TIMESTAMP(3),
    ts6 TIMESTAMP(6)
);

-- [B10] Skip-failures pair
CREATE TABLE demo_c.t_only_in_c (
    id   NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    note VARCHAR2(200)
);
CREATE VIEW demo_c.v_orphan AS
SELECT id, note FROM demo_c.t_only_in_c WHERE note IS NOT NULL;

CREATE VIEW demo_c.v_shipment_status AS
SELECT s.id, s.tracking_no, s.weight_kg, w.name AS warehouse, r.code AS region
FROM   demo_c.shipments s
JOIN   demo_c.warehouses w ON w.id = s.warehouse_id
JOIN   demo_c.regions r    ON r.id = w.region_id;

-- [B9] Two-parameter routine + procedure
CREATE OR REPLACE FUNCTION demo_c.fn_ship_cost(p_weight NUMBER, p_zone NUMBER)
RETURN NUMBER IS
BEGIN
  RETURN p_weight * 2.5 * p_zone;
END;
/

CREATE OR REPLACE PROCEDURE demo_c.sp_restock(p_warehouse NUMBER, p_sku VARCHAR2, p_qty NUMBER) IS
BEGIN
  UPDATE demo_c.inventory SET qty = qty + p_qty
  WHERE warehouse_id = p_warehouse AND sku = p_sku;
END;
/

-- [B14] Trigger on the ADDED shipments table
CREATE OR REPLACE TRIGGER demo_c.trg_shipments_touch
BEFORE INSERT ON demo_c.shipments
FOR EACH ROW
BEGIN
  IF :NEW.shipped_at IS NULL THEN :NEW.shipped_at := SYSTIMESTAMP; END IF;
END;
/

-- Sample data
INSERT INTO demo_c.regions (code, name) VALUES ('EMA', 'Europe/Middle East');
INSERT INTO demo_c.regions (code, name) VALUES ('APA', 'Asia Pacific');
INSERT INTO demo_c.regions (code, name) VALUES ('AMR', 'Americas');
INSERT INTO demo_c.warehouses (region_id, name, capacity) VALUES (1, 'Rotterdam Hub', 5000);
INSERT INTO demo_c.warehouses (region_id, name, capacity) VALUES (2, 'Singapore Hub', 8000);
INSERT INTO demo_c.shipments (warehouse_id, tracking_no, weight_kg) VALUES (1, 'TRK-0001', 12.50);
INSERT INTO demo_c.shipments (warehouse_id, tracking_no, weight_kg) VALUES (1, 'TRK-0002', 3.75);
INSERT INTO demo_c.shipments (warehouse_id, tracking_no, weight_kg) VALUES (2, 'TRK-0003', 140.00);
INSERT INTO demo_c.employees (name, manager_id) VALUES ('Ava CEO', NULL);
INSERT INTO demo_c.employees (name, manager_id) VALUES ('Ben Lead', 1);
INSERT INTO demo_c.employees (name, manager_id) VALUES ('Cy Dev', 2);
INSERT INTO demo_c.t_all_types (id, c_smallint, c_integer, c_bigint, c_decimal, c_char, c_varchar, c_text, c_date, c_ts)
VALUES (1, 1, 100, 10000000000, 1234.5678, 'ABC', 'hello', 'lorem ipsum', DATE '2026-01-15', TIMESTAMP '2026-01-15 10:30:00');
INSERT INTO demo_c.inventory (warehouse_id, sku, qty) VALUES (1, 'SKU-RED', 25);
INSERT INTO demo_c.inventory (warehouse_id, sku, qty) VALUES (2, 'SKU-BLU', 60);
INSERT INTO demo_c.t_only_in_c (note) VALUES ('only exists in demo_c');
COMMIT;

-- ============================================================
-- demo_d (target)
-- ============================================================
ALTER SESSION SET CURRENT_SCHEMA = demo_d;

-- [B5] Same sequence name, different attributes
CREATE SEQUENCE demo_d.seq_batch START WITH 1 INCREMENT BY 1 NOCACHE NOCYCLE;

-- [B3] Narrowed/drifted type matrix
CREATE TABLE demo_d.t_all_types (
    id          INTEGER NOT NULL PRIMARY KEY,
    c_smallint  SMALLINT,
    c_integer   INTEGER,
    c_bigint    NUMBER(10),
    c_decimal   NUMBER(14,6),
    c_char      CHAR(8),
    c_varchar   VARCHAR2(200),
    c_text      CLOB,
    c_date      DATE,
    c_ts        TIMESTAMP,
    c_legacy    VARCHAR2(20)
);

-- [B7] Weaker unique, no FK
CREATE TABLE demo_d.inventory (
    id           NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    warehouse_id NUMBER NOT NULL,
    sku          VARCHAR2(50) NOT NULL,
    qty          NUMBER(10) DEFAULT 0 NOT NULL,
    CONSTRAINT uq_inventory_wh_sku UNIQUE (warehouse_id)
);

-- [B8] Plain NUMBER PK — no identity
CREATE TABLE demo_d.audit_events (
    id         NUMBER PRIMARY KEY,
    event_type VARCHAR2(50) NOT NULL,
    payload    CLOB,
    created_at TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
);

-- [B11] Identical CHECKs
CREATE TABLE demo_d.t_checks (
    id    INTEGER NOT NULL PRIMARY KEY,
    qty   NUMBER(10) NOT NULL CHECK (qty >= 0),
    price NUMBER(10,2) CHECK (price > 0)
);

-- [B12] ts3 precision differs
CREATE TABLE demo_d.t_time_precision (
    id  INTEGER NOT NULL PRIMARY KEY,
    ts3 TIMESTAMP(6),
    ts6 TIMESTAMP(6)
);

-- [B9] One-parameter signature
CREATE OR REPLACE FUNCTION demo_d.fn_ship_cost(p_weight NUMBER)
RETURN NUMBER IS
BEGIN
  RETURN p_weight * 3.0;
END;
/

-- [B13] Target-only table → REMOVED
CREATE TABLE demo_d.t_deprecated_cache (
    cache_key  VARCHAR2(100) PRIMARY KEY,
    cache_val  CLOB,
    expires_at TIMESTAMP
);

EXIT;
