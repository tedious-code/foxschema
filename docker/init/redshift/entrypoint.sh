#!/usr/bin/env bash
# Redshift local stand-in: Postgres with SSL (Redshift connections default to sslmode=require).
set -euo pipefail
CERT_DIR="${PGDATA:-/var/lib/postgresql/data}"
if [ ! -f "$CERT_DIR/server.crt" ] || [ ! -f "$CERT_DIR/server.key" ]; then
  openssl req -new -x509 -days 3650 -nodes -text \
    -out "$CERT_DIR/server.crt" \
    -keyout "$CERT_DIR/server.key" \
    -subj "/CN=localhost" >/dev/null 2>&1
  chmod 600 "$CERT_DIR/server.key"
  chown postgres:postgres "$CERT_DIR/server.crt" "$CERT_DIR/server.key"
fi
exec docker-entrypoint.sh postgres \
  -c ssl=on \
  -c ssl_cert_file="$CERT_DIR/server.crt" \
  -c ssl_key_file="$CERT_DIR/server.key"
