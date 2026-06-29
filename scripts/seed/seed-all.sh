#!/usr/bin/env bash
# FoxSchema — manually re-seed demo data into running containers.
# Useful after a schema change without doing a full volume reset.
#
# Normal workflow: docker compose down -v && docker compose up -d
# (init scripts in docker/init/ auto-seed on first start)
#
# This script is for re-seeding without a volume wipe.
# Usage: bash scripts/seed/seed-all.sh [postgres|mysql|mariadb|sqlserver|oracle|sqlite]

set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
INIT="$REPO/docker/init"

SL_DIR=/tmp/foxschema-sqlite

seed_postgres() {
  echo "▶ PostgreSQL …"
  docker exec -i foxschema-postgres psql -U foxuser -d foxdb \
    < "$INIT/postgres/01_seed.sql"
  echo "  ✓ done"
}

seed_mysql() {
  echo "▶ MySQL …"
  docker exec -i foxschema-mysql mysql -uroot -pfoxrootpass \
    < "$INIT/mysql/01_seed.sql"
  echo "  ✓ done"
}

seed_mariadb() {
  echo "▶ MariaDB …"
  docker exec -i foxschema-mariadb mariadb -uroot -pfoxrootpass \
    < "$INIT/mariadb/01_seed.sql"
  echo "  ✓ done"
}

seed_sqlserver() {
  echo "▶ SQL Server …"
  docker exec -i foxschema-sqlserver \
    /opt/mssql-tools18/bin/sqlcmd -S localhost -U SA -P 'FoxPass123!' \
    -i /docker-init/01_seed.sql -No -C
  echo "  ✓ done"
}

seed_oracle() {
  echo "▶ Oracle …"
  docker exec -i foxschema-oracle \
    sqlplus -S "system/FoxPass123@//localhost:1521/FREEPDB1" \
    < "$INIT/oracle/02_seed.sql"
  echo "  ✓ done"
}

seed_sqlite() {
  echo "▶ SQLite …"
  mkdir -p "$SL_DIR"
  rm -f "$SL_DIR/demo_a.db" "$SL_DIR/demo_b.db"
  sqlite3 "$SL_DIR/demo_a.db" < "$INIT/sqlite/demo_a.sql"
  sqlite3 "$SL_DIR/demo_b.db" < "$INIT/sqlite/demo_b.sql"
  echo "  ✓ done  →  $SL_DIR/demo_a.db  |  demo_b.db"
}

TARGET="${1:-all}"
case "$TARGET" in
  postgres)   seed_postgres ;;
  mysql)      seed_mysql ;;
  mariadb)    seed_mariadb ;;
  sqlserver)  seed_sqlserver ;;
  oracle)     seed_oracle ;;
  sqlite)     seed_sqlite ;;
  all)
    seed_postgres  || echo "  ✗ PostgreSQL skipped"
    seed_mysql     || echo "  ✗ MySQL skipped"
    seed_mariadb   || echo "  ✗ MariaDB skipped"
    seed_sqlserver || echo "  ✗ SQL Server skipped"
    seed_oracle    || echo "  ✗ Oracle skipped"
    seed_sqlite    || echo "  ✗ SQLite skipped"
    ;;
  *)
    echo "Unknown target: $TARGET"
    echo "Usage: $0 [postgres|mysql|mariadb|sqlserver|oracle|sqlite|all]"
    exit 1
    ;;
esac

echo ""
echo "Connection reference:"
echo "  PostgreSQL  localhost:5432  foxuser/foxpass      db=foxdb     schema=demo_a vs demo_b"
echo "  MySQL       localhost:3306  foxuser/foxpass      db=demo_a vs demo_b"
echo "  MariaDB     localhost:3307  foxuser/foxpass      db=demo_a vs demo_b"
echo "  SQL Server  localhost:1433  SA/FoxPass123!       db=foxdb     schema=demo_a vs demo_b"
echo "  Oracle      localhost:1521  demo_a/foxpass       service=FREEPDB1 vs user=demo_b/foxpass"
echo "  SQLite      $SL_DIR/demo_a.db  vs  demo_b.db"
