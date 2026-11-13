// Unit tests for js/model.js: the fixed lists (their stored keys must never
// change, since saved records use them) and the lookups over them.
import { describe, it, expect } from 'vitest';
import {
  TOUCH_TYPES, touchTypeLabel, RESPONDED, respondedLabel, ROLE_SUGGESTIONS, ORG_TYPES, orgTypeLabel,
  NEWS_SUGGESTIONS, FIRST_CONTACT_OPTIONS, DEFAULT_FIRST_CONTACT, CIRCLE_SUGGESTIONS, RELATIONSHIP_TYPES,
  DEFAULT_RELATIONSHIP, relationshipInfo, relTypesOf, relFields, LOOP_DIRECTIONS, INTEREST_LEVELS,
  DEFAULT_INTEREST, interestInfo,
} from '../../js/model.js';

const keysOf = (list) => list.map((x) => x.key);

describe('keyed lists', () => {
  it('every keyed list has unique keys and a label for each', () => {
    for (const list of [TOUCH_TYPES, RESPONDED, ORG_TYPES, FIRST_CONTACT_OPTIONS, RELATIONSHIP_TYPES, LOOP_DIRECTIONS, INTEREST_LEVELS]) {
      expect(new Set(keysOf(list)).size).toBe(list.length);
      for (const item of list) expect(item.label).toBeTruthy();
    }
  });

  it('TOUCH_TYPES keeps its keys and words', () => {
    expect(TOUCH_TYPES).toEqual([
      { key: 'idea', label: 'Idea' },
      { key: 'email', label: 'Email' },
      { key: 'text', label: 'Text message' },
      { key: 'dm', label: 'DM' },
      { key: 'call', label: 'Call' },
      { key: 'meeting', label: 'Meeting' },
      { key: 'sent_work', label: 'Sent work' },
      { key: 'comment', label: 'Comment on their work' },
      { key: 'followed', label: 'Followed' },
      { key: 'gift', label: 'Gift or card' },
      { key: 'event', label: 'Event' },
      { key: 'project_wrapped', label: 'Project wrapped' },
      { key: 'other', label: 'Other' },
    ]);
  });

  it('RESPONDED keeps its keys and words', () => {
    expect(RESPONDED).toEqual([
      { key: 'pending', label: 'Waiting' },
      { key: 'yes', label: 'Replied' },
      { key: 'no', label: 'No reply' },
    ]);
  });

  it('ORG_TYPES keeps its keys and words', () => {
    expect(ORG_TYPES).toEqual([
      { key: 'agency', label: 'Agency' },
      { key: 'brand', label: 'Brand' },
      { key: 'production', label: 'Production company' },
      { key: 'publication', label: 'Publication' },
      { key: 'studio', label: 'Studio' },
      { key: 'other', label: 'Other' },
    ]);
  });

  it('FIRST_CONTACT_OPTIONS keeps its keys, words and default', () => {
    expect(FIRST_CONTACT_OPTIONS).toEqual([
      { key: 'justMet', label: 'Just met', blurb: "Follow up while it's fresh." },
      { key: 'reachOutNow', label: 'Reach out now', blurb: "You found them and you're ready." },
      { key: 'alreadyDid', label: 'Already did', blurb: "You've reached out already. Log it once they're added." },
      { key: 'pickDate', label: 'Pick a date', blurb: 'Choose the day of the first touchpoint.' },
      { key: 'someday', label: 'Someday', blurb: 'Not yet, but you want to remember them.' },
    ]);
    expect(DEFAULT_FIRST_CONTACT).toBe('reachOutNow');
    expect(keysOf(FIRST_CONTACT_OPTIONS)).toContain(DEFAULT_FIRST_CONTACT);
  });

  it('RELATIONSHIP_TYPES keeps its keys, words and default', () => {
    expect(RELATIONSHIP_TYPES).toEqual([
      { key: 'prospect', label: 'Prospect', blurb: 'Someone who could hire you.' },
      { key: 'pastClient', label: 'Past client', blurb: "Someone who's hired you. Stay in touch for the next job." },
      { key: 'collaborator', label: 'Collaborator', blurb: 'Someone you make work with: models, actors, artists.' },
      { key: 'industry', label: 'Industry', blurb: 'Someone who connects you to work: agents, bookers, editors, casting.' },
      { key: 'other', label: 'Other', blurb: 'Anyone else you want to keep in touch with.' },
    ]);
    expect(DEFAULT_RELATIONSHIP).toBe('prospect');
  });

  it('LOOP_DIRECTIONS keeps its keys and words', () => {
    expect(LOOP_DIRECTIONS).toEqual([
      { key: 'iOwe', label: 'On your side', blurb: 'Something you promised.' },
      { key: 'theyOwe', label: 'On their side', blurb: "Something they promised, or you're waiting on." },
    ]);
  });

  it('INTEREST_LEVELS keeps its keys, words and default', () => {
    expect(INTEREST_LEVELS).toEqual([
      { key: 'eager', label: 'Eager', blurb: 'Excited to work together.' },
      { key: 'open', label: 'Open', blurb: 'Interested if the timing works.' },
      { key: 'lukewarm', label: 'Lukewarm', blurb: 'Friendly but not leaning in.' },
      { key: 'unknown', label: 'Unknown', blurb: 'Not sure yet.' },
    ]);
    expect(DEFAULT_INTEREST).toBe('unknown');
  });
});

