#!/bin/bash
# Verification loop — B2B (Starling / lavern).
#
# Three tiers, because one tier was the wrong shape. Running twelve feature
# tests fifteen times costs real money in live model calls, and on a day of
# rapid iteration most of that was spent re-proving generation behaviour that
# had not been touched. The repetition is what catches intermittent model
# defects, so it is kept for the deep tier and paid for deliberately.
#
#   --fast   tests, tsc and the lenses. One pass, no model calls, seconds.
#            This is the tier to run while iterating.
#   (none)   five passes, everything. The deploy gate. Roughly $5.
#   --deep   fifteen passes, everything. Roughly $14. Run it when the
#            generation path itself changed, or overnight.
#
# A pass fails if anything in it fails; the loop stops at the first failure.
#
# Resuming: pass a start pass to continue a run. The commit the run began on
# is recorded, and resuming refuses if the tree has moved, because passes
# banked against different bytes are not evidence about these ones.
#
# Usage: bash scripts/verification-loop-b2b.sh [--fast|--deep] [start_pass]

set -u
cd "$(dirname "$0")/.."

TIER=gate
ARGS=()
for arg in "$@"; do
  case "$arg" in
    --fast) TIER=fast ;;
    --deep) TIER=deep ;;
    *) ARGS+=("$arg") ;;
  esac
done
case "$TIER" in
  fast) PASSES=1 ;;
  gate) PASSES=5 ;;
  deep) PASSES=15 ;;
esac

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
  if [ "$TIER" = fast ]; then
    say "core: functional scripts skipped (fast tier makes no model calls)"
    return 0
  fi
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
lens_3() { # em-dashes in user-facing strings (comments stripped)
  node scripts/scan-noncomment.mjs '—' src/employment src/labour viz/src/starling >> "$LOG" 2>&1
}
lens_4() { # contractions in user-facing strings (comments stripped)
  node scripts/scan-noncomment.mjs "(don't|can't|won't|doesn't|isn't|aren't|couldn't|shouldn't|wouldn't|we're|you're|let's)" \
    src/employment src/labour viz/src/starling >> "$LOG" 2>&1
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
lens_8() { # XSS sinks: dangerouslySetInnerHTML lives in the two render components, nowhere else
  # This replaced a bare count with a ceiling of 11 on 2026-08-26. The count was
  # weak in both directions: it could not tell a sanitised sink from an
  # unsanitised one (three panels were rendering raw model output while the
  # count read as merely "drifted"), and it failed open, since adding an unsafe
  # sink while deleting any old one held the total steady.
  #
  # Every sink now lives in one of two components, each carrying the trust
  # boundary in its header:
  #   viz/src/starling/DocumentHtml.tsx        server-sanitised document HTML
  #   viz/src/briefing/components/InlineSvg.tsx  app-generated avatar/trophy SVG
  #
  # The invariant is zero, not a ceiling, so it cannot be quietly bumped: a new
  # workspace panel gets the safe path by default. If a third family of sink is
  # ever genuinely needed, add the component and list it here deliberately.
  # Match the JSX usage, not the bare word: the components' own header comments
  # name the prop, and so may a future doc comment.
  local sink='dangerouslySetInnerHTML={{'
  local stray
  stray=$(grep -rnF "$sink" viz/src \
    | grep -v "viz/src/starling/DocumentHtml.tsx" \
    | grep -v "viz/src/briefing/components/InlineSvg.tsx")
  if [ -n "$stray" ]; then
    echo "$stray" >> "$LOG"
    echo "raw dangerouslySetInnerHTML outside DocumentHtml/InlineSvg (render through them instead)" >> "$LOG"
    return 1
  fi
  # Both components must still exist and hold exactly one sink each.
  [ "$(grep -cF "$sink" viz/src/starling/DocumentHtml.tsx)" = "1" ] \
    && [ "$(grep -cF "$sink" viz/src/briefing/components/InlineSvg.tsx)" = "1" ]
}
lens_9() { # SQL: no template-literal interpolation inside the prepare() SQL itself
  node -e '
    const { execSync } = require("child_process");
    const hits = execSync("grep -rn \"prepare(\\`\" src/ || true").toString().trim().split("\n").filter(Boolean);
    let bad = 0;
    for (const hit of hits) {
      const text = hit.slice(hit.indexOf("prepare(`") + 9);
      const sql = text.slice(0, text.indexOf("`") === -1 ? undefined : text.indexOf("`"));
      if (sql.includes("${") && !/sets\.join|columns\.join|placeholders/.test(sql)) {
        console.error(hit.slice(0, 200)); bad++;
      }
    }
    process.exit(bad ? 1 : 0);
  ' >> "$LOG" 2>&1
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
lens_14() { # logger discipline: no bare console.log in route/domain modules
  node scripts/scan-noncomment.mjs 'console\.log\(' src/api/routes src/employment src/labour >> "$LOG" 2>&1
}
lens_15() { # end-to-end LOCAL-MODE smoke against the live server ($0, no dispatch)
  start_server || { stop_server; return 1; }
  bash scripts/smoke-local.sh "http://localhost:$PORT" >> "$LOG" 2>&1
  local rc=$?
  stop_server
  return $rc
}

START=${ARGS[0]:-1}
SHA=$(git rev-parse HEAD 2>/dev/null || echo unknown)
SHA_FILE="$SCRATCH/run-sha"

# Passes banked against different bytes are not evidence about these ones, so
# a resume onto a moved tree is refused rather than quietly accepted.
if [ "$START" -gt 1 ] && [ -f "$SHA_FILE" ]; then
  PREV=$(cat "$SHA_FILE")
  if [ "$PREV" != "$SHA" ]; then
    say "Refusing to resume at pass $START: the run began on $PREV and the tree is now $SHA."
    say "Start again from pass 1."
    exit 1
  fi
fi
[ "$START" -le 1 ] && echo "$SHA" > "$SHA_FILE"

# A start pass beyond the tier's count makes seq produce nothing, so the loop
# body never runs and the script would announce a clean run having verified
# nothing at all. A gate that can report a false green is worse than no gate.
if [ "$START" -gt "$PASSES" ]; then
  say "Refusing to start at pass $START: the $TIER tier runs $PASSES pass(es)."
  exit 1
fi

# Fifteen lenses over fewer passes: every lens still runs, several per pass,
# so a short run does not silently drop the security checks.
run_lenses_for_pass() {
  local pass=$1 total=$2 i
  for i in $(seq 1 15); do
    if [ $(( (i - 1) % total + 1 )) -eq "$pass" ]; then
      say "lens $i"
      "lens_$i" || fail "lens_$i"
    fi
  done
}

say "B2B verification loop: $TIER tier, $PASSES pass(es), starting at $START (HEAD $SHA)"
for PASS in $(seq "$START" "$PASSES"); do
  say "════ PASS $PASS/$PASSES ════"
  core
  run_lenses_for_pass "$PASS" "$PASSES"
  say "PASS $PASS clean"
done
say "ALL $PASSES CONSECUTIVE PASSES CLEAN ($TIER tier)"
