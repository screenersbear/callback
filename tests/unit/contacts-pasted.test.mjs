import { describe, it, expect } from 'vitest';
import { parsePasted } from '../../js/contacts.js';

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
const lines = (...l) => l.join('\n');

describe('parsePasted: whole pastes', () => {
  it('reads an email signature', () => {
    const text = lines(
      'Best,',
      '',
      'Test Person',
      'Casting Director',
      'Test Casting Studio',
      'o: 555-010-0001',
      'm: +1 555 010 0000',
      'test.person@testcasting.com',
      'www.testcasting.com',
      '@testperson'
    );
    expect(parsePasted(text)).toEqual(
      C({
        name: 'Test Person',
        email: 'test.person@testcasting.com',
        phone: '+1 555 010 0000',
        role: 'Casting Director',
        org: 'Test Casting Studio',
        website: 'www.testcasting.com',
        instagram: 'testperson',
      })
    );
  });

  it('reads a labelled contact card', () => {
    const text = lines(
      'Name: Test Person',
      'Title: Producer',
      'Company: Test Films',
      'Instagram: @test.person (personal)',
      'Email: test@example.com',
      'Phone: 555 010 0005',
      'Notes: Assistant to the director'
    );
    expect(parsePasted(text)).toEqual(
      C({
        name: 'Test Person',
        email: 'test@example.com',
        phone: '555 010 0005',
        role: 'Producer',
        org: 'Test Films',
        instagram: 'test.person',
      })
    );
  });

  it('reads name, role and company from one line', () => {
    const p = parsePasted(lines('Nora Test, Executive Producer, Test Productions', 'nora@testproductions.com'));
    expect(p).toEqual(
      C({ name: 'Nora Test', role: 'Executive Producer', org: 'Test Productions', email: 'nora@testproductions.com' })
    );
  });

  it('handles Windows and old Mac line ends and messy spacing', () => {
    const want = C({ name: 'Test Person', role: 'Producer', org: 'Test Films' });
    expect(parsePasted('Test Person\r\nProducer\r\nTest Films')).toEqual(want);
    expect(parsePasted('Test Person\rProducer\rTest Films')).toEqual(want);
    expect(parsePasted('  Test    Person  \n\n\t Producer \n Test   Films ')).toEqual(want);
  });

  it('reads a pasted vCard as a card', () => {
    const text = 'Here you go:\r\nBEGIN:VCARD\r\nFN:Test Person\r\nTEL:555-010-0018\r\nEND:VCARD';
    expect(parsePasted(text)).toEqual(C({ name: 'Test Person', phone: '555-010-0018' }));
  });

  it('gives a blank contact for a vCard with nothing in it', () => {
    expect(parsePasted('begin:vcard\nend:vcard')).toEqual(BLANK);
  });

  it('gives a blank contact for empty or odd input', () => {
    expect(parsePasted('')).toEqual(BLANK);
    expect(parsePasted(null)).toEqual(BLANK);
    expect(parsePasted(undefined)).toEqual(BLANK);
    expect(parsePasted('   \n\n  \t ')).toEqual(BLANK);
    expect(parsePasted({})).toEqual(BLANK);
    expect(parsePasted(12345)).toEqual(BLANK);
  });

  it('reads a bare number as a phone', () => {
    expect(parsePasted(5550100123)).toEqual(C({ phone: '5550100123' }));
  });
});

