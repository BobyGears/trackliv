import type { Request, Response } from 'express';

/** Server-sent events fan-out. */
const clients = new Set<Response>();

export function sseHandler(req: Request, res: Response) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  clients.add(res);
  req.on('close', () => clients.delete(res));
}

export function broadcast(event: string, data: unknown) {
  if (!clients.size) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

export function clientCount() {
  return clients.size;
}

setInterval(() => {
  for (const res of clients) res.write(': ping\n\n');
}, 20000).unref();
