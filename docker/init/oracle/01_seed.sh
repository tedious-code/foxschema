#!/bin/bash
# Runs as root inside the oracle-free container after the DB is ready.
# Connects as SYSTEM to create the demo_a / demo_b users and objects.
sqlplus -S "system/${ORACLE_PASSWORD}@//localhost:1521/FREEPDB1" \
  < /container-entrypoint-initdb.d/02_seed.sql

# The dynamic performance views need SYSDBA to grant. `system` cannot do it —
# ORA-01031 — and sqlplus continues past the error, so keeping these in the
# file above made them look applied when they never were.
sqlplus -S "/ as sysdba" \
  < /container-entrypoint-initdb.d/03_vviews_sysdba.sql
