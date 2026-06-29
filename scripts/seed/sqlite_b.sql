-- FoxSchema demo seed — SQLite demo_b.db (target — older version)

-- Missing: categories table

CREATE TABLE IF NOT EXISTS customers (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE
    -- missing: phone, tier, created_at
);

CREATE TABLE IF NOT EXISTS products (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT NOT NULL,
    price INTEGER NOT NULL,     -- was REAL
    stock INTEGER NOT NULL DEFAULT 0
    -- missing: sku, category_id, active, created_at
);

CREATE TABLE IF NOT EXISTS orders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    total       REAL NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    -- missing: notes
);

CREATE TABLE IF NOT EXISTS order_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id    INTEGER NOT NULL,
    product_id  INTEGER NOT NULL,
    qty         INTEGER NOT NULL DEFAULT 1,
    unit_price  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS legacy_audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    action     TEXT,
    table_name TEXT,
    logged_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);

CREATE VIEW IF NOT EXISTS v_order_summary AS
SELECT o.id, o.total, o.status, o.created_at, oi.qty, oi.unit_price
FROM   orders o
JOIN   order_items oi ON oi.order_id = o.id;

CREATE TRIGGER IF NOT EXISTS trg_validate_qty
BEFORE INSERT ON order_items
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'qty must be positive') WHERE NEW.qty <= 0;
END;