describe('parsePasted: labels', () => {
  it('reads each kind of label, with a colon or a dash', () => {
    expect(parsePasted('Full name - Test Person').name).toBe('Test Person');
    expect(parsePasted('Contact:Test Person').name).toBe('Test Person');
    expect(parsePasted('NAME : Test Person').name).toBe('Test Person');
    expect(parsePasted('Job title: Agent').role).toBe('Agent');
    expect(parsePasted('Position - Booker').role).toBe('Booker');
    expect(parsePasted('Role: Scout').role).toBe('Scout');
    expect(parsePasted('Organisation: Test Agency').org).toBe('Test Agency');
    expect(parsePasted('Organization: Test Agency').org).toBe('Test Agency');
    expect(parsePasted('Agency: Test Models').org).toBe('Test Models');
    expect(parsePasted('Employer: Test Place').org).toBe('Test Place');
    expect(parsePasted('Studio: Test Studio').org).toBe('Test Studio');
    expect(parsePasted('Insta - testperson').instagram).toBe('testperson');
    expect(parsePasted('IG: @Test.Person extra words').instagram).toBe('Test.Person');
    expect(parsePasted('IG: test@handle').instagram).toBe('test@handle');
  });

  it('needs a separator after the label', () => {
    expect(parsePasted('name test person').name).toBe('');
    expect(parsePasted('Title Producer').role).toBe('');
    expect(parsePasted('Company Test Place').org).toBe('');
  });

  it('keeps labelled role and company over the lines after the name', () => {
    expect(parsePasted(lines('Title: Booker', 'Test Person', 'Producer', 'Test Films'))).toEqual(
      C({ name: 'Test Person', role: 'Booker', org: 'Test Films' })
    );
    expect(parsePasted(lines('Company: Test Agency', 'Test Person', 'Producer', 'Other Films'))).toEqual(
      C({ name: 'Test Person', role: 'Producer', org: 'Test Agency' })
    );
    expect(parsePasted(lines('Name: Test Person', 'Title: Booker', 'Company: Test Models', 'Producer', 'Other Films'))).toEqual(
      C({ name: 'Test Person', role: 'Booker', org: 'Test Models' })
    );
  });

  it('uses the lines after a labelled name', () => {
    expect(parsePasted(lines('Name: Test Person', 'Producer', 'Test Films'))).toEqual(
      C({ name: 'Test Person', role: 'Producer', org: 'Test Films' })
    );
  });
});

