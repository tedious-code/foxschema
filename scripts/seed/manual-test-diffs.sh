#!/usr/bin/env bash
#
# Fox Schema — extra source/target differences for manual testing.
#
# The standard seed makes demo_a and demo_b differ in indexes and triggers but
# never in columns, so the per-column and per-trigger deploy checkboxes in the
# Schema Blueprint have nothing to attach to and cannot be exercised by hand.
#
# This adds the differences each of those controls needs, on PostgreSQL and
# MySQL. It is additive and reversible: `--undo` removes exactly what it made,
# and a full `reset-all.sh` reseed removes it too.
#
#   bash scripts/seed/manual-test-diffs.sh          # add
#   bash scripts/seed/manual-test-diffs.sh --undo   # remove
#
# What it creates, and what each one is for:
#
#   orders.fox_note          a plain added column        — checkbox, tickable
#   orders.fox_idx_col       added column + index on it  — pins when the index
#                                                          is opted in
#   fox_employees            added self-FK column        — pinned by its own
#                                                          key (the #352 case)
#   orders trigger           an added trigger            — trigger checkbox
#   fox_created_table        exists only in the source   — "Created whole"
#   fox_dropped_table        exists only in the target   — "Dropped whole"
set -uo pipefail

UNDO=0
[ "${1:-}" = "--undo" ] && UNDO=1

