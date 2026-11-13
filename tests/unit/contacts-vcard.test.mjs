import { describe, it, expect } from 'vitest';
import { parseVCards } from '../../js/contacts.js';

const BLANK = {
  name: '',
  email: '',
  phone: '',
  role: '',
  org: '',
  website: '',
  instagram: '',
  notes: '',
  tags: [],
  birthday: null,
};
const C = (fields) => ({ ...BLANK, ...fields });

const card = (...lines) => ['BEGIN:VCARD', 'VERSION:3.0', ...lines, 'END:VCARD'].join('\r\n');
function one(...lines) {
  const out = parseVCards(card(...lines));
  expect(out).toHaveLength(1);
  return out[0];
}

describe('parseVCards: whole exports', () => {
  it('reads an iPhone-style vCard 3.0 card', () => {
    const text = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'PRODID:-//Apple Inc.//iPhone OS 17.0//EN',
      'N:Person;Test;;;',
      'FN:Test Person',
      'ORG:Test Studio;',
      'TITLE:Casting Director',
      'item1.EMAIL;type=INTERNET;type=pref:test.person@example.com',
      'EMAIL;type=INTERNET;type=HOME:home@example.com',
      'TEL;type=WORK;type=VOICE:555-010-0001',
      'item2.TEL;type=CELL;type=VOICE;type=pref:+1 (555) 010-0000',
      'item3.URL;type=pref:https://teststudio.example.com',
      'item3.X-ABLabel:_$!<HomePage>!$_',
      'X-SOCIALPROFILE;type=instagram;x-user=testperson:x-apple:testperson',
      'NOTE:Met at the test screening.\\nLikes film.',
      'BDAY;X-APPLE-OMIT-YEAR=1604:1604-03-14',
      'CATEGORIES:Clients,Test Group',
      'PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRgABAQAAAQABAAD',
      ' AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
      'END:VCARD',
      '',
    ].join('\r\n');
    expect(parseVCards(text)).toEqual([
      C({
        name: 'Test Person',
        email: 'test.person@example.com',
        phone: '+1 (555) 010-0000',
        role: 'Casting Director',
        org: 'Test Studio',
        website: 'https://teststudio.example.com',
        instagram: 'testperson',
        notes: 'Met at the test screening.\nLikes film.',
        birthday: { month: 3, day: 14, year: null },
        tags: ['Clients', 'Test Group'],
      }),
    ]);
  });

  it('reads an Android-style vCard 2.1 card with quoted-printable values', () => {
    const text = [
      'BEGIN:VCARD',
      'VERSION:2.1',
      'N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:P=C3=A9rez;Test;;;',
      'TEL;HOME:555-010-0003',
      'TEL;CELL:555-010-0002',
      'EMAIL;HOME:test.perez@example.com',
      'NOTE;ENCODING=QUOTED-PRINTABLE:Line one=0D=0ALine two is long =',
      'and carries on',
      'END:VCARD',
    ].join('\n');
    expect(parseVCards(text)).toEqual([
      C({
        name: 'Test Pérez',
        email: 'test.perez@example.com',
        phone: '555-010-0002',
        notes: 'Line one\r\nLine two is long and carries on',
      }),
    ]);
  });

  it('reads several cards in order', () => {
    const text = [card('FN:First Test'), card('FN:Second Test'), card('FN:Third Test')].join('\r\n');
    expect(parseVCards(text).map((c) => c.name)).toEqual(['First Test', 'Second Test', 'Third Test']);
  });

  it('returns an empty list for empty or non-vCard text', () => {
    expect(parseVCards('')).toEqual([]);
    expect(parseVCards('just some notes\nwith: a colon')).toEqual([]);
    expect(parseVCards('BEGIN:VCARDX\nFN:Not A Card\nEND:VCARD')).toEqual([]);
  });
});

