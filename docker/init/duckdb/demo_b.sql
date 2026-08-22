-- FoxSchema demo seed — DuckDB demo_b (target — older)
CREATE TABLE customers (
    id    INTEGER PRIMARY KEY,
    name  VARCHAR NOT NULL,
    email VARCHAR NOT NULL UNIQUE
);

CREATE TABLE products (
    id    INTEGER PRIMARY KEY,
    name  VARCHAR NOT NULL,
    price INTEGER NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE orders (
    id          INTEGER PRIMARY KEY,
    customer_id INTEGER NOT NULL,
    total       DECIMAL(12,2) NOT NULL,
    status      VARCHAR NOT NULL DEFAULT 'pending',
    created_at  TIMESTAMP NOT NULL DEFAULT current_timestamp
);

CREATE TABLE order_items (
    id          INTEGER PRIMARY KEY,
    order_id    INTEGER NOT NULL,
    product_id  INTEGER NOT NULL,
    qty         INTEGER NOT NULL DEFAULT 1,
    unit_price  DECIMAL(10,2) NOT NULL
);

CREATE TABLE legacy_audit_log (
    id         INTEGER PRIMARY KEY,
    action     VARCHAR,
    table_name VARCHAR,
    logged_at  TIMESTAMP DEFAULT current_timestamp
);

CREATE INDEX idx_orders_customer ON orders(customer_id);

CREATE VIEW v_order_summary AS
SELECT o.id, o.total, o.status, o.created_at, oi.qty, oi.unit_price
FROM orders o
JOIN order_items oi ON oi.order_id = o.id;

CREATE VIEW v_active_products AS
SELECT id, name, price
FROM products
WHERE stock > 0;
