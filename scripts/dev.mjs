#!/usr/bin/env node
// Runs the API server and the Vite dev server side by side with prefixed output.
import { spawn } from 'node:child_process';

const procs = [
  { name: 'api', color: 34, args: ['run', 'dev', '-w', '@trackliv/server'] },
  { name: 'web', color: 35, args: ['run', 'dev', '-w', '@trackliv/web'] },
];

const children = procs.map(({ name, color, args }) => {
  const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '1' },
  });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) out.write(prefix + line + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`${prefix}exited with ${code}`);
    shutdown(code ?? 0);
  });
  return child;
});

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (!c.killed) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 300);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
