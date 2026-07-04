-- FoxSchema ADVANCED seed — SQL Server 2022
-- Schema pair in foxdb: demo_c (source) vs demo_d (target).
-- Case matrix: see scripts/seed/advanced/postgres.sql (B1–B14).
-- SQL Server deviations: B6 skipped (indexed views ≠ FoxSchema MQTs).
-- Load via: bash scripts/seed/seed-advanced.sh sqlserver

IF DB_ID('foxdb') IS NULL
  CREATE DATABASE foxdb;
GO

USE foxdb;
GO

-- ============================================================
-- Drop and recreate demo_c / demo_d (FKs → triggers → objects → sequences → schema)
-- ============================================================
DECLARE @s NVARCHAR(10);
DECLARE cur CURSOR FOR SELECT name FROM sys.schemas WHERE name IN ('demo_c','demo_d');
OPEN cur;
FETCH NEXT FROM cur INTO @s;
WHILE @@FETCH_STATUS = 0 BEGIN
  DECLARE @fkSql NVARCHAR(MAX) = N'';
  SELECT @fkSql += 'ALTER TABLE ' + @s + '.' + OBJECT_NAME(parent_object_id) +
    ' DROP CONSTRAINT ' + name + '; '
  FROM sys.foreign_keys WHERE SCHEMA_NAME(schema_id) = @s;
  EXEC sp_executesql @fkSql;

  DECLARE @objSql NVARCHAR(MAX) = N'';
  SELECT @objSql += 'DROP ' + CASE type_desc
    WHEN 'USER_TABLE'   THEN 'TABLE'
    WHEN 'VIEW'         THEN 'VIEW'
    WHEN 'SQL_STORED_PROCEDURE' THEN 'PROCEDURE'
    WHEN 'SQL_SCALAR_FUNCTION'  THEN 'FUNCTION'
    WHEN 'SQL_TRIGGER'  THEN 'TRIGGER'
    ELSE NULL END + ' ' + @s + '.' + name + '; '
  FROM sys.objects WHERE schema_id = SCHEMA_ID(@s)
    AND type_desc IN ('SQL_TRIGGER','SQL_SCALAR_FUNCTION','SQL_STORED_PROCEDURE','VIEW','USER_TABLE')
  ORDER BY CASE type_desc WHEN 'SQL_TRIGGER' THEN 0 WHEN 'VIEW' THEN 1 ELSE 2 END;
  EXEC sp_executesql @objSql;

  DECLARE @seqSql NVARCHAR(MAX) = N'';
  SELECT @seqSql += 'DROP SEQUENCE ' + @s + '.' + name + '; '
  FROM sys.sequences WHERE schema_id = SCHEMA_ID(@s);
  EXEC sp_executesql @seqSql;

  DECLARE @dropSchema NVARCHAR(200) = N'DROP SCHEMA ' + @s + ';';
  EXEC sp_executesql @dropSchema;
  FETCH NEXT FROM cur INTO @s;
END
CLOSE cur; DEALLOCATE cur;
GO

CREATE SCHEMA demo_c;
GO
CREATE SCHEMA demo_d;
GO

-- ============================================================
-- demo_c (source)
-- ============================================================

-- [B5] Sequence with every attribute set
CREATE SEQUENCE demo_c.seq_batch START WITH 500 INCREMENT BY 5 MINVALUE 1 MAXVALUE 1000000 CACHE 20 CYCLE;
GO

-- [B1] Three-level FK chain
CREATE TABLE demo_c.regions (
    id   INT IDENTITY(1,1) PRIMARY KEY,
    code CHAR(3)      NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL
);
CREATE TABLE demo_c.warehouses (
    id        INT IDENTITY(1,1) PRIMARY KEY,
    region_id INT NOT NULL,
    name      VARCHAR(120) NOT NULL,
    capacity  INT NOT NULL DEFAULT 1000,
    CONSTRAINT fk_wh_region FOREIGN KEY (region_id) REFERENCES demo_c.regions(id)
);
CREATE TABLE demo_c.shipments (
    id           INT IDENTITY(1,1) PRIMARY KEY,
    warehouse_id INT NOT NULL,
    tracking_no  VARCHAR(40) NOT NULL UNIQUE,
    weight_kg    DECIMAL(8,2) NOT NULL,
    shipped_at   DATETIME2,
    CONSTRAINT fk_ship_wh FOREIGN KEY (warehouse_id) REFERENCES demo_c.warehouses(id)
);
CREATE INDEX idx_c_shipments_wh ON demo_c.shipments(warehouse_id);
GO