describe('parsePasted: names', () => {
  it('reads the name from a From: line', () => {
    expect(parsePasted('From: "Test Person" <test.person@example.com>\nSent: Monday\nSubject: Hello')).toEqual(
      C({ name: 'Test Person', email: 'test.person@example.com' })
    );
    expect(parsePasted('FROM: Test Person <tp@example.com>').name).toBe('Test Person');
    expect(parsePasted('Hello\nTest Person <tp@example.com>').name).toBe('Test Person');
    // Emails that don't spell the name, so only the From: line can give it.
    expect(parsePasted('From: "Test Person" <tp@example.com>').name).toBe('Test Person');
    expect(parsePasted('From:   "Test Person"   <tp@example.com>').name).toBe('Test Person');
  });

  it('keeps a labelled name over a From: line', () => {
    expect(parsePasted('Name: Labelled Person\nFrom: "Other Person" <op@example.com>').name).toBe('Labelled Person');
  });

  it('ignores a From: name that is too short or too long', () => {
    // The space before "<" counts, so "Al <...>" is long enough; "Al<...>" is not.
    expect(parsePasted('Al <al@example.com>').name).toBe('Al');
    expect(parsePasted('Al<al@example.com>').name).toBe('');
    expect(parsePasted(`${'Abcdefghij '.repeat(4)}X <tp@example.com>`).name).toBe('');
  });

  it('skips sign-offs and greetings before the name', () => {
    for (const s of ['Cheers,', 'Kind regards', 'Thanks so much!', 'Sent from my iPhone', 'Hi', 'Dear Test', '--', 'xo']) {
      expect(parsePasted(lines(s, 'Test Person')).name).toBe('Test Person');
    }
  });

  it('accepts two to four capitalised words of up to 40 characters', () => {
    expect(parsePasted("Ann-Marie O'Test").name).toBe("Ann-Marie O'Test");
    expect(parsePasted('J. Test Person Jr.').name).toBe('J. Test Person Jr.');
    expect(parsePasted('Élodie Tést').name).toBe('Élodie Tést');
    expect(parsePasted('Abcdefghi Abcdefghi Abcdefghi Abcdefghij').name).toBe('Abcdefghi Abcdefghi Abcdefghi Abcdefghij');
  });

  it('does not mistake names that start like a sign-off or a company word', () => {
    expect(parsePasted('Hilda Test').name).toBe('Hilda Test');
    expect(parsePasted('Ana Corpuz').name).toBe('Ana Corpuz');
  });

  it('rejects lines that do not read like a name', () => {
    for (const s of [
      'Madonna',
      'Ann Bee Cee Dee Eee',
      'test person',
      'Test person',
      'Test Person 2',
      'Abcdefghi Abcdefghi Abcdefghi Abcdefghijk',
      'Casting Director',
      'Test Films',
      'Test Casting',
      'Test deVille',
      'Test Person,',
    ]) {
      expect(parsePasted(s).name).toBe('');
    }
  });

  it('splits a name off the front of a line at each kind of separator', () => {
    expect(parsePasted('Test Person | Booker | Test Models')).toEqual(C({ name: 'Test Person', role: 'Booker', org: 'Test Models' }));
    expect(parsePasted('Test Person - Photo Editor at Test Magazine')).toEqual(
      C({ name: 'Test Person', role: 'Photo Editor', org: 'Test Magazine' })
    );
    expect(parsePasted('Test Person / Producer')).toEqual(C({ name: 'Test Person', role: 'Producer' }));
    expect(parsePasted('Test Person · Producer · Test Films')).toEqual(
      C({ name: 'Test Person', role: 'Producer', org: 'Test Films' })
    );
    expect(parsePasted('Test Person — Producer')).toEqual(C({ name: 'Test Person', role: 'Producer' }));
    expect(parsePasted('Test Person @ Test Films')).toEqual(C({ name: 'Test Person', org: 'Test Films' }));
    expect(parsePasted('Test Person , Producer')).toEqual(C({ name: 'Test Person', role: 'Producer' }));
  });

  it('does not split when the front is not a name', () => {
    expect(parsePasted('Casting Director | Test Films').name).toBe('');
  });

  it('title-cases names written in capitals', () => {
    expect(parsePasted(lines('TEST PERSON', 'PRODUCER', 'TEST FILMS'))).toEqual(
      C({ name: 'Test Person', role: 'PRODUCER', org: 'TEST FILMS' })
    );
    expect(parsePasted("Name: O'NEIL-TEST ÉLODIE").name).toBe("O'Neil-Test Élodie");
    expect(parsePasted('Name: ABCD').name).toBe('Abcd');
  });

  it('leaves short capital names and mixed-case names alone', () => {
    expect(parsePasted('Name: ABC').name).toBe('ABC');
    expect(parsePasted('Name: McTest DeVille').name).toBe('McTest DeVille');
  });

  it('makes a name from a first.last email as a last resort', () => {
    expect(parsePasted('test.person@example.com')).toEqual(C({ name: 'Test Person', email: 'test.person@example.com' }));
    expect(parsePasted('Write to TEST_PERSON@EXAMPLE.COM').name).toBe('Test Person');
  });

  it('does not make a name from other email shapes', () => {
    for (const e of ['tperson@example.com', 'a.person@example.com', 'te.st.person@example.com', 'test.person2@example.com', 'test-person@example.com']) {
      expect(parsePasted(e).name).toBe('');
    }
  });

  it('prefers a real name over the email', () => {
    expect(parsePasted(lines('Test Person', 'other.name@example.com')).name).toBe('Test Person');
  });
});

