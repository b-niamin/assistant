#!/usr/bin/env node
// Prints an APP_PASSWORD_HASH value for .env. Usage: npm run hash-password   (asks for the password)
import { randomBytes, scryptSync } from 'node:crypto';
import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
rl._writeToOutput = () => {}; // do not echo the password
process.stderr.write('App password: ');
rl.question('', (pw) => {
  rl.close();
  process.stderr.write('\n');
  if (pw.length < 12) {
    console.error('Use at least 12 characters.');
    process.exit(1);
  }
  const salt = randomBytes(16);
  console.log(`scrypt:${salt.toString('hex')}:${scryptSync(pw, salt, 64).toString('hex')}`);
});
