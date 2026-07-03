#!/usr/bin/env bash
# Refresh the HRTO SmartForm data model when Tribunals Ontario revises the
# forms. Requires qpdf (brew install qpdf).
#
# Usage: ./scripts/fetch-official-forms.sh
set -euo pipefail
cd "$(dirname "$0")/.."

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "Downloading official Form 1..."
curl -sL -A "Mozilla/5.0" -o "$TMP/form1.pdf" \
  "https://tribunalsontario.ca/documents/hrto/SmartForms/Form%201%20-%20apply.pdf"
file "$TMP/form1.pdf" | grep -q "PDF document" || { echo "Download failed"; exit 1; }

echo "Decrypting..."
qpdf --decrypt "$TMP/form1.pdf" "$TMP/form1-dec.pdf"

echo "Extracting XFA datasets packet..."
node --input-type=module -e "
import fs from 'node:fs';
import zlib from 'node:zlib';
const bytes = fs.readFileSync('$TMP/form1-dec.pdf');
let i = 0, ok = false;
while (i < bytes.length) {
  const s = bytes.indexOf(Buffer.from('stream'), i);
  if (s === -1) break;
  let d = s + 6;
  if (bytes[d] === 0x0d) d++;
  if (bytes[d] === 0x0a) d++;
  const e = bytes.indexOf(Buffer.from('endstream'), d);
  if (e === -1) break;
  try {
    const inf = zlib.inflateSync(bytes.subarray(d, e));
    if (/<xfa:datasets/.test(inf.subarray(0, 120).toString('utf8'))) {
      fs.writeFileSync('src/assets/forms/form1-datasets-blank.xml', inf);
      console.log('Wrote src/assets/forms/form1-datasets-blank.xml (' + inf.length + ' bytes)');
      ok = true;
      break;
    }
  } catch {}
  i = e + 9;
}
if (!ok) { console.error('No datasets packet found — form structure may have changed'); process.exit(1); }
"

echo "Running mapper tests against the refreshed data model..."
npx vitest run tests/unit/hrto-form1-data.test.ts
echo "Done. If tests failed, the HRTO changed field names — update hrto-form1-data.ts."
