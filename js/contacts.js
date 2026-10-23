// Reading people from the phone's address book, two ways:
// - the Contact Picker, where the browser offers it (Chrome on Android; on
//   iPhone it is hidden behind a Safari developer setting),
// - vCard (.vcf) files, which the iPhone Contacts app, Google Contacts and
//   Outlook all export.
// Both hand back the same plain contact objects for the chooser.

function contact(fields) {
  return { name: '', email: '', phone: '', role: '', org: '', website: '', instagram: '', notes: '', tags: [], ...fields };
}

export function canPickContacts() {
  return 'contacts' in navigator && 'ContactsManager' in window && typeof navigator.contacts.select === 'function';
}

// Opens the phone's own contact list. Must run straight from a tap.
export async function pickContacts() {
  let props = ['name', 'email', 'tel'];
  try {
    const available = await navigator.contacts.getProperties();
    props = props.filter((p) => available.includes(p));
  } catch {
    /* older browsers: ask for the usual three */
  }
  const picked = await navigator.contacts.select(props, { multiple: true });
  const first = (list) => ((list || []).find((v) => v && String(v).trim()) || '').trim();
  return picked
    .map((c) => {
      const email = first(c.email);
      const phone = first(c.tel);
      return contact({ name: first(c.name) || email || phone, email, phone });
    })
    .filter((c) => c.name);
}

// ---------- vCard ----------

// Splits on `sep` outside double quotes and not escaped with a backslash.
function splitOutside(s, sep) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && i + 1 < s.length) {
      cur += ch + s[++i];
    } else if (ch === '"') {
      quoted = !quoted;
      cur += ch;
    } else if (ch === sep && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function unescapeText(s) {
  return s.replace(/\\([nN,;\\])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c)).trim();
}

function decodeQuotedPrintable(s) {
  const bytes = [];
  const enc = new TextEncoder();
  for (let i = 0; i < s.length; i++) {
    const hex = s.slice(i + 1, i + 3);
    if (s[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else bytes.push(...enc.encode(s[i]));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

// Joins folded lines: a line starting with a space or tab continues the one
// before (vCard 3 and 4), and older quoted-printable values end a line with
// "=" when they carry on (vCard 2.1, common in Android exports).
function unfold(text) {
  const raw = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  const lines = [];
  for (let i = 0; i < raw.length; i++) {
    let line = raw[i];
    if (/^[ \t]/.test(line) && lines.length) {
      lines[lines.length - 1] += line.slice(1);
      continue;
    }
    if (/ENCODING=QUOTED-PRINTABLE/i.test(line.split(':')[0])) {
      while (line.endsWith('=') && i + 1 < raw.length) line = line.slice(0, -1) + raw[++i];
    }
    lines.push(line);
  }
  return lines;
}

// "item1.EMAIL;type=INTERNET;type=pref:rosa@example.com"
// -> { name: 'EMAIL', params: { TYPE: ['internet', 'pref'] }, value }
function parseLine(line) {
  const parts = splitOutside(line, ':');
  const head = parts.shift();
  let value = parts.join(':');
  const [nameWithGroup, ...rawParams] = splitOutside(head, ';');
  const params = {};
  for (const p of rawParams) {
    const eq = p.indexOf('=');
    const key = eq < 0 ? 'TYPE' : p.slice(0, eq).toUpperCase();
    const vals = (eq < 0 ? p : p.slice(eq + 1)).replace(/"/g, '').toLowerCase().split(',');
    (params[key] = params[key] || []).push(...vals.map((v) => v.trim()).filter(Boolean));
  }
  if ((params.ENCODING || []).includes('quoted-printable')) value = decodeQuotedPrintable(value);
  return { name: nameWithGroup.split('.').pop().toUpperCase(), params, value };
}

const hasType = (p, ...types) =>
  (p.params.TYPE || []).some((t) => types.includes(t)) || ('PREF' in p.params && types.includes('pref'));

function preferred(list, ...order) {
  for (const t of order) {
    const hit = list.find((p) => hasType(p, t));
    if (hit) return hit;
  }
  return list[0];
}

function instagramHandle(p) {
  const user = (p.params['X-USER'] || [])[0];
  if (user) return user.replace(/^@/, '');
  const url = p.value.match(/instagram\.com\/([^/?#\s]+)/i);
  if (url) return url[1];
  return p.value.replace(/^x-apple:/i, '').replace(/^@/, '').trim();
}

function toContact(props) {
  const all = (name) => props.filter((p) => p.name === name && p.value.trim());
  const text = (name) => {
    const p = all(name)[0];
    return p ? unescapeText(p.value) : '';
  };

  const n = all('N')[0];
  const nParts = n ? splitOutside(n.value, ';').map(unescapeText) : [];
  const fromN = [nParts[3], nParts[1], nParts[2], nParts[0], nParts[4]].filter(Boolean).join(' ');
  const org = all('ORG')[0] ? unescapeText(splitOutside(all('ORG')[0].value, ';')[0]) : '';

  const emailProp = preferred(all('EMAIL'), 'pref', 'work');
  const telProp = preferred(all('TEL'), 'pref', 'cell', 'mobile', 'iphone', 'work');

  const socials = all('X-SOCIALPROFILE');
  const urls = all('URL');
  const insta =
    socials.find((p) => hasType(p, 'instagram')) ||
    [...socials, ...urls].find((p) => /instagram\.com/i.test(p.value));
  const website = urls.find((p) => !/instagram\.com|facebook\.com|twitter\.com|x\.com\//i.test(p.value));

  const email = emailProp ? unescapeText(emailProp.value) : '';
  const name = text('FN') || fromN || org || email;
  if (!name) return null;
  return contact({
    name,
    email,
    phone: telProp ? unescapeText(telProp.value) : '',
    role: text('TITLE') || text('ROLE'),
    org: org && org !== name ? org : '',
    website: website ? unescapeText(website.value) : '',
    instagram: insta ? instagramHandle(insta) : '',
    notes: text('NOTE'),
    // Google adds its own groups (myContacts, starred) to every card.
    tags: all('CATEGORIES')
      .flatMap((p) => splitOutside(p.value, ',').map(unescapeText))
      .filter((t) => t && !/^\*?\s*(mycontacts|starred)$/i.test(t)),
  });
}

const SKIP = new Set(['PHOTO', 'LOGO', 'SOUND', 'KEY']);

export function parseVCards(text) {
  const out = [];
  let props = null;
  for (const line of unfold(text)) {
    if (/^BEGIN:VCARD\s*$/i.test(line)) props = [];
    else if (/^END:VCARD\s*$/i.test(line)) {
      const c = props && toContact(props);
      if (c) out.push(c);
      props = null;
    } else if (props && line.includes(':')) {
      const p = parseLine(line);
      if (!SKIP.has(p.name)) props.push(p);
    }
  }
  return out;
}