describe('parsePasted: email, phone, website, Instagram', () => {
  it('finds the first email address', () => {
    expect(parsePasted("Reach me: test.o'person+tag@sub.example.co.uk or other@example.com").email).toBe(
      "test.o'person+tag@sub.example.co.uk"
    );
    expect(parsePasted('Email test@localhost').email).toBe('');
  });

  it('prefers a mobile number, labelled any common way', () => {
    expect(parsePasted(lines('Office 555 010 0010', 'Mobile 555 010 0011')).phone).toBe('555 010 0011');
    expect(parsePasted(lines('Tel 555 010 0012', 'C. 555 010 0013')).phone).toBe('555 010 0013');
    expect(parsePasted(lines('Tel 555 010 0012', 'cell: 555 010 0014')).phone).toBe('555 010 0014');
    expect(parsePasted(lines('Tel 555 010 0012', 'M 555 010 0016')).phone).toBe('555 010 0016');
    expect(parsePasted(lines('Tel 555 010 0012', 'mob: 555 010 0019')).phone).toBe('555 010 0019');
  });

  it('takes the first number when none is a mobile', () => {
    expect(parsePasted(lines('Office (555) 010-0020', 'Studio 555.010.0021 (main)')).phone).toBe('(555) 010-0020');
    expect(parsePasted('Tel +1 555 010 0022').phone).toBe('+1 555 010 0022');
  });

  it('skips dates and numbers too short or too long to be phones', () => {
    expect(parsePasted(lines('Born 1990-03-14', 'Phone 555 010 0015')).phone).toBe('555 010 0015');
    expect(parsePasted('Code 12-34-56').phone).toBe('');
    expect(parsePasted('Ref 1111 2222 3333 4444').phone).toBe('');
    expect(parsePasted('Line 555-0100').phone).toBe('555-0100');
    expect(parsePasted('Intl +123 456 789 012 345').phone).toBe('+123 456 789 012 345');
  });

  it('only skips numbers that are exactly a date', () => {
    expect(parsePasted('Toll free 0120-12-3456').phone).toBe('0120-12-3456');
    expect(parsePasted('Tel +49 30 1234-56-78').phone).toBe('+49 30 1234-56-78');
  });

  it('does not read digits in emails or links as phones', () => {
    expect(parsePasted(lines('test5550100123@example.com', 'www.test5550100124.com', 'https://test.example/5550100125')).phone).toBe('');
    expect(parsePasted('Links: www.test5550100124.com and WWW.TEST5550100125.COM').phone).toBe('');
  });

  it('finds the website and trims trailing punctuation', () => {
    expect(parsePasted('Portfolio: https://www.testperson.com/work).').website).toBe('https://www.testperson.com/work');
    expect(parsePasted('(see www.testperson.com])').website).toBe('www.testperson.com');
    expect(parsePasted('testperson.studio').website).toBe('testperson.studio');
  });

  it('skips social links when picking the website', () => {
    const text = lines(
      'linkedin.com/in/testperson',
      'https://x.com/testperson',
      'tiktok.com/@testperson',
      'threads.net/@testperson',
      'facebook.com/testperson',
      'twitter.com/testperson',
      'testperson.photo'
    );
    expect(parsePasted(text)).toEqual(C({ website: 'testperson.photo' }));
  });

  it('keeps a website whose domain merely ends in x', () => {
    expect(parsePasted(lines('Test Person', 'www.testbox.com/portfolio')).website).toBe('www.testbox.com/portfolio');
  });

  it('does not take abbreviations or email domains as websites', () => {
    expect(parsePasted('Wears J.Crew, e.g. on set').website).toBe('');
    expect(parsePasted('test@testperson.com').website).toBe('');
  });

  it('finds the Instagram handle from a link or an @', () => {
    expect(parsePasted('instagram.com/test.person')).toEqual(C({ instagram: 'test.person' }));
    expect(parsePasted('See instagram.com/testperson.').instagram).toBe('testperson');
    expect(parsePasted('Follow me (@test_person).').instagram).toBe('test_person');
    expect(parsePasted('Test Person |@testperson').instagram).toBe('testperson');
    expect(parsePasted('@testperson').instagram).toBe('testperson');
    expect(parsePasted('@test.person.').instagram).toBe('test.person');
  });

  it('prefers a labelled handle', () => {
    expect(parsePasted(lines('Instagram: labelled', '@other')).instagram).toBe('labelled');
  });

  it('does not take emails, mid-word @s or one-letter handles as Instagram', () => {
    expect(parsePasted('test@testperson.com').instagram).toBe('');
    expect(parsePasted('reach me at@nope').instagram).toBe('');
    expect(parsePasted('@a').instagram).toBe('');
  });
});

