-- Fox Schema (foxschema)
-- Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
-- SPDX-License-Identifier: Apache-2.0
--
-- Read access to the dynamic performance views, for Server Insights.
--
-- Separate from 02_seed.sql because these need SYSDBA. They lived there for a
-- while and never took: both the init hook and the reseed run 02_seed.sql as
-- `system`, and granting on a SYS.V_$ view as `system` is ORA-01031
-- insufficient privileges. sqlplus continues past that by default, so the file
-- looked right and the demo users never got the grants — surfacing later as
--
--     ORA-00942: table or view "SYS"."V_$PARAMETER" does not exist
--
-- which Oracle reports for a view you may not read, not just one that is
-- absent. Verified: after these grants the pool probe returns numbers.
--
-- The users live in the PDB, so the grants have to be made there.
ALTER SESSION SET CONTAINER = FREEPDB1;

GRANT SELECT ON SYS.V_$SESSION TO demo_a;
GRANT SELECT ON SYS.V_$SESSION TO demo_b;
GRANT SELECT ON SYS.V_$PARAMETER TO demo_a;
GRANT SELECT ON SYS.V_$PARAMETER TO demo_b;
GRANT SELECT ON SYS.V_$OSSTAT TO demo_a;
GRANT SELECT ON SYS.V_$OSSTAT TO demo_b;
GRANT SELECT ON SYS.V_$INSTANCE TO demo_a;
GRANT SELECT ON SYS.V_$INSTANCE TO demo_b;
GRANT SELECT ON SYS.V_$SGASTAT TO demo_a;
GRANT SELECT ON SYS.V_$SGASTAT TO demo_b;
GRANT SELECT ON SYS.V_$SESSION_WAIT TO demo_a;
GRANT SELECT ON SYS.V_$SESSION_WAIT TO demo_b;

EXIT