describe('parseVCards: line handling', () => {
  it('accepts lower-case markers, trailing spaces, a byte-order mark and bare CR line ends', () => {
    expect(parseVCards('﻿BEGIN:VCARD\rFN:Test Person\rEND:VCARD\r')).toEqual([C({ name: 'Test Person' })]);
    expect(parseVCards('begin:vcard  \nfn:Test Person\nend:vcard \n')).toEqual([C({ name: 'Test Person' })]);
  });

  it('joins lines folded with a space or a tab, with CRLF, LF or CR line ends', () => {
    for (const nl of ['\r\n', '\n', '\r']) {
      const text = ['BEGIN:VCARD', 'FN:Test', '  Person', 'EMAIL:test.per', '\tson@example.com', 'END:VCARD'].join(nl);
      expect(parseVCards(text)).toEqual([C({ name: 'Test Person', email: 'test.person@example.com' })]);
    }
  });

  it('removes only a leading byte-order mark', () => {
    expect(one('FN:Test Person', 'NOTE:a﻿b').notes).toBe('a﻿b');
  });

  it('does not start or end a card on BEGIN or END text inside a value', () => {
    expect(one('FN:Test Person', 'NOTE:BEGIN:VCARD', 'TITLE:Producer')).toEqual(
      C({ name: 'Test Person', notes: 'BEGIN:VCARD', role: 'Producer' })
    );
    expect(one('FN:Test Person', 'NOTE:END:VCARD', 'TITLE:Producer')).toEqual(
      C({ name: 'Test Person', notes: 'END:VCARD', role: 'Producer' })
    );
    expect(one('FN:Test Person', 'END:VCARDX', 'TITLE:Producer')).toEqual(C({ name: 'Test Person', role: 'Producer' }));
  });

  it('ignores lines outside cards and lines without a colon', () => {
    const text = ['FN:Outside Test', 'BEGIN:VCARD', 'no colon here', 'FN:Inside Test', 'END:VCARD', 'TEL:555-010-0009'].join('\n');
    expect(parseVCards(text)).toEqual([C({ name: 'Inside Test' })]);
  });

  it('copes with an END before any BEGIN, a missing END, and a restarted card', () => {
    expect(parseVCards('END:VCARD\nFN:Stray')).toEqual([]);
    expect(parseVCards('BEGIN:VCARD\nFN:Never Closed')).toEqual([]);
    const text = ['BEGIN:VCARD', 'FN:Lost Test', 'TEL:555-010-0004', 'BEGIN:VCARD', 'FN:Kept Test', 'END:VCARD'].join('\n');
    expect(parseVCards(text)).toEqual([C({ name: 'Kept Test' })]);
  });

  it('reads grouped and lower-case property names', () => {
    expect(one('item1.fn:Test Person', 'item2.email;type=internet:test@example.com')).toEqual(
      C({ name: 'Test Person', email: 'test@example.com' })
    );
  });

  it('keeps colons inside quoted parameters out of the value', () => {
    expect(one('FN:Test Person', 'EMAIL;X-LABEL="Work: main";TYPE=work:test@example.com').email).toBe('test@example.com');
  });

  it('keeps quotes and colons inside values', () => {
    expect(one('FN:Test Person', 'NOTE:She said "hi: there" twice').notes).toBe('She said "hi: there" twice');
  });

  it('unescapes text values and trims them', () => {
    expect(one('FN:Test Person', 'NOTE:  One\\nTwo\\NThree\\, four\\; five\\\\six  ').notes).toBe(
      'One\nTwo\nThree, four; five\\six'
    );
  });

  it('keeps a trailing lone backslash as it is', () => {
    expect(one('FN:Test Person', 'NOTE:Ends with a backslash\\').notes).toBe('Ends with a backslash\\');
  });

  it('skips empty values', () => {
    expect(one('FN:Test Person', 'EMAIL;TYPE=pref:   ', 'EMAIL:', 'EMAIL:real@example.com', 'NOTE:')).toEqual(
      C({ name: 'Test Person', email: 'real@example.com' })
    );
  });
});

