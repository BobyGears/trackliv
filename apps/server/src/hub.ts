import type { Request, Response } from 'express';

/** Server-sent events fan-out. Each stream remembers the session it belongs to. */
const clients = new Map<Response, string | undefined>();

export function sseHandler(req: Request, res: Response) {
  const session = res.locals.sessionKey as string | undefined;
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  clients.set(res, session);
  req.on('close', () => clients.delete(res));
}

export function broadcast(event: string, data: unknown) {
  if (!clients.size) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients.keys()) res.write(msg);
}

/** Sessions with a live screen open (they make no requests of their own). */
export function streamSessions(): string[] {
  return [...clients.values()].filter((k): k is string => !!k);
}

/** A session ended (signed out, or Atlas withdrew access): tell its screens and close them. */
export function closeStreams(session: string) {
  for (const [res, k] of clients) {
    if (k !== session) continue;
    res.write('event: auth\ndata: {"signedOut":true}\n\n');
    res.end();
    clients.delete(res);
  }
}

export function clientCount() {
  return clients.size;
}

setInterval(() => {
  for (const res of clients.keys()) res.write(': ping\n\n');
}, 20000).unref();