describe('parsePasted: role and company', () => {
  it('takes only the first two plain lines after the name', () => {
    expect(parsePasted(lines('Test Person', 'Producer', 'Test Place', 'Test Group'))).toEqual(
      C({ name: 'Test Person', role: 'Producer', org: 'Test Place' })
    );
  });

  it('prefers a line that reads like a company, else the last one', () => {
    expect(parsePasted(lines('Test Person', 'Test Place', 'Test Films')).org).toBe('Test Films');
    expect(parsePasted(lines('Test Person', 'Test Films', 'Test Place')).org).toBe('Test Films');
    expect(parsePasted(lines('Test Person', 'Alpha Place', 'Beta Place')).org).toBe('Beta Place');
    expect(parsePasted(lines('Test Person', 'Test Film', 'Test Place')).org).toBe('Test Film');
  });

  it('keeps short numbers, odd spacing and look-alike suffixes in role and company lines', () => {
    expect(parsePasted(lines('Test Person', 'Test Place 2')).org).toBe('Test Place 2');
    expect(parsePasted(lines('Test Person', 'Producer , Test Films'))).toEqual(
      C({ name: 'Test Person', role: 'Producer', org: 'Test Films' })
    );
    expect(parsePasted(lines('Test Person', 'Producer, Test Co')).org).toBe('Test Co');
    expect(parsePasted(lines('Test Person', 'Coordinator')).role).toBe('Coordinator');
    expect(parsePasted(lines('Test Person', 'Cofounder')).role).toBe('Cofounder');
    expect(parsePasted(lines('Test Person', 'Producer', 'Heyday')).org).toBe('Heyday');
  });

  it('takes the first role when there are several', () => {
    expect(parsePasted(lines('Test Person', 'Producer | Editor')).role).toBe('Producer');
  });

  it('drops a bare company suffix like Inc, LLC, Ltd or Co', () => {
    expect(parsePasted(lines('Test Person', 'Producer, Test Place, LLC')).org).toBe('Test Place');
    expect(parsePasted(lines('Test Person', 'Producer, Test Place, Co.')).org).toBe('Test Place');
    expect(parsePasted(lines('Test Person', 'Producer, Test Place, Inc.')).org).toBe('Test Place');
    expect(parsePasted(lines('Test Person', 'Producer, Test Place, ltd')).org).toBe('Test Place');
  });

  it('tells role words from company names that end in them', () => {
    expect(parsePasted(lines('Test Person', 'Head of Casting'))).toEqual(C({ name: 'Test Person', role: 'Head of Casting' }));
    expect(parsePasted(lines('Test Person', 'Talent Agency'))).toEqual(C({ name: 'Test Person', org: 'Talent Agency' }));
    expect(parsePasted(lines('Test Person', 'Casting'))).toEqual(C({ name: 'Test Person', org: 'Casting' }));
    expect(parsePasted(lines('Test Person', 'Creative Director', 'Test Creative'))).toEqual(
      C({ name: 'Test Person', role: 'Creative Director', org: 'Test Creative' })
    );
    expect(parsePasted(lines('Test Person', 'Brand Manager'))).toEqual(C({ name: 'Test Person', role: 'Brand Manager' }));
  });

  it('skips contact lines, long lines and sign-offs when looking for role and company', () => {
    const skipped = [
      'Write to test@example.com',
      'Suite 300 Test Tower',
      'Visit teststudio.com',
      'ask me @desk',
      'Office: Test Tower',
      'Visit TestStudio.COM',
      `Long line ${'x'.repeat(51)}`,
      'Thanks so much!',
      'Thanks',
      'Best',
      'Warm regards',
      'Xooo',
      'xx',
      '--',
      '___',
      'Sent from my test phone',
      'Get Outlook for iOS',
    ];
    for (const s of skipped) {
      const p = parsePasted(lines('Test Person', s, 'Producer'));
      expect([s, p.role, p.org]).toEqual([s, 'Producer', '']);
    }
  });

  it('keeps a 60-character line', () => {
    const line = `Test ${'x'.repeat(55)}`;
    expect(line).toHaveLength(60);
    expect(parsePasted(lines('Test Person', line)).org).toBe(line);
  });

  it('looks at most four lines past the name', () => {
    const skip = ['a: 1', 'b: 2', 'c: 3'];
    expect(parsePasted(lines('Test Person', ...skip, 'Producer')).role).toBe('Producer');
    expect(parsePasted(lines('Test Person', ...skip, 'd: 4', 'Producer')).role).toBe('');
  });

  it('finds no role or company when there is no name', () => {
    expect(parsePasted(lines('producer', 'test films'))).toEqual(BLANK);
  });
});
