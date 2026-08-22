-- FoxSchema demo seed — DuckDB demo_a (source)
CREATE TABLE categories (
    id        INTEGER PRIMARY KEY,
    name      VARCHAR NOT NULL,
    slug      VARCHAR NOT NULL UNIQUE,
    parent_id INTEGER
);

CREATE TABLE customers (
    id         INTEGER PRIMARY KEY,
    name       VARCHAR NOT NULL,
    email      VARCHAR NOT NULL UNIQUE,
    phone      VARCHAR,
    tier       VARCHAR NOT NULL DEFAULT 'standard',
    created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

CREATE TABLE products (
    id          INTEGER PRIMARY KEY,
    name        VARCHAR NOT NULL,
    sku         VARCHAR NOT NULL UNIQUE,
    price       DECIMAL(10,2) NOT NULL,
    stock       INTEGER NOT NULL DEFAULT 0,
    category_id INTEGER REFERENCES categories(id),
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TIMESTAMP NOT NULL DEFAULT current_timestamp
);

CREATE TABLE orders (
    id          INTEGER PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    total       DECIMAL(12,2) NOT NULL,
    status      VARCHAR NOT NULL DEFAULT 'pending',
    notes       VARCHAR,
    created_at  TIMESTAMP NOT NULL DEFAULT current_timestamp
);

CREATE TABLE order_items (
    id          INTEGER PRIMARY KEY,
    order_id    INTEGER NOT NULL REFERENCES orders(id),
    product_id  INTEGER NOT NULL REFERENCES products(id),
    qty         INTEGER NOT NULL DEFAULT 1,
    unit_price  DECIMAL(10,2) NOT NULL
);

CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_sku ON products(sku);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_items_order ON order_items(order_id);

CREATE VIEW v_customer_orders AS
SELECT c.id AS customer_id, c.name, c.email, c.tier,
       COUNT(o.id) AS order_count,
       COALESCE(SUM(o.total), 0) AS total_spent
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
GROUP BY c.id, c.name, c.email, c.tier;

CREATE VIEW v_low_stock AS
SELECT id, name, sku, stock, category_id
FROM products
WHERE stock < 10 AND active = 1;

CREATE TABLE coupons (
    id           INTEGER PRIMARY KEY,
    code         VARCHAR NOT NULL UNIQUE,
    discount_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
    valid_until  DATE
);

CREATE VIEW v_active_products AS
SELECT id, name, price, sku
FROM products
WHERE stock > 0 AND active = 1;