MYSQL_PW="$(grep -rhoE "MYSQL_ROOT_PASSWORD[=:] *[^ '\"]+" docker-compose*.y*ml 2>/dev/null | head -1 | sed -E 's/.*[=:] *//')"

pg() { docker exec foxschema-postgres psql -U foxuser -d foxdb -v ON_ERROR_STOP=1 -q -c "$1"; }
my() { docker exec foxschema-mysql mysql -uroot -p"$MYSQL_PW" -e "$1" 2>&1 | grep -v "Using a password"; }

if [ "$UNDO" = "1" ]; then
  echo "── removing manual-test differences ──"
  pg '
    DROP TRIGGER IF EXISTS trg_fox_touch ON demo_a.orders;
    DROP FUNCTION IF EXISTS demo_a.fox_touch();
    DROP INDEX IF EXISTS demo_a.idx_fox_probe;
    ALTER TABLE demo_a.orders DROP COLUMN IF EXISTS fox_note, DROP COLUMN IF EXISTS fox_idx_col;
    DROP TABLE IF EXISTS demo_a.fox_employees;
    DROP TABLE IF EXISTS demo_b.fox_employees;
    DROP TABLE IF EXISTS demo_a.fox_created_table;
    DROP TABLE IF EXISTS demo_b.fox_dropped_table;' || true
  my "
    DROP TRIGGER IF EXISTS demo_a.trg_fox_touch;
    DROP INDEX idx_fox_probe ON demo_a.orders;" >/dev/null 2>&1 || true
  my "
    ALTER TABLE demo_a.orders DROP COLUMN fox_note;" >/dev/null 2>&1 || true
  my "
    ALTER TABLE demo_a.orders DROP COLUMN fox_idx_col;" >/dev/null 2>&1 || true
  my "
    DROP TABLE IF EXISTS demo_a.fox_employees;
    DROP TABLE IF EXISTS demo_b.fox_employees;
    DROP TABLE IF EXISTS demo_a.fox_created_table;
    DROP TABLE IF EXISTS demo_b.fox_dropped_table;" || true
  echo "done."
  exit 0
fi

echo "── PostgreSQL (foxdb: demo_a → demo_b) ──"
# Columns only in the source, so `orders` compares as MODIFIED with added
# columns — which is what puts a checkbox on each one.
pg "ALTER TABLE demo_a.orders ADD COLUMN IF NOT EXISTS fox_note varchar(64);"
pg "ALTER TABLE demo_a.orders ADD COLUMN IF NOT EXISTS fox_idx_col varchar(32);"
pg "CREATE INDEX IF NOT EXISTS idx_fox_probe ON demo_a.orders (fox_idx_col);"

# A trigger only in the source.
pg "CREATE OR REPLACE FUNCTION demo_a.fox_touch() RETURNS trigger LANGUAGE plpgsql AS \$\$ BEGIN RETURN NEW; END; \$\$;"
pg "DROP TRIGGER IF EXISTS trg_fox_touch ON demo_a.orders;"
pg "CREATE TRIGGER trg_fox_touch BEFORE UPDATE ON demo_a.orders FOR EACH ROW EXECUTE FUNCTION demo_a.fox_touch();"

# Same table both sides, but the source adds a column its own foreign key
# points at. Unticking that column used to produce an ADD CONSTRAINT naming a
# column nothing created.
pg "CREATE TABLE IF NOT EXISTS demo_b.fox_employees (id int PRIMARY KEY);"
pg "CREATE TABLE IF NOT EXISTS demo_a.fox_employees (id int PRIMARY KEY);"
pg "ALTER TABLE demo_a.fox_employees ADD COLUMN IF NOT EXISTS code varchar(16) UNIQUE;"
pg "ALTER TABLE demo_a.fox_employees ADD COLUMN IF NOT EXISTS manager_code varchar(16);"
pg "ALTER TABLE demo_a.fox_employees DROP CONSTRAINT IF EXISTS fk_fox_mgr;"
pg "ALTER TABLE demo_a.fox_employees ADD CONSTRAINT fk_fox_mgr FOREIGN KEY (manager_code) REFERENCES demo_a.fox_employees (code);"

# Whole-object cases: one side only.
pg "CREATE TABLE IF NOT EXISTS demo_a.fox_created_table (id int PRIMARY KEY, label varchar(32));"
pg "CREATE TABLE IF NOT EXISTS demo_b.fox_dropped_table (id int PRIMARY KEY, label varchar(32));"

echo "── MySQL (demo_a → demo_b) ──"
my "ALTER TABLE demo_a.orders ADD COLUMN fox_note VARCHAR(64) NULL;" || true
my "ALTER TABLE demo_a.orders ADD COLUMN fox_idx_col VARCHAR(32) NULL;" || true
my "CREATE INDEX idx_fox_probe ON demo_a.orders (fox_idx_col);" || true
my "DROP TRIGGER IF EXISTS demo_a.trg_fox_touch;"
my "CREATE TRIGGER demo_a.trg_fox_touch BEFORE UPDATE ON demo_a.orders FOR EACH ROW SET NEW.total = NEW.total;" || true
my "CREATE TABLE IF NOT EXISTS demo_b.fox_employees (id INT PRIMARY KEY);"
my "CREATE TABLE IF NOT EXISTS demo_a.fox_employees (id INT PRIMARY KEY, code VARCHAR(16) UNIQUE, manager_code VARCHAR(16),
     CONSTRAINT fk_fox_mgr FOREIGN KEY (manager_code) REFERENCES demo_a.fox_employees (code));"
my "CREATE TABLE IF NOT EXISTS demo_a.fox_created_table (id INT PRIMARY KEY, label VARCHAR(32));"
my "CREATE TABLE IF NOT EXISTS demo_b.fox_dropped_table (id INT PRIMARY KEY, label VARCHAR(32));"

echo
echo "── what to expect in Schema Sync (demo_a → demo_b) ──"
cat <<'EOF'
  orders             MODIFIED  columns fox_note and fox_idx_col each get a
                               checkbox; tick index idx_fox_probe and
                               fox_idx_col becomes disabled with the reason.
                               Trigger trg_fox_touch gets its own checkbox.
  fox_employees      MODIFIED  `code` is pinned by fox_employees' own foreign
                               key — disabled, "Referenced by foreign key".
  fox_created_table  ADDED     no checkboxes; heading reads "Created whole".
  fox_dropped_table  REMOVED   no checkboxes; heading reads "Dropped whole".

Undo with:  bash scripts/seed/manual-test-diffs.sh --undo
EOF