describe('parseVCards: quoted-printable', () => {
  it('decodes lower-case hex and lower-case parameters', () => {
    expect(one('fn;charset=utf-8;encoding=quoted-printable:Caf=c3=a9 Test').name).toBe('Café Test');
  });

  it('leaves "=" alone when no two hex digits follow', () => {
    expect(one('FN:Test Person', 'NOTE;ENCODING=QUOTED-PRINTABLE:50=ZZ off =4').notes).toBe('50=ZZ off =4');
  });

  it('keeps raw non-ASCII characters in a quoted-printable value', () => {
    expect(one('NOTE;ENCODING=QUOTED-PRINTABLE:x', 'FN;ENCODING=QUOTED-PRINTABLE:Café=20Test').name).toBe('Café Test');
  });

  it('joins several soft line breaks', () => {
    const text = ['BEGIN:VCARD', 'FN:Test Person', 'NOTE;ENCODING=QUOTED-PRINTABLE:a=', 'b=', 'c', 'END:VCARD'].join('\n');
    expect(parseVCards(text)[0].notes).toBe('abc');
  });

  it('only joins lines for quoted-printable properties', () => {
    const c = one('FN:Test Person', 'NOTE:ENCODING=QUOTED-PRINTABLE ends with=', 'TITLE:Producer');
    expect(c.notes).toBe('ENCODING=QUOTED-PRINTABLE ends with=');
    expect(c.role).toBe('Producer');
  });

  it('does not decode values that are not quoted-printable', () => {
    expect(one('FN:Test Person', 'NOTE;ENCODING=b:A=42C').notes).toBe('A=42C');
  });
});

describe('parseVCards: names', () => {
  it('prefers FN over N, ORG and email', () => {
    expect(one('N:Other;Name;;;', 'FN:Test Person', 'ORG:Test Studio', 'EMAIL:test@example.com').name).toBe('Test Person');
  });

  it('builds the name from N in prefix, given, middle, family, suffix order', () => {
    expect(one('N:Person;Test;Middle;Dr.;Jr.').name).toBe('Dr. Test Middle Person Jr.');
    expect(one('N:Person;Test;;;').name).toBe('Test Person');
    expect(one('N:;Test;;;').name).toBe('Test');
    expect(one('N:Person').name).toBe('Person');
    expect(one('N:O\\,Test;Ann;;;').name).toBe('Ann O,Test');
  });

  it('falls back to N when FN is blank', () => {
    expect(one('FN:  ', 'N:Person;Test;;;').name).toBe('Test Person');
  });

  it('uses the organization as the name when there is no person name, and then leaves org empty', () => {
    expect(one('ORG:Test Studio;Lighting').name).toBe('Test Studio');
    expect(one('ORG:Test Studio;Lighting').org).toBe('');
    expect(one('ORG:Test\\; Studio;Lighting').name).toBe('Test; Studio');
  });

  it('keeps the organization when it differs from the name, and drops it when the same', () => {
    expect(one('FN:Test Person', 'ORG:Test Studio').org).toBe('Test Studio');
    expect(one('FN:Test Studio', 'ORG:Test Studio').org).toBe('');
  });

  it('uses the email as the name as a last resort', () => {
    expect(one('EMAIL:test@example.com')).toEqual(C({ name: 'test@example.com', email: 'test@example.com' }));
  });

  it('skips cards with nothing to call them by', () => {
    expect(parseVCards(card('TEL:555-010-0005', 'NOTE:No name here'))).toEqual([]);
    expect(parseVCards(card('N:;;;;'))).toEqual([]);
  });
});

