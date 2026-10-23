// Fixed lists the data model uses: stored keys plus the words shown for them.

export const TOUCH_TYPES = [
  { key: 'email', label: 'Email' },
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
