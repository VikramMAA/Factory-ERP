#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
PS="psql -v ON_ERROR_STOP=1 -q"

dropdb --if-exists rewind_test && createdb rewind_test
$PS -d rewind_test -f tests/sql/00_stubs.sql

# Supabase grants these to authenticated on every new table. Replicate it so the
# REVOKE in 0012 has something to revoke, otherwise the immutability tests pass
# for the wrong reason.
$PS -d rewind_test -c "
  grant usage on schema public to authenticated;
  alter default privileges in schema public
    grant select, insert, update, delete on tables to authenticated;
  alter default privileges in schema public
    grant usage, select on sequences to authenticated;"

# pg_cron is not installable locally; the stub above provides cron.schedule.
for f in supabase/migrations/*.sql; do
  sed 's/^create extension if not exists pg_cron;/-- stubbed locally/' "$f" \
    | $PS -d rewind_test -f -
done

$PS -d rewind_test -f supabase/seed.sql
$PS -d rewind_test -f tests/sql/10_functional.sql
$PS -d rewind_test -f tests/sql/20_rls.sql
echo "OK"