describe('parseVCards: email and phone choice', () => {
  const email = (...lines) => one('FN:Test Person', ...lines).email;
  const phone = (...lines) => one('FN:Test Person', ...lines).phone;

  it('prefers the preferred email, then work, then the first', () => {
    expect(email('EMAIL;TYPE=home:a@example.com', 'EMAIL;TYPE=work:b@example.com')).toBe('b@example.com');
    expect(email('EMAIL;TYPE=work:a@example.com', 'EMAIL;TYPE=home,pref:b@example.com')).toBe('b@example.com');
    expect(email('EMAIL;TYPE=home:a@example.com', 'EMAIL;PREF=1:b@example.com')).toBe('b@example.com');
    expect(email('EMAIL;WORK:a@example.com', 'EMAIL;HOME;PREF:b@example.com')).toBe('b@example.com');
    expect(email('EMAIL;TYPE=home:a@example.com', 'EMAIL;TYPE=other:b@example.com')).toBe('a@example.com');
    expect(email('EMAIL;TYPE=home:a@example.com', 'EMAIL;TYPE="home,work":b@example.com')).toBe('b@example.com');
  });

  it('ignores a parameter with no name', () => {
    expect(email('EMAIL;TYPE=home:a@example.com', 'EMAIL;=work:b@example.com')).toBe('a@example.com');
  });

  it('reads type lists with spaces and empty entries', () => {
    expect(email('EMAIL;TYPE=home:a@example.com', 'EMAIL;TYPE= , work ,:b@example.com')).toBe('b@example.com');
    expect(email('EMAIL;TYPE=:a@example.com', 'EMAIL;TYPE=work:b@example.com')).toBe('b@example.com');
  });

  it('prefers the preferred phone, then cell, mobile, iPhone, work, then the first', () => {
    expect(phone('TEL;TYPE=home:1', 'TEL;TYPE=fax:2')).toBe('1');
    expect(phone('TEL;TYPE=home:1', 'TEL;TYPE=work:2')).toBe('2');
    expect(phone('TEL;TYPE=home:1', 'TEL;TYPE=work:2', 'TEL;TYPE=iphone:3')).toBe('3');
    expect(phone('TEL;TYPE=home:1', 'TEL;TYPE=iphone:2', 'TEL;TYPE=mobile:3')).toBe('3');
    expect(phone('TEL;TYPE=home:1', 'TEL;TYPE=mobile:2', 'TEL;TYPE=cell:3')).toBe('3');
    expect(phone('TEL;TYPE=cell:1', 'TEL;TYPE=home;TYPE=pref:2')).toBe('2');
    expect(phone('TEL;TYPE=cell:1', 'TEL;PREF=1:2')).toBe('2');
  });

  it('leaves email and phone empty when there are none', () => {
    expect(one('FN:Test Person')).toEqual(C({ name: 'Test Person' }));
  });

  it('drops the tel: prefix from vCard 4 phone links', () => {
    expect(phone('TEL;VALUE=uri;TYPE="voice,cell":tel:+1-555-010-0004')).toBe('+1-555-010-0004');
    expect(phone('TEL:TEL:555-010-0006')).toBe('555-010-0006');
    expect(phone('TEL;TYPE=work:555-010-0007 hotel:front desk')).toBe('555-010-0007 hotel:front desk');
  });
});

