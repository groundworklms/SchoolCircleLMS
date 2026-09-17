#!/usr/bin/env node
/**
 * Print one `OFFLINE_AUTH_OPERATORS` roster entry for a local operator.
 *
 *   node scripts/offline/operator-passphrase.mjs <subject> [role] [name]
 *
 * The passphrase is read from stdin, never from argv or the environment, so it
 * cannot land in shell history, a process listing, or a CI log. The output
 * contains only the scrypt salt and hash (lib/settings-crypto.js
 * `hashPassphrase`), so the roster can be stored and reviewed without carrying
 * a way in.
 *
 *   printf '%s' 'correct horse battery staple' \
 *     | node scripts/offline/operator-passphrase.mjs sgt-okafor INSTRUCTOR 'SSgt Okafor'
 *
 * Collect the printed objects into a JSON array and supply it to the deployment
 * as OFFLINE_AUTH_OPERATORS through the secret store.
 */
import { hashPassphrase } from '../../lib/settings-crypto.js';

const SAFE_LABEL = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,127}$/;
const ROLES = new Set(['INSTRUCTOR', 'LEARNER', 'BOTH']);

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const [subject, role, name] = process.argv.slice(2);
if (!subject || !SAFE_LABEL.test(subject)) {
  fail('Usage: node scripts/offline/operator-passphrase.mjs <subject> [role] [name]\n'
    + 'subject: letters, digits, dot, dash, underscore or @ (max 128).');
}
if (role && !ROLES.has(role.toUpperCase())) {
  fail(`role must be one of ${[...ROLES].join(', ')}.`);
}

async function readStdin() {
  if (process.stdin.isTTY) {
    fail('Pipe the passphrase on stdin; it is deliberately not read from argv.');
  }
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  // Trailing newline from `echo` is not part of the passphrase.
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

const passphrase = await readStdin();
let hashed;
try {
  hashed = hashPassphrase(passphrase);
} catch (error) {
  fail(error?.message || 'The passphrase was rejected.');
}

process.stdout.write(`${JSON.stringify(
  {
    subject,
    ...(name ? { name } : {}),
    ...(role ? { role: role.toUpperCase() } : {}),
    passphrase: hashed,
  },
  null,
  2,
)}\n`);
