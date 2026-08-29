#!/usr/bin/env bash
# Create a Linux login in foxschema-db2, grant CONNECT, optionally assign a role,
# then list the OS account and the SQL authorization ID.
#
# Usage:
#   FOX_DB2_OS_PASSWORD='choose-a-password' bash scripts/seed/db2-os-user.sh report_user [ROLE]
#   FOX_DB2_OS_PASSWORD='new-password' bash scripts/seed/db2-os-user.sh report_user --password
#   bash scripts/seed/db2-os-user.sh report_user --disable
#   bash scripts/seed/db2-os-user.sh report_user --enable
#
# Matches Access → User Management → Add user (OS). Fox Schema never runs this
# for you and never stores the password.

set -euo pipefail

CONTAINER="${FOX_DB2_CONTAINER:-foxschema-db2}"
DATABASE="${FOX_DB2_DATABASE:-foxdb}"
LINUX="${1:-}"
ROLE=""
ACTION=create

case "${2:-}" in
  --password) ACTION=password ;;
  --disable) ACTION=disable ;;
  --enable) ACTION=enable ;;
  '') ;;
  *) ROLE="$2" ;;
esac

if [[ -z "$LINUX" ]]; then
  echo "Usage:" >&2
  echo "  FOX_DB2_OS_PASSWORD='…' bash scripts/seed/db2-os-user.sh <linux_user> [ROLE]" >&2
  echo "  FOX_DB2_OS_PASSWORD='…' bash scripts/seed/db2-os-user.sh <linux_user> --password" >&2
  echo "  bash scripts/seed/db2-os-user.sh <linux_user> --disable" >&2
  echo "  bash scripts/seed/db2-os-user.sh <linux_user> --enable" >&2
  exit 1
fi
if [[ ! "$LINUX" =~ ^[a-z_][a-z0-9_]{0,31}$ ]]; then
  echo "Linux login must start with a letter or underscore, then letters, digits, or _ (max 32)." >&2
  exit 1
fi
if [[ -n "$ROLE" ]]; then
  ROLE_LC="$(printf '%s' "$ROLE" | tr '[:upper:]' '[:lower:]')"
  if [[ ! "$ROLE_LC" =~ ^[a-z_][a-z0-9_]{0,31}$ ]]; then
    echo "Role name must use letters, digits, or underscore." >&2
    exit 1
  fi
fi
if [[ "$ACTION" == create || "$ACTION" == password ]]; then
  if [[ -z "${FOX_DB2_OS_PASSWORD:-}" ]]; then
    echo "Set FOX_DB2_OS_PASSWORD to the OS password for $LINUX (not stored by Fox Schema)." >&2
    exit 1
  fi
fi
if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "✗ container $CONTAINER is not running. Start it with: docker compose up -d db2" >&2
  exit 1
fi

AUTHID="$(printf '%s' "$LINUX" | tr '[:lower:]' '[:upper:]')"
ROLE_AUTH=""
if [[ -n "$ROLE" ]]; then
  ROLE_AUTH="$(printf '%s' "$ROLE" | tr '[:lower:]' '[:upper:]')"
fi

echo "▶ $ACTION  OS user $LINUX  →  Db2 AUTHID $AUTHID  on $CONTAINER / $DATABASE"

if [[ "$ACTION" == password ]]; then
  docker exec -u 0 "$CONTAINER" bash -lc "echo \"$LINUX:$FOX_DB2_OS_PASSWORD\" | chpasswd"
  docker exec -u 0 "$CONTAINER" passwd -S "$LINUX" || true
  echo "✓ password updated. Connect as $LINUX on localhost:50000 database $DATABASE."
  exit 0
fi

if [[ "$ACTION" == disable ]]; then
  docker exec -u 0 "$CONTAINER" passwd -l "$LINUX"
  docker exec "$CONTAINER" su - db2inst1 -c "db2 connect to $DATABASE && db2 'REVOKE CONNECT ON DATABASE FROM USER $AUTHID'" || true
  docker exec -u 0 "$CONTAINER" passwd -S "$LINUX" || true
  echo "✓ disabled (OS lock + REVOKE CONNECT). Enable with: bash scripts/seed/db2-os-user.sh $LINUX --enable"
  exit 0
fi

if [[ "$ACTION" == enable ]]; then
  docker exec -u 0 "$CONTAINER" passwd -u "$LINUX"
  docker exec "$CONTAINER" su - db2inst1 -c "db2 connect to $DATABASE && db2 'GRANT CONNECT ON DATABASE TO USER $AUTHID'"
  docker exec -u 0 "$CONTAINER" passwd -S "$LINUX" || true
  echo "✓ enabled. If login fails, set a password: FOX_DB2_OS_PASSWORD='…' bash scripts/seed/db2-os-user.sh $LINUX --password"
  exit 0
fi

docker exec -u 0 "$CONTAINER" bash -lc "id $LINUX >/dev/null 2>&1 || useradd -m -s /bin/bash $LINUX"
docker exec -u 0 "$CONTAINER" bash -lc "echo \"$LINUX:$FOX_DB2_OS_PASSWORD\" | chpasswd"
docker exec "$CONTAINER" su - db2inst1 -c "db2 connect to $DATABASE && db2 'GRANT CONNECT ON DATABASE TO USER $AUTHID'"
if [[ -n "$ROLE_AUTH" ]]; then
  docker exec "$CONTAINER" su - db2inst1 -c "db2 connect to $DATABASE && db2 'GRANT ROLE $ROLE_AUTH TO USER $AUTHID'"
fi

echo "── OS account ──"
docker exec -u 0 "$CONTAINER" getent passwd "$LINUX" || true
echo "── CONNECT ──"
docker exec "$CONTAINER" su - db2inst1 -c "db2 connect to $DATABASE && db2 \"SELECT TRIM(GRANTEE) AS AUTHID, CONNECTAUTH FROM SYSCAT.DBAUTH WHERE GRANTEETYPE = 'U' AND TRIM(GRANTEE) = '$AUTHID'\"" || true
echo "── roles ──"
docker exec "$CONTAINER" su - db2inst1 -c "db2 connect to $DATABASE && db2 \"SELECT TRIM(ROLENAME) AS ROLE FROM SYSCAT.ROLEAUTH WHERE GRANTEETYPE = 'U' AND TRIM(GRANTEE) = '$AUTHID'\"" || true
echo "✓ done. Reload User Management, then Grant access for table privileges."
echo "  Connect as $LINUX / (the password you set) on localhost:50000 database $DATABASE."
