#!/usr/bin/env bash
# Refresh the OLRB form data models when the Board revises Forms A-30 or
# A-53. Requires qpdf (brew install qpdf). Mirrors fetch-official-forms.sh.
#
# Usage: ./scripts/fetch-olrb-forms.sh
set -euo pipefail
cd "$(dirname "$0")/.."

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

declare -A URLS=(
  [a30]="https://forms.mgcs.gov.on.ca/dataset/3eaad45f-e0ba-4f91-acac-ed0a55b7d30a/resource/94795b6c-37fe-41f3-8606-3901608835a7/download/a-30e.pdf"
  [a53]="https://forms.mgcs.gov.on.ca/dataset/8a642f6b-8197-4de1-bbec-ddc743db53fa/resource/3ccf8c6b-e860-4463-a99f-803f8e00d199/download/a-53e.pdf"
)

for form in a30 a53; do
  echo "Downloading official Form ${form^^}..."
  curl -sL -A "Mozilla/5.0" -o "$TMP/$form.pdf" "${URLS[$form]}"
  file "$TMP/$form.pdf" | grep -q "PDF document" || { echo "Download failed for $form"; exit 1; }
  qpdf --decrypt "$TMP/$form.pdf" "$TMP/$form-dec.pdf" || cp "$TMP/$form.pdf" "$TMP/$form-dec.pdf"

  node --input-type=module -e "
import fs from 'node:fs';
import zlib from 'node:zlib';
const bytes = fs.readFileSync('$TMP/$form-dec.pdf');
let i = 0, ok = false;
while (i < bytes.length) {
  const s = bytes.indexOf(Buffer.from('stream'), i);
  if (s === -1) break;
  let d = s + 6;
  if (bytes[d] === 0x0d) d++;
  if (bytes[d] === 0x0a) d++;
  const e = bytes.indexOf(Buffer.from('endstream'), d);
  if (e === -1) break;
  const raw = bytes.subarray(d, e);
  let text = null;
  try { text = zlib.inflateSync(raw).toString('utf-8'); } catch { try { text = raw.toString('utf-8'); } catch {} }
  if (text && text.includes('<xfa:datasets')) {
    fs.writeFileSync('src/assets/forms/$form-datasets-blank.xml', text);
    console.log('  extracted datasets packet:', text.length, 'chars');
    ok = true; break;
  }
  i = e + 9;
}
if (!ok) { console.error('  NO datasets packet found — the form format may have changed'); process.exit(1); }
"
done
echo "Done. Review the diff of src/assets/forms/a30-datasets-blank.xml and a53-datasets-blank.xml,"
echo "and update src/labour/olrb-form-data.ts if node names changed."