describe('parseVCards: role, website, Instagram, notes', () => {
  it('reads the role from TITLE, or ROLE when there is no title', () => {
    expect(one('FN:Test Person', 'ROLE:Booker', 'TITLE:Producer').role).toBe('Producer');
    expect(one('FN:Test Person', 'ROLE:Booker').role).toBe('Booker');
  });

  it('skips social links when picking the website', () => {
    const c = one(
      'FN:Test Person',
      'URL:https://www.facebook.com/testperson',
      'URL:https://twitter.com/testperson',
      'URL:https://x.com/testperson',
      'URL:https://www.instagram.com/testperson',
      'URL:https://test.example.com/portfolio\\,new'
    );
    expect(c.website).toBe('https://test.example.com/portfolio,new');
    expect(c.instagram).toBe('testperson');
  });

  it('keeps a website whose domain merely ends in x', () => {
    expect(one('FN:Test Person', 'URL:https://www.testbox.com/portfolio').website).toBe('https://www.testbox.com/portfolio');
  });

  it('has no website when every link is social', () => {
    expect(one('FN:Test Person', 'URL:https://www.facebook.com/testperson').website).toBe('');
  });

  it('reads the Instagram handle from the profile user name, dropping an @', () => {
    expect(one('FN:Test Person', 'X-SOCIALPROFILE;type=instagram;x-user=@Test.Person:x-apple:Test.Person').instagram).toBe(
      'test.person'
    );
  });

  it('skips blank entries in the user name list', () => {
    expect(one('FN:Test Person', 'X-SOCIALPROFILE;type=instagram;x-user=",fromuser":x-apple:fromvalue').instagram).toBe('fromuser');
  });

  it('only strips a leading x-apple: and @ from a handle', () => {
    const insta = (line) => one('FN:Test Person', line).instagram;
    expect(insta('X-SOCIALPROFILE;type=instagram;x-user=test@handle:x-apple:other')).toBe('test@handle');
    expect(insta('X-SOCIALPROFILE;type=instagram:X-APPLE:test@handle')).toBe('test@handle');
    expect(insta('X-SOCIALPROFILE;type=instagram:test-x-apple:handle')).toBe('test-x-apple:handle');
  });

  it('reads the Instagram handle from a profile link or a bare value', () => {
    const insta = (line) => one('FN:Test Person', line).instagram;
    expect(insta('X-SOCIALPROFILE;type=instagram:https://www.instagram.com/test_person/?hl=en')).toBe('test_person');
    expect(insta('X-SOCIALPROFILE;type=instagram:http://INSTAGRAM.com/testperson#top')).toBe('testperson');
    expect(insta('X-SOCIALPROFILE;type=instagram:X-APPLE:@testperson')).toBe('testperson');
    expect(insta('X-SOCIALPROFILE;type=instagram:testperson  ')).toBe('testperson');
    expect(insta('X-SOCIALPROFILE;type=other:https://instagram.com/socialperson')).toBe('socialperson');
  });

  it('prefers an Instagram-typed profile, then any Instagram link, profiles before URLs', () => {
    expect(
      one(
        'FN:Test Person',
        'URL:https://instagram.com/fromurl',
        'X-SOCIALPROFILE;type=instagram;x-user=fromsocial:x-apple:fromsocial'
      ).instagram
    ).toBe('fromsocial');
    expect(one('FN:Test Person', 'URL:https://instagram.com/fromurl', 'X-SOCIALPROFILE;type=other:https://instagram.com/fromprofile').instagram).toBe(
      'fromprofile'
    );
  });

  it('does not take a preferred non-Instagram profile as Instagram', () => {
    expect(one('FN:Test Person', 'X-SOCIALPROFILE;TYPE=twitter;PREF=1:https://twitter.com/testperson').instagram).toBe('');
  });

  it('reads tags from every CATEGORIES line, leaving out Google groups and blanks', () => {
    const c = one(
      'FN:Test Person',
      'CATEGORIES:myContacts,starred,Test Clients',
      'CATEGORIES:Photo\\, Video,,* starred,STARRED, Starred list,MyContacts,Not starred'
    );
    expect(c.tags).toEqual(['Test Clients', 'Photo, Video', 'Starred list', 'Not starred']);
  });
});

describe('parseVCards: birthdays', () => {
  const bday = (line) => one('FN:Test Person', line).birthday;

  it('reads full dates in both forms', () => {
    expect(bday('BDAY:1990-03-14')).toEqual({ month: 3, day: 14, year: 1990 });
    expect(bday('BDAY:19901231')).toEqual({ month: 12, day: 31, year: 1990 });
    expect(bday('BDAY: 2000-01-01T00:00:00Z ')).toEqual({ month: 1, day: 1, year: 2000 });
  });

  it('reads dates with no year', () => {
    expect(bday('BDAY:--03-14')).toEqual({ month: 3, day: 14, year: null });
    expect(bday('BDAY:--0314')).toEqual({ month: 3, day: 14, year: null });
    expect(bday('BDAY:1604-03-14')).toEqual({ month: 3, day: 14, year: null });
    expect(bday('BDAY;X-APPLE-OMIT-YEAR=1604:2000-03-14')).toEqual({ month: 3, day: 14, year: null });
  });

  it('rejects impossible months and days', () => {
    expect(bday('BDAY:1990-00-14')).toBeNull();
    expect(bday('BDAY:1990-13-14')).toBeNull();
    expect(bday('BDAY:1990-03-00')).toBeNull();
    expect(bday('BDAY:1990-03-32')).toBeNull();
    expect(bday('BDAY:1990-01-31')).toEqual({ month: 1, day: 31, year: 1990 });
  });

  it('returns null for missing or unreadable birthdays', () => {
    expect(one('FN:Test Person').birthday).toBeNull();
    expect(bday('BDAY:March 14')).toBeNull();
    expect(bday('BDAY:90-03-14')).toBeNull();
    expect(bday('BDAY:x1990-03-14')).toBeNull();
  });
});
