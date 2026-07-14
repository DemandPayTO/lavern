# Backup Restore Drill — 2026-07-14

First restore drill of the production backup chain. Result: PASS.

## What was done

1. Listed `/data/backups` on the production volume (demandpay-starling, yyz):
   nightly backups present and current, `starling-2026-07-14.db` (450,560
   bytes) through `starling-2026-07-03.db` (14-day retention working).
2. Fetched `starling-2026-07-14.db` via `fly ssh sftp get` to a local
   scratch directory.
3. `PRAGMA integrity_check` → `ok`. All 25 application tables present
   (matters, users, session_archive, portal_tokens, firm_templates,
   usage_events, kb_*, billing, audit_log, ...).
4. Parsed every matter payload: 5/5 `data_json` blobs parse as valid JSON
   with full structure (matterId, employmentData, generated documents,
   conflictCheck, kyc, timeline fields).
5. Booted the Starling server against a copy of the restored file:
   `/health` OK, schema accepted as-is by the current binary.
6. Tenant-scoping sanity check on the restored data: in LOCAL MODE the API
   returns zero matters because all five belong to the auth user
   `test@demandpay.ca` — scoping holds even on a restored database.

## Findings

- The restore path works end to end: fetch file, point `SHEM_DB_PATH` at
  it, start the server. Recovery time in a real incident: minutes.
- All current production matters are test data (owned by
  test@demandpay.ca). No real client data exists yet, which is the correct
  state to be running the first drill in.

## Residual

- Layer 3 (Tigris off-site bucket) was not independently restored in this
  drill; it receives the same nightly file (upload confirmed in prod logs).
  A future drill should pull one artifact from the bucket itself, either
  via `POST /api/admin/backup-now` verification or from a machine with the
  bucket credentials.
- Repeat the drill after the first real client matter exists, and put it
  on a quarterly cadence.
