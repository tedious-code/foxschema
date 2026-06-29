#!/bin/bash
# Start SQL Server in the background, wait until ready, seed, then keep it running.
/opt/mssql/bin/sqlservr &
MSSQL_PID=$!

echo "Waiting for SQL Server to be ready..."
for i in $(seq 1 60); do
  /opt/mssql-tools18/bin/sqlcmd -S localhost -U SA -P "$MSSQL_SA_PASSWORD" \
    -Q "SELECT 1" -No -C &>/dev/null && break
  sleep 2
done

echo "SQL Server ready — running seed..."
/opt/mssql-tools18/bin/sqlcmd -S localhost -U SA -P "$MSSQL_SA_PASSWORD" \
  -i /docker-init/01_seed.sql -No -C 2>&1 || true

echo "Seed done. SQL Server running."
wait $MSSQL_PID
