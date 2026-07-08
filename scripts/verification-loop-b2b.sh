#!/bin/bash
# Overnight verification loop — B2B (Starling / lavern).
#
# Each pass runs the CORE battery (backend vitest, viz vitest, tsc on both,
# and every $0 functional script against a live local server) PLUS one
# rotating lens. A pass fails if anything in it fails. The loop stops at the
# first failure (fix, then rerun from pass 1) or after 15 consecutive clean
# passes.
#
# Usage: bash scripts/verification-loop-b2b.sh [start_pass]

set -u
cd "$(dirname "$0")/.."
SCRATCH="${LOOP_SCRATCH:-/tmp}/b2b-loop"
mkdir -p "$SCRATCH"
LOG="$SCRATCH/loop.log"
PORT=3777

say() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG"; }

fail() { say "FAIL (pass $PASS, $1)"; exit 1; }

start_server() {
  rm -f "$SCRATCH/loop.db" "$SCRATCH/loop.db-wal" "$SCRATCH/loop.db-shm"
  SHEM_DB_PATH="$SCRATCH/loop.db" NODE_OPTIONS='--no-deprecation' \
    npx tsx src/index.ts --serve --port $PORT > "$SCRATCH/serve.log" 2>&1 &
  SERVER_PID=$!
  for i in $(seq 1 40); do
    curl -s -o /dev/null "http://localhost:$PORT/api/matters" && return 0
    sleep 1
  done
  return 1
}

stop_server() { kill "${SERVER_PID:-0}" 2>/dev/null; wait "${SERVER_PID:-0}" 2>/dev/null; }

core() {
  say "core: backend tests"
  (set -o pipefail; npm test 2>&1 | tail -2 >> "$LOG") || fail "backend tests"
  say "core: viz tests"
  (set -o pipefail; cd viz && npx vitest run 2>&1 | tail -2 >> "$LOG") || fail "viz tests"
  say "core: tsc backend + viz"
  npx tsc --noEmit >> "$LOG" 2>&1 || fail "backend tsc"
  (cd viz && npx tsc --noEmit >> "$LOG" 2>&1) || fail "viz tsc"
  say "core: functional scripts against live server"
  start_server || { stop_server; fail "server boot"; }
  local script rc=0
  for script in scripts/feature-test-*.ts; do
    EVAL_BASE_URL="http://localhost:$PORT" npx tsx "$script" >> "$LOG" 2>&1 || { say "functional failed: $script"; rc=1; break; }
  done
  stop_server
  [ $rc -eq 0 ] || fail "functional scripts"
}

# ── Lenses: one distinct check per pass ─────────────────────────────────

not_comment=':([0-9]+):[[:space:]]*(//|\*|/\*)'

lens_1() { # dependency audit (production, high+)
  npm audit --omit=dev --audit-level=high >> "$LOG" 2>&1 || return 1
}
lens_2() { # secret material in the tree (real keys, not placeholders)
  ! grep -rEn "sk-ant-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|xoxb-[0-9]+-|ghp_[A-Za-z0-9]{36}|-----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY-----" src viz/src scripts 2>/dev/null | grep -v "sk-ant-\.\.\." | grep -q .
}
lens_3() { # em-dashes in user-facing strings (not comments) in Starling surfaces
  ! grep -rn "—" src/employment src/labour viz/src/starling 2>/dev/null | grep -vE "$not_comment" | grep -q .
}
lens_4() { # contractions in generated-content template strings and Starling UI
  ! grep -rnE "(don't|can't|won't|doesn't|isn't|aren't|couldn't|shouldn't|wouldn't|we're|you're|it's|that's|let's)" \
      src/employment src/labour viz/src/starling 2>/dev/null \
    | grep -vE "$not_comment" | grep -vE "\.test\.|test-utils" | grep -q .
}
lens_5() { # tenant scoping: every getMatterById call passes a user id
  ! grep -rn "getMatterById(" src/api/routes/ | grep -vE "getMatterById\([^,)]+,[[:space:]]*[^)]+\)" | grep -q .
}
lens_6() { # zod validation present near every Starling POST route
  node -e '
    const fs = require("fs");
    for (const f of ["src/api/routes/employment-intake.ts","src/api/routes/labour.ts","src/api/routes/intake-portal.ts","src/api/routes/correspondence.ts"]) {
      const lines = fs.readFileSync(f, "utf8").split("\n");
      lines.forEach((l, i) => {
        if (/fastify\.(post|put)\(/.test(l)) {
          const window = lines.slice(i, i + 40).join("\n");
          if (!/safeParse|parse\(|schema/.test(window)) {
            console.error(`${f}:${i + 1} POST/PUT without visible validation`);
            process.exitCode = 1;
          }
        }
      });
    }
  ' >> "$LOG" 2>&1
}
lens_7() { # silent failure: truly empty catch blocks with no comment
  ! grep -rn "catch {}" src viz/src 2>/dev/null | grep -q . \
    && ! grep -rn "catch (.*) {}" src viz/src 2>/dev/null | grep -q .
}
lens_8() { # XSS sinks: no NEW dangerouslySetInnerHTML beyond the accepted baseline
  local count
  count=$(grep -rn "dangerouslySetInnerHTML" viz/src | wc -l | tr -d ' ')
  [ "$count" -le 11 ]
}
lens_9() { # SQL: no template-literal interpolation of user values into prepare()
  ! grep -rn 'prepare(`' src/ 2>/dev/null | grep '\${' | grep -vE "sets\.join|columns\.join|placeholders" | grep -q .
}
lens_10() { # path traversal: no fs read/write on raw request params in routes
  ! grep -rn "readFileSync\|writeFileSync\|createReadStream" src/api/routes/ 2>/dev/null | grep -E "req\.(params|query|body)" | grep -q .
}
lens_11() { # property fuzz: deterministic module invariants over random inputs
  npx tsx scripts/property-fuzz-b2b.ts >> "$LOG" 2>&1
}
lens_12() { # full dependency audit including dev, critical only
  npm audit --audit-level=critical >> "$LOG" 2>&1
}
lens_13() { # auth surface: public-path identity tests + new routes not public
  npx vitest run tests/unit/auth-public-path-identity.test.ts >> "$LOG" 2>&1
}
lens_14() { # logger discipline: no bare console.log in src/ outside CLI/terminal surfaces
  ! grep -rn "console\.log(" src/api/routes src/employment src/labour 2>/dev/null | grep -vE "$not_comment" | grep -q .
}
lens_15() { # end-to-end smoke: API lifecycle script against the live server
  start_server || { stop_server; return 1; }
  SHEM_DB_PATH="$SCRATCH/loop.db" bash scripts/smoke-test.sh "http://localhost:$PORT" >> "$LOG" 2>&1
  local rc=$?
  stop_server
  return $rc
}

START=${1:-1}
say "B2B verification loop starting at pass $START"
for PASS in $(seq "$START" 15); do
  say "════ PASS $PASS/15 ════"
  core
  say "lens $PASS"
  "lens_$PASS" || fail "lens_$PASS"
  say "PASS $PASS clean"
done
say "ALL 15 CONSECUTIVE PASSES CLEAN"
