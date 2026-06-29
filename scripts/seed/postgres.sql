-- FoxSchema demo seed — PostgreSQL
-- Two schemas: demo_a (source, newer) vs demo_b (target, older)
-- Scopes covered: Tables, Views, Functions, Procedures, Triggers, Sequences, Types (enum)

DROP SCHEMA IF EXISTS demo_a CASCADE;
DROP SCHEMA IF EXISTS demo_b CASCADE;
CREATE SCHEMA demo_a;
CREATE SCHEMA demo_b;

-- ============================================================
-- SCHEMA A  (source — more complete, newer version)
-- ============================================================

CREATE TYPE demo_a.order_status AS ENUM ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled');

CREATE SEQUENCE demo_a.order_seq START WITH 1000 INCREMENT BY 1;

CREATE TABLE demo_a.categories (
    id    SERIAL PRIMARY KEY,
    name  VARCHAR(100) NOT NULL,
    slug  VARCHAR(100) NOT NULL UNIQUE,
    parent_id INTEGER
);

CREATE TABLE demo_a.customers (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(150) NOT NULL,
    email      VARCHAR(255) NOT NULL UNIQUE,
    phone      VARCHAR(20),
    tier       VARCHAR(10) NOT NULL DEFAULT 'standard',
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE demo_a.products (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(200) NOT NULL,
    sku         VARCHAR(50)  NOT NULL UNIQUE,
    price       DECIMAL(10,2) NOT NULL,
    stock       INTEGER NOT NULL DEFAULT 0,
    category_id INTEGER REFERENCES demo_a.categories(id),
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE demo_a.orders (
    id          INTEGER NOT NULL DEFAULT nextval('demo_a.order_seq') PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES demo_a.customers(id),
    total       DECIMAL(12,2) NOT NULL,
    status      demo_a.order_status NOT NULL DEFAULT 'pending',
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE demo_a.order_items (
    id          SERIAL PRIMARY KEY,
    order_id    INTEGER NOT NULL REFERENCES demo_a.orders(id),
    product_id  INTEGER NOT NULL REFERENCES demo_a.products(id),
    qty         INTEGER NOT NULL DEFAULT 1,
    unit_price  DECIMAL(10,2) NOT NULL
);

CREATE INDEX idx_a_products_category  ON demo_a.products(category_id);
CREATE INDEX idx_a_products_sku       ON demo_a.products(sku);
CREATE INDEX idx_a_orders_customer    ON demo_a.orders(customer_id);
CREATE INDEX idx_a_orders_status      ON demo_a.orders(status);
CREATE INDEX idx_a_items_order        ON demo_a.order_items(order_id);

CREATE VIEW demo_a.v_customer_orders AS
SELECT c.id AS customer_id, c.name, c.email, c.tier,
       COUNT(o.id)   AS order_count,
       COALESCE(SUM(o.total), 0) AS total_spent
FROM   demo_a.customers c
LEFT JOIN demo_a.orders o ON o.customer_id = c.id
GROUP BY c.id, c.name, c.email, c.tier;

CREATE VIEW demo_a.v_low_stock AS
SELECT id, name, sku, stock, category_id
FROM   demo_a.products
WHERE  stock < 10 AND active = TRUE;

CREATE OR REPLACE FUNCTION demo_a.fn_get_discount(p_price DECIMAL, p_qty INTEGER)
RETURNS DECIMAL LANGUAGE plpgsql AS $$
BEGIN
  IF p_qty >= 10 THEN RETURN p_price * 0.10;
  ELSIF p_qty >= 5 THEN RETURN p_price * 0.05;
  ELSE RETURN 0;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION demo_a.fn_order_total(p_order_id INTEGER)
RETURNS DECIMAL LANGUAGE plpgsql AS $$
DECLARE v_total DECIMAL;
BEGIN
  SELECT SUM(qty * unit_price) INTO v_total
  FROM   demo_a.order_items WHERE order_id = p_order_id;
  RETURN COALESCE(v_total, 0);
END;
$$;

CREATE OR REPLACE PROCEDURE demo_a.sp_confirm_order(p_order_id INTEGER)
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE demo_a.orders SET status = 'confirmed' WHERE id = p_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION demo_a._trg_decrement_stock()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE demo_a.products SET stock = stock - NEW.qty WHERE id = NEW.product_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_decrement_stock
AFTER INSERT ON demo_a.order_items
FOR EACH ROW EXECUTE FUNCTION demo_a._trg_decrement_stock();

CREATE OR REPLACE FUNCTION demo_a._trg_update_customer_ts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.created_at = NOW();
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_customer_created
BEFORE INSERT ON demo_a.customers
FOR EACH ROW EXECUTE FUNCTION demo_a._trg_update_customer_ts();

-- ============================================================
-- SCHEMA B  (target — older version, intentional differences)
-- ============================================================

-- Missing type (uses plain VARCHAR instead of enum)

CREATE SEQUENCE demo_b.order_seq START WITH 1 INCREMENT BY 1;

-- Missing: categories table

CREATE TABLE demo_b.customers (
    id    SERIAL PRIMARY KEY,
    name  VARCHAR(100) NOT NULL,       -- shorter length (was 150)
    email VARCHAR(255) NOT NULL UNIQUE
    -- missing: phone, tier, created_at
);

CREATE TABLE demo_b.products (
    id     SERIAL PRIMARY KEY,
    name   VARCHAR(200) NOT NULL,
    price  INTEGER NOT NULL,           -- was DECIMAL(10,2)
    stock  INTEGER NOT NULL DEFAULT 0
    -- missing: sku, category_id, active, created_at
);

CREATE TABLE demo_b.orders (
    id          INTEGER NOT NULL DEFAULT nextval('demo_b.order_seq') PRIMARY KEY,
    customer_id INTEGER NOT NULL,
    total       DECIMAL(12,2) NOT NULL,
    status      VARCHAR(20) NOT NULL DEFAULT 'pending',  -- was enum
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- missing: notes
);

CREATE TABLE demo_b.order_items (
    id          SERIAL PRIMARY KEY,
    order_id    INTEGER NOT NULL,
    product_id  INTEGER NOT NULL,
    qty         INTEGER NOT NULL DEFAULT 1,
    unit_price  DECIMAL(10,2) NOT NULL
);

-- Extra table not in demo_a
CREATE TABLE demo_b.legacy_audit_log (
    id         SERIAL PRIMARY KEY,
    action     VARCHAR(50),
    table_name VARCHAR(100),
    logged_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_b_orders_customer ON demo_b.orders(customer_id);

-- Different view (v_customer_orders is missing; different view exists)
CREATE VIEW demo_b.v_order_summary AS
SELECT o.id, o.total, o.status, o.created_at,
       oi.qty, oi.unit_price
FROM   demo_b.orders o
JOIN   demo_b.order_items oi ON oi.order_id = o.id;

-- Same function (no diff expected)
CREATE OR REPLACE FUNCTION demo_b.fn_get_discount(p_price DECIMAL, p_qty INTEGER)
RETURNS DECIMAL LANGUAGE plpgsql AS $$
BEGIN
  IF p_qty >= 10 THEN RETURN p_price * 0.10;
  ELSIF p_qty >= 5 THEN RETURN p_price * 0.05;
  ELSE RETURN 0;
  END IF;
END;
$$;

-- Missing: fn_order_total, sp_confirm_order, triggers
