import { describe, expect, it } from 'vitest';
import { createAuth, hashPassword, issueSession, parseUsers, readSession, verifyPassword } from './auth.ts';

describe('auth', () => {
  it('parses the user list', () => {
    const users = parseUsers('Boby:secret1, Dispo 2:pw:with:colons ,broken,:nouser');
    expect([...users.keys()]).toEqual(['Boby', 'Dispo 2']);
    expect(users.get('Dispo 2')).toBe('pw:with:colons');
  });

  it('verifies plain and scrypt passwords', () => {
    expect(verifyPassword('hunter2', 'hunter2')).toBe(true);
    expect(verifyPassword('hunter2', 'hunter3')).toBe(false);
    const h = hashPassword('Lager-Schieferstein-4');
    expect(h).toMatch(/^scrypt:[0-9a-f]{32}:[0-9a-f]{64}$/);
    expect(verifyPassword(h, 'Lager-Schieferstein-4')).toBe(true);
    expect(verifyPassword(h, 'wrong')).toBe(false);
  });

  it('issues and validates signed sessions', () => {
    const auth = createAuth({ TRACKLIV_USERS: 'Boby:x', TRACKLIV_SESSION_SECRET: 'ab'.repeat(32) });
    const token = issueSession(auth, 'Boby');
    expect(readSession(auth, token)).toBe('Boby');
    expect(readSession(auth, token.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')))).toBeNull(); // tampered
    const other = createAuth({ TRACKLIV_USERS: 'Boby:x', TRACKLIV_SESSION_SECRET: 'cd'.repeat(32) });
    expect(readSession(other, token)).toBeNull(); // different secret
    const removed = createAuth({ TRACKLIV_USERS: 'Someone:x', TRACKLIV_SESSION_SECRET: 'ab'.repeat(32) });
    expect(readSession(removed, token)).toBeNull(); // user no longer configured
  });

  it('is disabled without users or with TRACKLIV_AUTH=off', () => {
    expect(createAuth({}).enabled).toBe(false);
    expect(createAuth({ TRACKLIV_USERS: 'Boby:x' }).enabled).toBe(true);
    expect(createAuth({ TRACKLIV_USERS: 'Boby:x', TRACKLIV_AUTH: 'off' }).enabled).toBe(false);
  });
});
