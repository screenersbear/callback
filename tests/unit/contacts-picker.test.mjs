import { describe, it, expect, afterEach, vi } from 'vitest';
import { canPickContacts, pickContacts } from '../../js/contacts.js';

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

function install({ contacts, manager = true }) {
  if (contacts !== undefined) Object.defineProperty(navigator, 'contacts', { value: contacts, configurable: true });
  if (manager) window.ContactsManager = function ContactsManager() {};
}

function picker({ props = ['name', 'email', 'tel'], propsError = false, picked = [] } = {}) {
  const select = vi.fn(async () => picked);
  const getProperties = vi.fn(async () => {
    if (propsError) throw new Error('not supported');
    return props;
  });
  install({ contacts: { select, getProperties } });
  return { select, getProperties };
}

afterEach(() => {
  delete navigator.contacts;
  delete window.ContactsManager;
});

describe('canPickContacts', () => {
  it('is false where the browser has no contact picker', () => {
    expect(canPickContacts()).toBe(false);
  });

  it('is true when the picker and its select function are there', () => {
    install({ contacts: { select: () => {} } });
    expect(canPickContacts()).toBe(true);
  });

  it('is false with only part of the API', () => {
    install({ contacts: { select: () => {} }, manager: false });
    expect(canPickContacts()).toBe(false);
    delete navigator.contacts;
    install({ contacts: undefined });
    expect(canPickContacts()).toBe(false);
    install({ contacts: { select: 'not a function' } });
    expect(canPickContacts()).toBe(false);
  });
});

describe('pickContacts', () => {
  it('asks for name, email and phone, several at once, and maps the picks', async () => {
    const { select } = picker({
      props: ['address', 'name', 'email', 'tel', 'icon'],
      picked: [{ name: ['Test Person'], email: ['test@example.com'], tel: ['555 010 0001'] }],
    });
    expect(await pickContacts()).toEqual([
      { ...BLANK, name: 'Test Person', email: 'test@example.com', phone: '555 010 0001' },
    ]);
    expect(select).toHaveBeenCalledWith(['name', 'email', 'tel'], { multiple: true });
  });

  it('only asks for the properties the browser offers', async () => {
    const { select } = picker({ props: ['tel', 'name'] });
    expect(await pickContacts()).toEqual([]);
    expect(select).toHaveBeenCalledWith(['name', 'tel'], { multiple: true });
  });

  it('asks for the usual three when the browser cannot list its properties', async () => {
    const { select } = picker({ propsError: true });
    await pickContacts();
    expect(select).toHaveBeenCalledWith(['name', 'email', 'tel'], { multiple: true });
  });

  it('takes the first non-blank value of each list and trims it', async () => {
    picker({
      picked: [{ name: ['', '   ', '  Test Person  '], email: [null, ' test@example.com '], tel: [undefined, '', ' 555 010 0002'] }],
    });
    expect(await pickContacts()).toEqual([
      { ...BLANK, name: 'Test Person', email: 'test@example.com', phone: '555 010 0002' },
    ]);
  });

  it('names someone by their email, then their phone, and drops picks with nothing at all', async () => {
    picker({
      picked: [
        { name: [], email: ['only.email@example.com'], tel: ['555 010 0003'] },
        { name: ['  '], tel: ['555 010 0004'] },
        { name: [], email: [], tel: [] },
        {},
      ],
    });
    expect(await pickContacts()).toEqual([
      { ...BLANK, name: 'only.email@example.com', email: 'only.email@example.com', phone: '555 010 0003' },
      { ...BLANK, name: '555 010 0004', phone: '555 010 0004' },
    ]);
  });

  it('returns an empty list when nothing is picked', async () => {
    picker({ picked: [] });
    expect(await pickContacts()).toEqual([]);
  });

  it('passes on a failure from the picker itself', async () => {
    install({ contacts: { getProperties: async () => ['name'], select: async () => Promise.reject(new Error('cancelled')) } });
    await expect(pickContacts()).rejects.toThrow('cancelled');
  });
});