describe('suggestion lists', () => {
  it('ROLE_SUGGESTIONS', () => {
    expect(ROLE_SUGGESTIONS).toEqual([
      'Casting director', 'Talent manager', 'Agency booker', 'Brand marketer', 'Editor', 'Producer', 'Actor', 'Client',
    ]);
  });

  it('NEWS_SUGGESTIONS', () => {
    expect(NEWS_SUGGESTIONS).toEqual([
      'Show premieres', 'Campaign launches', 'New agency', 'New job', 'Book comes out', 'Season wraps', 'Birthday',
    ]);
  });

  it('CIRCLE_SUGGESTIONS', () => {
    expect(CIRCLE_SUGGESTIONS).toEqual(['Actors', 'Models', 'Stylists', 'Hair and makeup', 'Directors']);
  });
});

describe('touchTypeLabel', () => {
  it('gives the words for each known type', () => {
    expect(touchTypeLabel('email')).toBe('Email');
    expect(touchTypeLabel('sent_work')).toBe('Sent work');
    expect(touchTypeLabel('project_wrapped')).toBe('Project wrapped');
    expect(touchTypeLabel('other')).toBe('Other');
    for (const t of TOUCH_TYPES) expect(touchTypeLabel(t.key)).toBe(t.label);
  });

  it('shows an unknown type as it was stored', () => {
    expect(touchTypeLabel('carrier_pigeon')).toBe('carrier_pigeon');
    expect(touchTypeLabel('Email')).toBe('Email');
  });

  it('says Other for a missing type', () => {
    expect(touchTypeLabel(undefined)).toBe('Other');
    expect(touchTypeLabel(null)).toBe('Other');
    expect(touchTypeLabel('')).toBe('Other');
  });
});

describe('respondedLabel', () => {
  it('gives the words for each answer', () => {
    expect(respondedLabel('pending')).toBe('Waiting');
    expect(respondedLabel('yes')).toBe('Replied');
    expect(respondedLabel('no')).toBe('No reply');
  });

  it('says Waiting for an unknown or missing answer', () => {
    expect(respondedLabel('maybe')).toBe('Waiting');
    expect(respondedLabel(undefined)).toBe('Waiting');
    expect(respondedLabel('')).toBe('Waiting');
  });

  it('is case-sensitive about stored keys', () => {
    expect(respondedLabel('YES')).toBe('Waiting');
  });
});

describe('orgTypeLabel', () => {
  it('gives the words for each known type', () => {
    expect(orgTypeLabel('agency')).toBe('Agency');
    expect(orgTypeLabel('production')).toBe('Production company');
    expect(orgTypeLabel('studio')).toBe('Studio');
  });

  it('says Other for an unknown type', () => {
    expect(orgTypeLabel('bakery')).toBe('Other');
  });

  it('says Other for a missing type', () => {
    expect(orgTypeLabel(undefined)).toBe('Other');
    expect(orgTypeLabel(null)).toBe('Other');
  });
});

