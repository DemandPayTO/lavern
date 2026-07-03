# Official Tribunal Forms

The HRTO SmartForms (Form 1, 1G, 2) are dynamic XFA PDFs — encrypted,
LiveCycle-rendered, and NOT fillable with standard PDF tooling. Starling
therefore generates a **datasets XML** file that Acrobat imports into the
pristine official form (Acrobat: *Prepare Form → More → Import Data*, or
*Form Data → Import*).

- `form1-datasets-blank.xml` — the blank data model extracted from the
  official Form 1 (v1.5). When the HRTO revises the form, re-extract:
  `qpdf --decrypt "Form 1 - apply.pdf" out.pdf` then pull the
  `<xfa:datasets>` stream (see scripts/fetch-official-forms.sh).
- Official sources (do not commit the PDFs — 2.5MB each and they change):
  https://tribunalsontario.ca/documents/hrto/SmartForms/Form%201%20-%20apply.pdf
