#!/usr/bin/env bash
# Database (docs/03-architecture/database.md) — end-to-end proof that row-level
# security actually enforces tenant isolation (NFR-1/NFR-2/NFR-14) on a real
# Postgres, not just in the @ama/memory in-memory reference implementation.
#
# Spins up a disposable Postgres container, applies migrations/0001_init.sql,
# seeds two tenants, and asserts each tenant sees only its own rows — and
# that a session with no tenant context set sees nothing at all (fail-closed).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="$SCRIPT_DIR/../migrations"
CONTAINER=ama-pg-rls-test
IMAGE="public.ecr.aws/supabase/postgres:17.6.1.059"
PORT=5433
FAILED=0

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "== starting disposable Postgres container =="
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=postgres -p "$PORT:5432" "$IMAGE" >/dev/null

# pg_isready can report ready during the image's own internal
# reconfigure-then-restart sequence — wait for an actual TCP query to
# succeed, not just the socket check, before trusting it's really up.
for i in $(seq 1 60); do
  if docker exec "$CONTAINER" psql -h 127.0.0.1 -U postgres -d postgres -tAc 'select 1' >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "== applying migrations =="
for f in "$MIGRATIONS_DIR"/*.sql; do
  docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d postgres < "$f" >/dev/null
done

echo "== creating non-superuser app role (RLS does not apply to the owner/superuser) =="
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d postgres >/dev/null <<'SQL'
create role app_user login password 'app_user';
grant usage on schema public to app_user;
grant select, insert, update on all tables in schema public to app_user;
SQL

echo "== seeding two tenants =="
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d postgres >/dev/null <<'SQL'
insert into tenant (id, kind) values
  ('11111111-1111-1111-1111-111111111111', 'owner'),
  ('22222222-2222-2222-2222-222222222222', 'white_label');

insert into client_kb_fact (tenant_id, key, value) values
  ('11111111-1111-1111-1111-111111111111', 'brand-colors', '"no bright colors"'),
  ('22222222-2222-2222-2222-222222222222', 'brand-colors', '"bright and playful"');

insert into tool_registry_entry (tool_id, display_name) values ('google-ads', 'Google Ads');

insert into mcp_credential (tenant_id, tool_id, credential) values
  ('11111111-1111-1111-1111-111111111111', 'google-ads', '{"token":"token-a"}');
SQL

assert_equal() {
  local description="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  PASS: $description"
  else
    echo "  FAIL: $description (expected [$expected], got [$actual])"
    FAILED=1
  fi
}

query_as_app_user() {
  # $1 = SQL to run after optionally setting app.tenant_id
  PGPASSWORD=app_user docker exec -e PGPASSWORD=app_user -i "$CONTAINER" \
    psql -h 127.0.0.1 -U app_user -d postgres -tA -c "$1"
}

echo "== assertions =="
set +e  # from here on, a failed query is a test failure to report, not a script-abort condition

assert_equal "no tenant context set -> zero client_kb_fact rows visible (fail-closed)" \
  "0" "$(query_as_app_user 'select count(*) from client_kb_fact;')"

assert_equal "no tenant context set -> zero mcp_credential rows visible (fail-closed)" \
  "0" "$(query_as_app_user 'select count(*) from mcp_credential;')"

TENANT_A_VALUE=$(query_as_app_user "set app.tenant_id = '11111111-1111-1111-1111-111111111111'; select value from client_kb_fact where key = 'brand-colors';" | tail -n1)
assert_equal "tenant A sees its own client_kb_fact value" '"no bright colors"' "$TENANT_A_VALUE"

TENANT_A_ROW_COUNT=$(query_as_app_user "set app.tenant_id = '11111111-1111-1111-1111-111111111111'; select count(*) from client_kb_fact;" | tail -n1)
assert_equal "tenant A sees exactly 1 client_kb_fact row, not tenant B's" "1" "$TENANT_A_ROW_COUNT"

TENANT_A_CREDENTIAL_COUNT=$(query_as_app_user "set app.tenant_id = '11111111-1111-1111-1111-111111111111'; select count(*) from mcp_credential;" | tail -n1)
assert_equal "tenant A sees its own mcp_credential" "1" "$TENANT_A_CREDENTIAL_COUNT"

TENANT_B_VALUE=$(query_as_app_user "set app.tenant_id = '22222222-2222-2222-2222-222222222222'; select value from client_kb_fact where key = 'brand-colors';" | tail -n1)
assert_equal "tenant B sees its own (different) client_kb_fact value" '"bright and playful"' "$TENANT_B_VALUE"

TENANT_B_CREDENTIAL_COUNT=$(query_as_app_user "set app.tenant_id = '22222222-2222-2222-2222-222222222222'; select count(*) from mcp_credential;" | tail -n1)
assert_equal "tenant B sees zero mcp_credential rows (only tenant A has one)" "0" "$TENANT_B_CREDENTIAL_COUNT"

SHARED_VISIBLE=$(query_as_app_user "select count(*) from tool_registry_entry;")
assert_equal "shared tool_registry_entry is visible with no tenant context at all (Database §4)" "1" "$SHARED_VISIBLE"

echo "=============================="
if [ "$FAILED" -eq 0 ]; then
  echo "RESULT: all RLS isolation assertions passed"
  exit 0
else
  echo "RESULT: at least one assertion FAILED"
  exit 1
fi
