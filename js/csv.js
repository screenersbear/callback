// CSV reading for "Import people from a spreadsheet". Handles quoted fields,
// commas and line breaks inside quotes, a leading BOM, and files that use
// semicolons or tabs instead of commas.

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

export function parseCSV(input) {
  const text = input.replace(/^﻿/, '');
  const delim = detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delim) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// Fields a column can map to, with header words that suggest each one.
// Within a field, earlier hints win: "Job Title" beats Outlook's "Title"
// column, which holds Mr or Ms.
export const CSV_FIELDS = [
  { key: 'name', label: 'Name', hints: ['full name', 'name', 'contact', 'display name'] },
  { key: 'lastName', label: 'Last name (optional, joined to the name)', hints: ['last name', 'surname', 'family name', 'last'] },
  { key: 'email', label: 'Email', hints: ['email', 'e-mail', 'email address', 'mail'] },
  { key: 'role', label: 'Role', hints: ['role', 'job title', 'position', 'title', 'job'] },
  { key: 'organization', label: 'Organization', hints: ['organization', 'organisation', 'company', 'agency', 'brand', 'employer'] },
  { key: 'notes', label: 'Notes', hints: ['notes', 'note', 'comments', 'description'] },
  { key: 'phone', label: 'Phone', hints: ['phone', 'mobile', 'cell', 'tel'] },
  { key: 'instagram', label: 'Instagram', hints: ['instagram', 'ig', 'insta'] },
  { key: 'website', label: 'Website', hints: ['website', 'web page', 'web', 'url', 'site'] },
  { key: 'howWeMet', label: 'How we met', hints: ['how we met', 'met', 'source'] },
  { key: 'tags', label: 'Tags', hints: ['tags', 'tag', 'labels', 'group membership', 'groups'] },
];

// Google Contacts and Outlook split each email, phone and website into a
// "- Label" (or "- Type") column saying Work or Home, then a "- Value"
// column with the address itself. The label column is never the one wanted.
const LABEL_COLUMN = /-\s*(label|type)\s*$/;

// Headings that contain a hint word but mean something else.
const NOT_FOR = {
  name: /compan|organi|last|user|file|sur|prefix|suffix|nick|phonetic|middle|yomi/,
  phone: /phonetic/,
};

// Best guess at which column feeds each field (index, or -1 for none).
export function guessMapping(headers) {
  const norm = headers.map((h) => String(h).trim().toLowerCase());
  const used = new Set();
  const map = {};
  const firstIdx = norm.findIndex((h) => /^(first|given)( name)?$/.test(h));
  const find = (hints, test) => {
    for (const hint of hints) {
      const i = norm.findIndex((h, j) => !used.has(j) && !LABEL_COLUMN.test(h) && test(h, hint));
      if (i >= 0) return i;
    }
    return -1;
  };
  for (const f of CSV_FIELDS) {
    // Exact header matches win over partial ones, so "Company name" never
    // beats a plain "Name" column.
    let idx = find(f.hints, (h, hint) => h === hint);
    if (f.key === 'name' && idx < 0 && firstIdx >= 0) idx = firstIdx;
    if (idx < 0) {
      const avoid = NOT_FOR[f.key];
      idx = find(f.hints, (h, hint) => hint.length > 3 && h.includes(hint) && !(avoid && avoid.test(h)));
    }
    if (f.key === 'lastName' && (firstIdx < 0 || map.name !== firstIdx)) idx = -1;
    if (idx >= 0) used.add(idx);
    map[f.key] = idx;
  }
  return map;
}

// Some exports, LinkedIn's among them, start with a few lines of notes
// before the column names. The heading row is the first of the opening rows
// made of short cells that include a name column. Falls back to row 0.
export function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const cells = rows[i].map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2 || cells.some((c) => c.length > 60)) continue;
    if (guessMapping(rows[i]).name >= 0) return i;
  }
  return 0;
}

// Google Contacts writes groups as "Clients ::: * myContacts". Groups that
// start with * are Google's own (myContacts, starred), not the person's.
export function cleanTags(cell) {
  return String(cell || '')
    .split(/:::|[,;]/)
    .map((t) => t.trim())
    .filter((t) => t && !t.startsWith('*'))
    .join(', ');
}
