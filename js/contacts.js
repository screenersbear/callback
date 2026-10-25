// Reading people from the phone's address book, two ways:
// - the Contact Picker, where the browser offers it (Chrome on Android; on
//   iPhone it is hidden behind a Safari developer setting),
// - vCard (.vcf) files, which the iPhone Contacts app, Google Contacts and
//   Outlook all export.
// Both hand back the same plain contact objects for the chooser.

function contact(fields) {
  return { name: '', email: '', phone: '', role: '', org: '', website: '', instagram: '', notes: '', tags: [], birthday: null, ...fields };
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
    birthday: parseBirthday(all('BDAY')[0]),
    // Google adds its own groups (myContacts, starred) to every card.
    tags: all('CATEGORIES')
      .flatMap((p) => splitOutside(p.value, ',').map(unescapeText))
      .filter((t) => t && !/^\*?\s*(mycontacts|starred)$/i.test(t)),
  });
}

// BDAY as 1990-03-14, 19900314 or --03-14. iPhone writes an unknown year as
// 1604, so that reads as no year.
function parseBirthday(prop) {
  if (!prop) return null;
  const m = prop.value.trim().match(/^(\d{4}|--)-?(\d{2})-?(\d{2})/);
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const year = m[1] === '--' || m[1] === '1604' || 'X-APPLE-OMIT-YEAR' in prop.params ? null : Number(m[1]);
  return { month, day, year };
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

// ---------- Pasted text ----------
// Pulls contact details out of whatever someone pastes: an email signature,
// a copied contact card, a From: line, text from a website or a DM.
// Best effort: the form shows the result so the person can fix it.

const EMAIL_RE = /[A-Z0-9._%+'-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/i;
const PHONE_RE = /\+?\(?\d[\d\s().-]{5,}\d/g;
// Bare domains only count with a familiar ending, so "J.Crew" or "e.g."
// never become a website; with http or www anything goes.
const URL_SRC =
  '\\b(?:https?:\\/\\/[^\\s|,;<>]+|www\\.[^\\s|,;<>]+|[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.' +
  '(?:com|net|org|co|io|me|tv|uk|us|ca|au|de|fr|it|es|nl|nyc|la|studio|photo|photography|art|agency|film|media|design|gallery|info|biz|page|site|app|xyz|world)' +
  '(?:\\/[^\\s|,;<>]*)?)';
const findUrls = (s) => s.match(new RegExp(URL_SRC, 'gi')) || [];
const hasUrl = (s) => new RegExp(URL_SRC, 'i').test(s);
const SOCIAL_RE = /instagram\.com|facebook\.com|twitter\.com|x\.com\/|tiktok\.com|threads\.net|linkedin\.com/i;
const SIGN_OFF_RE = /^(best( regards| wishes)?|kind regards|warm(est)? regards|regards|warmly|thanks( so much)?|thank you|many thanks|cheers|sincerely|all the best|talk soon|speak soon|xo+|x+|-{2,}|_{2,}|sent from my .*|get outlook for .*|hi|hello|hey|dear .*)[\s,.!]*$/i;
const ROLE_RE = /\b(director|casting|booker|booking|agent|manager|producer|editor|editorial|marketer|marketing|brand|coordinator|assistant|associate|head|lead|founder|co-?founder|partner|president|vp|chief|officer|executive|photographer|buyer|creative|designer|talent|actor|actress|model|owner|ceo|cmo|coo|specialist|supervisor|strategist|curator|writer|journalist|publicist|stylist|scout|intern)\b/i;
// Role words that also end company names, as in "Jane Doe Casting".
const WEAK_ROLE_RE = /\b(casting|creative|talent|brand|booking|editorial)\b/gi;
const COMPANY_RE = /\b(inc|llc|ltd|limited|corp|corporation|gmbh|studios?|models|management|mgmt|agency|pictures|productions|films?|media|group|magazine|records|entertainment|partners|collective|casting|creative)\.?$/i;
// " | ", " \u00b7 ", " - " (and en or em dash), " at ", ", " between a role and a company.
const PART_SPLIT = /\s+[|\u00b7\u2022/]\s+|\s+[-\u2013\u2014]\s+|\s+at\s+|\s+@\s+|,\s+/i;

const strongRole = (s) => ROLE_RE.test(s.replace(WEAK_ROLE_RE, ''));

function isRole(part) {
  if (!ROLE_RE.test(part)) return false;
  return !COMPANY_RE.test(part) || strongRole(part.replace(COMPANY_RE, ''));
}

function titleCase(s) {
  return s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
}

function looksLikeName(line) {
  if (line.length > 40 || /[\d@:/|]/.test(line) || SIGN_OFF_RE.test(line)) return false;
  const words = line.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  if (!words.every((w) => /^\p{Lu}[\p{L}'\u2019.-]*$/u.test(w))) return false;
  return !strongRole(line) && !COMPANY_RE.test(line);
}

export function parsePasted(input) {
  const text = String(input || '').replace(/\r\n?/g, '\n');
  if (/BEGIN:VCARD/i.test(text)) return parseVCards(text)[0] || contact({});

  const lines = text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const out = { name: '', email: '', phone: '', role: '', org: '', website: '', instagram: '' };

  // Labelled lines first: "Name: ...", "Title: ...", "Company: ...".
  const label = (words) => {
    const re = new RegExp(`^(?:${words})\\s*[:\\-]\\s*(.+)$`, 'i');
    for (const l of lines) {
      const m = l.match(re);
      if (m) return m[1].trim();
    }
    return '';
  };
  out.name = label('name|full name|contact');
  out.role = label('title|job title|position|role');
  out.org = label('company|organi[sz]ation|agency|employer|studio');
  out.instagram = label('instagram|insta|ig').replace(/^@/, '').split(/\s/)[0];

  const emailMatch = text.match(EMAIL_RE);
  out.email = emailMatch ? emailMatch[0] : '';

  // "Rosa Lind <rosa@fordmodels.com>", as in a From: line.
  if (!out.name) {
    const from = text.match(/(?:^|\n)(?:from:\s*)?"?([^"<>\n@:]{3,40}?)"?\s*<[^>\n]+@[^>\n]+>/i);
    if (from) out.name = from[1].trim();
  }

  const noEmails = text.replace(new RegExp(EMAIL_RE.source, 'gi'), ' ');

  if (!out.instagram) {
    const m = noEmails.match(/instagram\.com\/([A-Za-z0-9._]{2,30})/i) || noEmails.match(/(?:^|[\s(|])@([A-Za-z0-9._]{2,30})\b/);
    if (m) out.instagram = m[1].replace(/\.$/, '');
  }

  const urls = findUrls(noEmails).map((u) => u.replace(/[.)\]]+$/, ''));
  out.website = urls.find((u) => !SOCIAL_RE.test(u)) || '';

  // Phones: one labelled mobile or cell wins, otherwise the first.
  const phones = [];
  for (const l of lines) {
    const clean = l.replace(new RegExp(EMAIL_RE.source, 'gi'), ' ').replace(new RegExp(URL_SRC, 'gi'), ' ');
    for (const m of clean.matchAll(PHONE_RE)) {
      const digits = m[0].replace(/\D/g, '');
      if (digits.length < 7 || digits.length > 15 || /^\d{4}-\d{2}-\d{2}$/.test(m[0].trim())) continue;
      phones.push({ value: m[0].trim(), mobile: /\b(m|mob|mobile|cell|c)\b\s*[:.]?/i.test(l) });
    }
  }
  out.phone = (phones.find((p) => p.mobile) || phones[0] || { value: '' }).value;

  // The name: the first line that reads like a person's name, or that starts
  // with one ("Nora Quinn, Executive Producer, Quinn Productions").
  let nameAt = -1;
  let sameLine = '';
  if (out.name) nameAt = lines.findIndex((l) => l.includes(out.name));
  else {
    for (let i = 0; i < lines.length && nameAt < 0; i++) {
      const [head, ...rest] = lines[i].split(PART_SPLIT).map((x) => x.trim());
      if (looksLikeName(lines[i])) out.name = lines[i];
      else if (rest.length && looksLikeName(head)) {
        out.name = head;
        sameLine = rest.join(' | ');
      } else continue;
      nameAt = i;
    }
  }
  if (out.name && out.name === out.name.toUpperCase() && out.name.length > 3) out.name = titleCase(out.name);

  // Role and company: the plain lines right after the name.
  if ((!out.role || !out.org) && nameAt >= 0) {
    const plain = sameLine ? [sameLine] : [];
    for (const l of lines.slice(nameAt + 1, nameAt + 5)) {
      if (EMAIL_RE.test(l) || /\d{3}/.test(l) || hasUrl(l) || /@|:/.test(l) || l.length > 60 || SIGN_OFF_RE.test(l)) continue;
      plain.push(l);
      if (plain.length === 2) break;
    }
    const parts = plain
      .flatMap((l) => l.split(PART_SPLIT))
      .map((p) => p.trim())
      .filter((p) => p && !/^(inc|llc|ltd|co)\.?$/i.test(p));
    const roles = parts.filter(isRole);
    const others = parts.filter((p) => !isRole(p));
    if (!out.role && roles.length) out.role = roles[0];
    if (!out.org && others.length) out.org = others.find((p) => COMPANY_RE.test(p)) || others[others.length - 1];
  }

  // Last resort for the name: "rosa.lind@..." reads as Rosa Lind.
  if (!out.name && out.email) {
    const m = out.email.split('@')[0].match(/^([a-z]{2,})[._]([a-z]{2,})$/i);
    if (m) out.name = titleCase(`${m[1]} ${m[2]}`);
  }

  return contact(out);
}
