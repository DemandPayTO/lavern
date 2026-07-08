#!/usr/bin/env bash
# LOCAL-MODE smoke — deployment-shape invariants at $0.
# Verifies: API serves, session CRUD round-trips without dispatching agents,
# auth-shaped routes stay unregistered in LOCAL MODE, the agent card and the
# docket ICS endpoints answer with the right content types.
# Usage: ./scripts/smoke-local.sh [base_url]

BASE="${1:-http://localhost:3000}"
PASS=0
FAIL=0
pass() { printf "  PASS %s\n" "$1"; PASS=$((PASS + 1)); }
fail() { printf "  FAIL %s\n" "$1"; FAIL=$((FAIL + 1)); }
json_val() { printf '%s' "$1" | grep -o "\"$2\":\"[^\"]*\"" | head -1 | sed "s/\"$2\":\"//;s/\"$//"; }

printf "Lavern LOCAL-MODE smoke\nTarget: %s\n\n" "$BASE"

# 1. API up
curl -sf "$BASE/api/matters" > /dev/null && pass "API serves /api/matters" || fail "API unreachable"

# 2. Session CRUD (created sessions idle at intake; no agent dispatch, no spend)
RESP=$(curl -sf -X POST "$BASE/api/sessions" -H "Content-Type: application/json" \
  -d '{"request":{"type":"legal_question","requestText":"[SMOKE] no-op"},"team":["Contract Analyst"],"workflow":"counsel","options":{"budget":1,"intensity":"standard"}}' 2>&1 || true)
SID=$(json_val "$RESP" "sessionId")
[ -n "$SID" ] && pass "session created" || fail "session create: $RESP"
if [ -n "$SID" ]; then
  curl -sf "$BASE/api/sessions/$SID" > /dev/null && pass "session readable" || fail "session read"
  curl -sf -X DELETE "$BASE/api/sessions/$SID" > /dev/null && pass "session deleted" || fail "session delete"
fi

# 3. LOCAL MODE shape: auth routes are NOT registered
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -d '{}')
[ "$CODE" = "404" ] && pass "auth routes unregistered in LOCAL MODE (404)" || fail "auth route answered $CODE (expected 404)"

# 4. Agent card
curl -sf "$BASE/.well-known/agent.json" | grep -q '"name"' && pass "agent card served" || fail "agent card"

# 5. Docket ICS content type
CT=$(curl -sf -o /dev/null -w "%{content_type}" "$BASE/api/employment/deadlines.ics")
case "$CT" in text/calendar*) pass "docket ICS content type" ;; *) fail "docket ICS content type: $CT" ;; esac

printf "\nResult: %d passed, %d failed\n" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
