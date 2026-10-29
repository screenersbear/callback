// Fixed lists the data model uses: stored keys plus the words shown for them.

export const TOUCH_TYPES = [
  { key: 'email', label: 'Email' },
  { key: 'text', label: 'Text message' },
  { key: 'dm', label: 'DM' },
  { key: 'call', label: 'Call' },
  { key: 'meeting', label: 'Meeting' },
  { key: 'sent_work', label: 'Sent work' },
  { key: 'comment', label: 'Comment on their work' },
  { key: 'gift', label: 'Gift or card' },
  { key: 'event', label: 'Event' },
  { key: 'other', label: 'Other' },
];

export function touchTypeLabel(key) {
  const t = TOUCH_TYPES.find((x) => x.key === key);
  return t ? t.label : key || 'Other';
}

export const RESPONDED = [
  { key: 'pending', label: 'Waiting' },
  { key: 'yes', label: 'Replied' },
  { key: 'no', label: 'No reply' },
];

export function respondedLabel(key) {
  const r = RESPONDED.find((x) => x.key === key);
  return r ? r.label : 'Waiting';
}

export const ROLE_SUGGESTIONS = [
  'Casting director',
  'Talent manager',
  'Agency booker',
  'Brand marketer',
  'Editor',
  'Producer',
  'Actor',
  'Client',
];

export const ORG_TYPES = [
  { key: 'agency', label: 'Agency' },
  { key: 'brand', label: 'Brand' },
  { key: 'production', label: 'Production company' },
  { key: 'publication', label: 'Publication' },
  { key: 'studio', label: 'Studio' },
  { key: 'other', label: 'Other' },
];

export function orgTypeLabel(key) {
  const t = ORG_TYPES.find((x) => x.key === key);
  return t ? t.label : 'Other';
}

export const NEWS_SUGGESTIONS = [
  'Show premieres',
  'Campaign launches',
  'New agency',
  'New job',
  'Book comes out',
  'Season wraps',
  'Birthday',
];

// "When should you first reach out?" when adding someone.
export const FIRST_CONTACT_OPTIONS = [
  { key: 'justMet', label: 'Just met', blurb: "Follow up while it's fresh." },
  { key: 'reachOutNow', label: 'Reach out now', blurb: "You found them and you're ready." },
  { key: 'pickDate', label: 'Pick a date', blurb: 'Choose the day of the first touchpoint.' },
  { key: 'someday', label: 'Someday', blurb: 'Not yet, but you want to remember them.' },
];
export const DEFAULT_FIRST_CONTACT = 'reachOutNow';

// Offered when starting a circle, to get going.
export const CIRCLE_SUGGESTIONS = ['Actors', 'Models', 'Stylists', 'Hair and makeup', 'Directors'];

// What a relationship is for, separate from how warm it is. Cadence never
// looks at this; it shapes the touchpoint ideas and helps filter.
export const RELATIONSHIP_TYPES = [
  { key: 'prospect', label: 'Prospect', blurb: 'Someone who could hire you.' },
  { key: 'pastClient', label: 'Past client', blurb: "Someone who's hired you. Stay in touch for the next job." },
  { key: 'collaborator', label: 'Collaborator', blurb: 'Someone you make work with: models, actors, artists.' },
  { key: 'industry', label: 'Industry', blurb: 'Someone who connects you to work: agents, bookers, editors, casting.' },
];

export const DEFAULT_RELATIONSHIP = 'prospect';

export function relationshipInfo(key) {
  return RELATIONSHIP_TYPES.find((r) => r.key === key) || RELATIONSHIP_TYPES[0];
}

// Someone can be several of these at once (a past client who's also a
// collaborator). `relationshipTypes` holds them in this list's order;
// `relationshipType` keeps the first, for older copies of the app.
export function relTypesOf(p) {
  const list = p && Array.isArray(p.relationshipTypes) && p.relationshipTypes.length
    ? p.relationshipTypes
    : [(p && p.relationshipType) || DEFAULT_RELATIONSHIP];
  const keys = RELATIONSHIP_TYPES.map((r) => r.key).filter((k) => list.includes(k));
  return keys.length ? keys : [DEFAULT_RELATIONSHIP];
}

export function relFields(types) {
  const list = relTypesOf({ relationshipTypes: types });
  return { relationshipTypes: list, relationshipType: list[0] };
}

// Open loops: small promises, either way.
export const LOOP_DIRECTIONS = [
  { key: 'iOwe', label: 'On your side', blurb: 'Something you promised.' },
  { key: 'theyOwe', label: 'On their side', blurb: "Something they promised, or you're waiting on." },
];

// How engaged someone seems. It shapes the touchpoint ideas; cadence never
// looks at it.
export const INTEREST_LEVELS = [
  { key: 'eager', label: 'Eager', blurb: 'Excited to work together.' },
  { key: 'open', label: 'Open', blurb: 'Interested if the timing works.' },
  { key: 'lukewarm', label: 'Lukewarm', blurb: 'Friendly but not leaning in.' },
  { key: 'unknown', label: 'Unknown', blurb: 'Not sure yet.' },
];

export const DEFAULT_INTEREST = 'unknown';

export function interestInfo(key) {
  return INTEREST_LEVELS.find((i) => i.key === key) || INTEREST_LEVELS[3];
}
