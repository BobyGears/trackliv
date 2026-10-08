import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Small, dependency-free login for a dispatch team.
 *
 *   TRACKLIV_USERS=Boby:scrypt:<salt>:<hash>,Dispo 2:plain-password
 *   TRACKLIV_SESSION_SECRET=<64 hex chars>
 *
 * Passwords can be stored plain (server .env is chmod 600) or as scrypt hashes
 * (`npm run hash-password`). The hash format avoids `$` because Docker Compose would expand it
 * in env files. Sessions are HMAC-signed cookies, so nothing is stored server-side.
 */

export interface AuthConfig {
  users: Map<string, string>;
  secret: Buffer;
  enabled: boolean;
}

const COOKIE = 'tl_session';
const MAX_AGE_S = 30 * 24 * 3600;

export function parseUsers(raw: string | undefined): Map<string, string> {
  const users = new Map<string, string>();
  for (const entry of (raw ?? '').split(',')) {
    const i = entry.indexOf(':');
    if (i <= 0) continue;
    const name = entry.slice(0, i).trim();
    const secret = entry.slice(i + 1).trim();
    if (name && secret) users.set(name, secret);
  }
  return users;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

function safeEqual(a: Buffer, b: Buffer) {
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyPassword(stored: string, password: string): boolean {
  const m = /^scrypt:([0-9a-f]+):([0-9a-f]+)$/i.exec(stored);
  if (m) {
    const [, saltHex, hashHex] = m;
    const expected = Buffer.from(hashHex, 'hex');
    return safeEqual(scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length), expected);
  }
  return safeEqual(Buffer.from(stored), Buffer.from(password));
}

export function createAuth(env: NodeJS.ProcessEnv): AuthConfig {
  const users = parseUsers(env.TRACKLIV_USERS);
  const secretHex = env.TRACKLIV_SESSION_SECRET ?? '';
  const secret = /^[0-9a-f]{32,}$/i.test(secretHex) ? Buffer.from(secretHex, 'hex') : randomBytes(32);
  // TRACKLIV_AUTH=off switches the login off even when users are listed (e.g. for a demo)
  return { users, secret, enabled: users.size > 0 && env.TRACKLIV_AUTH !== 'off' };
}

function sign(auth: AuthConfig, payload: string) {
  return createHmac('sha256', auth.secret).update(payload).digest('base64url');
}

export function issueSession(auth: AuthConfig, user: string): string {
  const payload = Buffer.from(JSON.stringify({ u: user, exp: Math.floor(Date.now() / 1000) + MAX_AGE_S })).toString('base64url');
  return `${payload}.${sign(auth, payload)}`;
}

export function readSession(auth: AuthConfig, token: string | undefined): string | null {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig || !safeEqual(Buffer.from(sig), Buffer.from(sign(auth, payload)))) return null;
  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { u: string; exp: number };
    if (!u || exp < Date.now() / 1000 || !auth.users.has(u)) return null; // removed users lose access
    return u;
  } catch {
    return null;
  }
}

function cookieValue(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export function sessionUser(auth: AuthConfig, req: Request): string | null {
  return readSession(auth, cookieValue(req, COOKIE));
}

export function setSessionCookie(req: Request, res: Response, token: string | null) {
  const parts = [
    `${COOKIE}=${token ? encodeURIComponent(token) : ''}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${token ? MAX_AGE_S : 0}`,
  ];
  if (req.secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

/** 10 failed attempts per IP per 15 minutes. */
const attempts = new Map<string, { n: number; until: number }>();
export function loginRateLimited(ip: string): boolean {
  const a = attempts.get(ip);
  return !!a && a.until > Date.now() && a.n >= 10;
}
export function noteFailedLogin(ip: string) {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || a.until < now) attempts.set(ip, { n: 1, until: now + 15 * 60000 });
  else a.n++;
  if (attempts.size > 5000) attempts.clear();
}

/** Guards /api/* (except auth + health) when users are configured. */
export function requireSession(auth: AuthConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!auth.enabled) return next();
    const user = sessionUser(auth, req);
    if (!user) return void res.status(401).json({ error: 'Please sign in' });
    res.locals.user = user;
    next();
  };
}
