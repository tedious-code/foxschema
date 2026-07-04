#!/usr/bin/env bash
# FoxSchema — ADVANCED seed: demo_c (source) vs demo_d (target) on every engine.
#
# Additive to the baseline demo_a/demo_b seed (seed-all.sh) — the baseline E2E
# suite depends on demo_a/demo_b's exact shape, so the advanced cases live in a
# separate schema pair instead of extending the originals.
#
# Case matrix (B1–B14): see scripts/seed/advanced/postgres.sql header.
# Cross-dialect: demo_c.t_all_types is canonically identical across engines —
# comparing demo_c between any two engines should show t_all_types UNCHANGED
# (Oracle deviates on c_smallint/c_bigint; documented in oracle.sql).
#
# Usage: bash scripts/seed/seed-advanced.sh [postgres|mysql|mariadb|sqlserver|oracle|db2|all]

set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
ADV="$REPO/scripts/seed/advanced"

seed_postgres() {
  echo "▶ PostgreSQL (advanced) …"
  docker exec -i foxschema-postgres psql -U foxuser -d foxdb -v ON_ERROR_STOP=1 \
    < "$ADV/postgres.sql" > /dev/null
  echo "  ✓ done"
}

seed_mysql() {
  echo "▶ MySQL (advanced) …"
  docker exec -i foxschema-mysql mysql -uroot -pfoxrootpass \
    < "$ADV/mysql.sql" 2> >(grep -v "Using a password" >&2)
  echo "  ✓ done"
}

seed_mariadb() {
  echo "▶ MariaDB (advanced) …"
  docker exec -i foxschema-mariadb mariadb -uroot -pfoxrootpass \
    < "$ADV/mariadb.sql"
  echo "  ✓ done"
}

seed_sqlserver() {
  echo "▶ SQL Server (advanced) …"
  docker cp "$ADV/sqlserver.sql" foxschema-sqlserver:/tmp/adv_seed.sql
  docker exec foxschema-sqlserver \
    /opt/mssql-tools18/bin/sqlcmd -S localhost -U SA -P 'FoxPass123!' \
    -i /tmp/adv_seed.sql -No -C -b > /dev/null
  echo "  ✓ done"
}

seed_oracle() {
  echo "▶ Oracle (advanced) …"
  # sqlplus swallows errors by default — grep the output for ORA-/SP2- and fail loudly.
  local out
  out=$(docker exec -i foxschema-oracle \
    sqlplus -S "system/FoxPass123@//localhost:1521/FREEPDB1" \
    < "$ADV/oracle.sql" 2>&1)
  if echo "$out" | grep -qE "ORA-|SP2-"; then
    echo "$out" | grep -E "ORA-|SP2-" | head -5
    echo "  ✗ Oracle seed had errors"; return 1
  fi
  echo "  ✓ done"
}

seed_db2() {
  echo "▶ DB2 (advanced) …"
  docker cp "$ADV/db2.sql" foxschema-db2:/tmp/adv_seed.sql
  docker exec foxschema-db2 \
    su - db2inst1 -c "db2 connect to foxdb > /dev/null && db2 -tf /tmp/adv_seed.sql -z /tmp/adv_seed.log > /dev/null; rc=\$?; [ \$rc -le 2 ]" \
    || { echo "  ✗ DB2 seed failed — see /tmp/adv_seed.log in the container"; return 1; }
  echo "  ✓ done"
}

TARGET="${1:-all}"
case "$TARGET" in
  postgres)   seed_postgres ;;
  mysql)      seed_mysql ;;
  mariadb)    seed_mariadb ;;
  sqlserver)  seed_sqlserver ;;
  oracle)     seed_oracle ;;
  db2)        seed_db2 ;;
  all)
    seed_postgres  || echo "  ✗ PostgreSQL skipped"
    seed_mysql     || echo "  ✗ MySQL skipped"
    seed_mariadb   || echo "  ✗ MariaDB skipped"
    seed_sqlserver || echo "  ✗ SQL Server skipped"
    seed_oracle    || echo "  ✗ Oracle skipped"
    seed_db2       || echo "  ✗ DB2 skipped"
    ;;
  *)
    echo "Unknown target: $TARGET"
    echo "Usage: $0 [postgres|mysql|mariadb|sqlserver|oracle|db2|all]"
    exit 1
    ;;
esac

echo ""
echo "Advanced pair connection reference (same hosts/credentials as seed-all.sh):"
echo "  schema/db 'demo_c' = source   |   'demo_d' = target"
echo "  Oracle: user demo_c/foxpass vs demo_d/foxpass on FREEPDB1"