-- [B2] Self-referencing FK
CREATE TABLE demo_c.employees (
    id         INT IDENTITY(1,1) PRIMARY KEY,
    name       VARCHAR(150) NOT NULL,
    manager_id INT,
    CONSTRAINT fk_emp_mgr FOREIGN KEY (manager_id) REFERENCES demo_c.employees(id)
);
GO

-- [B3] Portable type matrix (VARCHAR(MAX)→text, VARBINARY(MAX)→blob, DATETIME2→timestamp)
CREATE TABLE demo_c.t_all_types (
    id          INT NOT NULL PRIMARY KEY,
    c_smallint  SMALLINT,
    c_integer   INT,
    c_bigint    BIGINT,
    c_decimal   DECIMAL(12,4),
    c_char      CHAR(8),
    c_varchar   VARCHAR(120),
    c_text      VARCHAR(MAX),
    c_blob      VARBINARY(MAX),
    c_date      DATE,
    c_ts        DATETIME2
);
GO

-- [B4] Explicit column collation (demo_d uses CI on name_ci)
CREATE TABLE demo_c.t_collation (
    id      INT NOT NULL PRIMARY KEY,
    name_ci VARCHAR(80) COLLATE SQL_Latin1_General_CP1_CS_AS,
    plain   VARCHAR(80)
);
GO

-- [B7] Composite unique + named FK with ON DELETE CASCADE
CREATE TABLE demo_c.inventory (
    id           INT IDENTITY(1,1) PRIMARY KEY,
    warehouse_id INT NOT NULL,
    sku          VARCHAR(50) NOT NULL,
    qty          INT NOT NULL DEFAULT 0,
    CONSTRAINT uq_inventory_wh_sku UNIQUE (warehouse_id, sku),
    CONSTRAINT fk_inventory_wh FOREIGN KEY (warehouse_id) REFERENCES demo_c.warehouses(id) ON DELETE CASCADE
);
GO

-- [B8] Identity PK (demo_d has a plain INT)
CREATE TABLE demo_c.audit_events (
    id         INT IDENTITY(1,1) PRIMARY KEY,
    event_type VARCHAR(50) NOT NULL,
    payload    VARCHAR(MAX),
    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME()
);
GO

-- [B11] CHECK constraints — identical in both schemas
CREATE TABLE demo_c.t_checks (
    id    INT NOT NULL PRIMARY KEY,
    qty   INT NOT NULL CHECK (qty >= 0),
    price DECIMAL(10,2) CHECK (price > 0)
);
GO

-- [B12] Datetime precision
CREATE TABLE demo_c.t_time_precision (
    id  INT NOT NULL PRIMARY KEY,
    ts3 DATETIME2(3),
    ts6 DATETIME2(6)
);
GO

-- [B10] Skip-failures pair
CREATE TABLE demo_c.t_only_in_c (
    id   INT IDENTITY(1,1) PRIMARY KEY,
    note VARCHAR(200)
);
GO
CREATE VIEW demo_c.v_orphan AS
SELECT id, note FROM demo_c.t_only_in_c WHERE note IS NOT NULL;
GO

CREATE VIEW demo_c.v_shipment_status AS
SELECT s.id, s.tracking_no, s.weight_kg, w.name AS warehouse, r.code AS region
FROM   demo_c.shipments s
JOIN   demo_c.warehouses w ON w.id = s.warehouse_id
JOIN   demo_c.regions r    ON r.id = w.region_id;
GO

-- [B9] Two-parameter routine + procedure
CREATE FUNCTION demo_c.fn_ship_cost(@p_weight DECIMAL(8,2), @p_zone INT)
RETURNS DECIMAL(10,2) AS
BEGIN
  RETURN @p_weight * 2.5 * @p_zone;
END;
GO

CREATE PROCEDURE demo_c.sp_restock @p_warehouse INT, @p_sku VARCHAR(50), @p_qty INT AS
BEGIN
  UPDATE demo_c.inventory SET qty = qty + @p_qty
  WHERE warehouse_id = @p_warehouse AND sku = @p_sku;
END;
GO

