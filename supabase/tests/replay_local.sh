#!/usr/bin/env bash
#
# Replays every migration onto a fresh local Postgres database.
#
# Why this exists: the merchandising app's migration history was found to be
# unreplayable at the exact moment it mattered — rebuilding production after
# the project was deleted in error. A history that has never been replayed
# from empty is a hope, not a disaster-recovery mechanism. This script is the
# rehearsal, and CI-shaped enough to become a CI job the day a Postgres
# service is added to the workflow.
#
# Usage:
#   supabase/tests/replay_local.sh            # database "hibiscus_local"
#   supabase/tests/replay_local.sh my_db
#
# Needs `psql`, `createdb` and `dropdb` on PATH, and a Postgres the current
# user can create databases on. Run as the `postgres` OS user on a stock
# Ubuntu install:  su postgres -c "supabase/tests/replay_local.sh"
#
# Also runs security_regression.sql afterwards if it exists, so one command
# proves both "the schema builds" and "the schema refuses what it should".

set -euo pipefail

DB="${1:-hibiscus_local}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PSQL=(psql -v ON_ERROR_STOP=1 -q -X)

if ! command -v psql >/dev/null; then
  echo "psql is not on PATH." >&2
  exit 1
fi

echo "Recreating database $DB"
dropdb --if-exists "$DB"
createdb "$DB"

echo "Applying Supabase environment stub"
"${PSQL[@]}" -d "$DB" -f "$ROOT/tests/local_supabase_stub.sql"

count=0
for f in "$ROOT"/migrations/*.sql; do
  name="$(basename "$f")"
  if ! [[ "$name" =~ ^[0-9]{14}_[a-z0-9]+(_[a-z0-9]+)*\.sql$ ]]; then
    echo "Bad migration filename: $name" >&2
    exit 1
  fi
  echo "== $name"
  "${PSQL[@]}" -d "$DB" -f "$f"
  count=$((count + 1))
done
echo "Applied $count migrations."

if [ -f "$ROOT/tests/security_regression.sql" ]; then
  echo "== security_regression.sql"
  # The suite always raises: PASSED or a list of regressions. Capture the
  # message and decide from it, because a non-zero exit is the *expected*
  # outcome of a passing run.
  out="$(psql -X -d "$DB" -f "$ROOT/tests/security_regression.sql" 2>&1 || true)"
  if echo "$out" | grep -q "ALL SECURITY CHECKS PASSED"; then
    echo "Security regression suite: PASSED"
  else
    echo "$out"
    echo "Security regression suite: FAILED" >&2
    exit 1
  fi
fi
