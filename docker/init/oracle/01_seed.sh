#!/bin/bash
# Runs as root inside the oracle-free container after the DB is ready.
# Connects as SYSTEM to create the demo_a / demo_b users and objects.
sqlplus -S "system/${ORACLE_PASSWORD}@//localhost:1521/FREEPDB1" \
  < /container-entrypoint-initdb.d/02_seed.sql