describe('relationshipInfo', () => {
  it('finds a known type', () => {
    expect(relationshipInfo('pastClient')).toBe(RELATIONSHIP_TYPES[1]);
    expect(relationshipInfo('other').label).toBe('Other');
  });

  it('falls back to prospect for an unknown type', () => {
    expect(relationshipInfo('rival')).toBe(RELATIONSHIP_TYPES[0]);
    expect(relationshipInfo('rival').key).toBe('prospect');
  });

  it('falls back to prospect for a missing type', () => {
    expect(relationshipInfo(undefined).key).toBe('prospect');
    expect(relationshipInfo(null).key).toBe('prospect');
  });
});

describe('relTypesOf', () => {
  it('returns the stored list in the fixed order', () => {
    expect(relTypesOf({ relationshipTypes: ['collaborator', 'pastClient'] })).toEqual(['pastClient', 'collaborator']);
    expect(relTypesOf({ relationshipTypes: ['other', 'industry', 'prospect'] })).toEqual(['prospect', 'industry', 'other']);
  });

  it('prefers the list over the older single field', () => {
    expect(relTypesOf({ relationshipTypes: ['industry'], relationshipType: 'collaborator' })).toEqual(['industry']);
  });

  it('falls back to the older single field when there is no list', () => {
    expect(relTypesOf({ relationshipType: 'pastClient' })).toEqual(['pastClient']);
    expect(relTypesOf({ relationshipTypes: [], relationshipType: 'industry' })).toEqual(['industry']);
    expect(relTypesOf({ relationshipTypes: 'pastClient', relationshipType: 'industry' })).toEqual(['industry']);
  });

  it('defaults to prospect for nothing stored', () => {
    expect(relTypesOf({})).toEqual(['prospect']);
    expect(relTypesOf(undefined)).toEqual(['prospect']);
    expect(relTypesOf(null)).toEqual(['prospect']);
  });

  it('drops unknown keys and repeats', () => {
    expect(relTypesOf({ relationshipTypes: ['rival', 'other', 'other'] })).toEqual(['other']);
    expect(relTypesOf({ relationshipTypes: ['rival'] })).toEqual(['prospect']);
    expect(relTypesOf({ relationshipType: 'rival' })).toEqual(['prospect']);
  });
});

describe('relFields', () => {
  it('stores the list in order and its first type for older copies', () => {
    expect(relFields(['collaborator', 'pastClient'])).toEqual({ relationshipTypes: ['pastClient', 'collaborator'], relationshipType: 'pastClient' });
    expect(relFields(['industry'])).toEqual({ relationshipTypes: ['industry'], relationshipType: 'industry' });
  });

  it('defaults to prospect for an empty or missing list', () => {
    const prospect = { relationshipTypes: ['prospect'], relationshipType: 'prospect' };
    expect(relFields([])).toEqual(prospect);
    expect(relFields(undefined)).toEqual(prospect);
  });

  it('drops unknown keys', () => {
    expect(relFields(['rival', 'other'])).toEqual({ relationshipTypes: ['other'], relationshipType: 'other' });
    expect(relFields(['rival'])).toEqual({ relationshipTypes: ['prospect'], relationshipType: 'prospect' });
  });
});

describe('interestInfo', () => {
  it('finds a known level', () => {
    expect(interestInfo('eager')).toBe(INTEREST_LEVELS[0]);
    expect(interestInfo('lukewarm').label).toBe('Lukewarm');
  });

  it('falls back to Unknown for an unknown level', () => {
    expect(interestInfo('ecstatic')).toBe(INTEREST_LEVELS[3]);
    expect(interestInfo('ecstatic').key).toBe('unknown');
  });

  it('falls back to Unknown for a missing level', () => {
    expect(interestInfo(undefined).key).toBe('unknown');
    expect(interestInfo('').key).toBe('unknown');
  });
});