-- [B14] Trigger on the ADDED shipments table
CREATE TRIGGER demo_c.trg_shipments_touch ON demo_c.shipments
AFTER INSERT AS
BEGIN
  SET NOCOUNT ON;
  UPDATE s SET shipped_at = COALESCE(s.shipped_at, SYSDATETIME())
  FROM demo_c.shipments s JOIN inserted i ON i.id = s.id;
END;
GO

-- Sample data
INSERT INTO demo_c.regions (code, name) VALUES ('EMA', 'Europe/Middle East'), ('APA', 'Asia Pacific'), ('AMR', 'Americas');
INSERT INTO demo_c.warehouses (region_id, name, capacity) VALUES (1, 'Rotterdam Hub', 5000), (2, 'Singapore Hub', 8000);
INSERT INTO demo_c.shipments (warehouse_id, tracking_no, weight_kg) VALUES (1, 'TRK-0001', 12.50), (1, 'TRK-0002', 3.75), (2, 'TRK-0003', 140.00);
INSERT INTO demo_c.employees (name, manager_id) VALUES ('Ava CEO', NULL), ('Ben Lead', 1), ('Cy Dev', 2);
INSERT INTO demo_c.t_all_types (id, c_smallint, c_integer, c_bigint, c_decimal, c_char, c_varchar, c_text, c_date, c_ts)
VALUES (1, 1, 100, 10000000000, 1234.5678, 'ABC', 'hello', 'lorem ipsum', '2026-01-15', '2026-01-15 10:30:00');
INSERT INTO demo_c.inventory (warehouse_id, sku, qty) VALUES (1, 'SKU-RED', 25), (2, 'SKU-BLU', 60);
INSERT INTO demo_c.t_only_in_c (note) VALUES ('only exists in demo_c');
GO

-- ============================================================
-- demo_d (target)
-- ============================================================

-- [B5] Same sequence name, different attributes
CREATE SEQUENCE demo_d.seq_batch START WITH 1 INCREMENT BY 1;
GO

-- [B3] Narrowed/drifted type matrix
CREATE TABLE demo_d.t_all_types (
    id          INT NOT NULL PRIMARY KEY,
    c_smallint  SMALLINT,
    c_integer   INT,
    c_bigint    INT,
    c_decimal   DECIMAL(14,6),
    c_char      CHAR(8),
    c_varchar   VARCHAR(200),
    c_text      VARCHAR(MAX),
    c_date      DATE,
    c_ts        DATETIME2,
    c_legacy    VARCHAR(20)
);
GO

-- [B4] Different collation on name_ci
CREATE TABLE demo_d.t_collation (
    id      INT NOT NULL PRIMARY KEY,
    name_ci VARCHAR(80) COLLATE SQL_Latin1_General_CP1_CI_AS,
    plain   VARCHAR(80)
);
GO

-- [B7] Weaker unique, no FK
CREATE TABLE demo_d.inventory (
    id           INT IDENTITY(1,1) PRIMARY KEY,
    warehouse_id INT NOT NULL,
    sku          VARCHAR(50) NOT NULL,
    qty          INT NOT NULL DEFAULT 0,
    CONSTRAINT uq_inventory_wh_sku UNIQUE (warehouse_id)
);
GO

-- [B8] Plain INT PK — no identity
CREATE TABLE demo_d.audit_events (
    id         INT PRIMARY KEY,
    event_type VARCHAR(50) NOT NULL,
    payload    VARCHAR(MAX),
    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME()
);
GO

-- [B11] Identical CHECKs
CREATE TABLE demo_d.t_checks (
    id    INT NOT NULL PRIMARY KEY,
    qty   INT NOT NULL CHECK (qty >= 0),
    price DECIMAL(10,2) CHECK (price > 0)
);
GO

-- [B12] ts3 precision differs
CREATE TABLE demo_d.t_time_precision (
    id  INT NOT NULL PRIMARY KEY,
    ts3 DATETIME2(6),
    ts6 DATETIME2(6)
);
GO

-- [B9] One-parameter signature
CREATE FUNCTION demo_d.fn_ship_cost(@p_weight DECIMAL(8,2))
RETURNS DECIMAL(10,2) AS
BEGIN
  RETURN @p_weight * 3.0;
END;
GO

-- [B13] Target-only table → REMOVED
CREATE TABLE demo_d.t_deprecated_cache (
    cache_key  VARCHAR(100) PRIMARY KEY,
    cache_val  VARCHAR(MAX),
    expires_at DATETIME2
);
GO
