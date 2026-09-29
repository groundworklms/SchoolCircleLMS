/*
 * Deployment config must not publish personal data or a way into internal services.
 *
 * MCU's post-hackathon security review (Sep 2026) flagged apphosting.yaml in this
 * public repository for four personal email addresses and a Cloudflare tunnel URL
 * that exposed the Anchor grounding engine to the internet. Both were
 * convenient at the time -- the allowlist was one line, the tunnel one command
 * -- which is exactly why a test holds the line rather than a comment.
 *
 * Where each value belongs instead:
 *   sign-in allowlist   NEXT_PUBLIC_ALLOWED_EMAILS in the App Hosting console or
 *                       Secret Manager, never a literal here
 *   Anchor address      Settings -> Doctrine engine (stored in the database),
 *                       and only ever an address reachable from the app server
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Every committed App Hosting config, including the documented example.
const CONFIG_FILES = [
  'apphosting.yaml',
  ...fs.readdirSync(workspace).filter((f) => /^apphosting\..+\.ya?ml$/.test(f)),
  ...fs.readdirSync(path.join(workspace, 'docs'))
    .filter((f) => /^apphosting.*\.ya?ml$/.test(f))
    .map((f) => path.join('docs', f)),
].filter((f, i, all) => all.indexOf(f) === i && fs.existsSync(path.join(workspace, f)));

const read = (file) => fs.readFileSync(path.join(workspace, file), 'utf8');

// Reserved documentation domains (RFC 2606) are the only addresses allowed.
const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+\.)+[A-Za-z]{2,}/g;
const EXAMPLE_DOMAIN = /@(?:[a-z0-9-]+\.)*(?:example\.(?:com|org|net)|example|test|invalid)$/i;

// Hosts that exist to put a private service on the public internet.
const TUNNEL = /\b[a-z0-9-]+\.(?:trycloudflare\.com|ngrok(?:-free)?\.(?:io|app|dev)|loca\.lt|serveo\.net|localhost\.run)\b/i;

test('there is at least one deployment config to check', () => {
  assert.ok(CONFIG_FILES.includes('apphosting.yaml'));
});

for (const file of CONFIG_FILES) {
  test(`${file} contains no personal email addresses, even in comments`, () => {
    const found = (read(file).match(EMAIL) || []).filter((address) => !EXAMPLE_DOMAIN.test(address));
    assert.deepEqual(found, [], `move these out of ${file}: ${found.join(', ')}`);
  });

  test(`${file} contains no tunnel address`, () => {
    const match = TUNNEL.exec(read(file));
    assert.equal(match, null, `tunnel address committed to ${file}: ${match?.[0]}`);
  });

  test(`${file} does not pin the grounding engine's address`, () => {
    // Set it in Settings -> Doctrine engine instead. A committed value is how
    // the tunnel URL ended up public in the first place.
    assert.doesNotMatch(read(file), /^\s*-\s*variable:\s*DOCTRINE_BASE_URL\b/m);
  });
}
