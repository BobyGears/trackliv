// Prints a scrypt hash for TRACKLIV_USERS, e.g.  npm run hash-password -- "my secret"
import { createInterface } from 'node:readline/promises';
import { hashPassword } from './auth.ts';

let password = process.argv[2];
if (!password) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  password = await rl.question('Password: ');
  rl.close();
}
if (!password) {
  console.error('No password given');
  process.exit(1);
}
console.log(hashPassword(password));
console.log('\nUse it in .env as  TRACKLIV_USERS=Your Name:<the hash above>  (comma-separate several users)');
