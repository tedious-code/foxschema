#!/bin/bash
# FoxSchema DB2 demo seed — auto-run by the DB2 community image's /var/custom
# hook (setup_db2_instance.sh execs every file under /var/custom as root,
# after the instance and DBNAME database are ready). Only this wrapper is
# mounted into /var/custom/ — the SQL lives at a separate path (see
# docker-compose.yml) so the hook's "run every file here" loop doesn't also
# try to execute the .sql file directly.
set -e

echo "(*) FoxSchema: seeding DEMO_A / DEMO_B into foxdb ..."
# Default terminator stays ';' — the seed file itself switches to '@' locally
# (via --#SET TERMINATOR) around the two compound SQL PL blocks and back.
su - db2inst1 -c "db2 connect to foxdb && db2 -tvf /var/custom-sql/01_seed.sql -z /tmp/foxschema_seed.log" || true
echo "(*) FoxSchema: seed done — see /tmp/foxschema_seed.log inside the container for details."
