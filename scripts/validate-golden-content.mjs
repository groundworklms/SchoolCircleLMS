import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const base = new URL('../docs/golden-content/', import.meta.url);
const readJson = async (name) => JSON.parse(await readFile(new URL(name, base), 'utf8'));
const [manifest, inputs, cases] = await Promise.all(
  ['manifest.json', 'inputs.json', 'cases.json'].map(readJson),
);
for (const value of [manifest, inputs, cases]) assert.equal(value.status, 'PENDING');
assert.equal(manifest.packageId, inputs.packageId);
assert.equal(manifest.humanReview.status, 'PENDING');
assert.equal(manifest.humanReview.reviewedAt, null);
assert.equal(manifest.humanReview.decisionEvidence, null);
assert.equal(manifest.humanReview.releaseDecision, 'NOT_APPROVED_FOR_INSTRUCTION');
assert.deepEqual(manifest.approvedPublications, []);
assert(manifest.publicationCandidates.every((p) => p.status.startsWith('UNAVAILABLE')));
assert.equal(inputs.bankedDraft.status, 'PENDING');
assert.equal(inputs.source.sourceId, manifest.sources[0].id);
assert.equal(manifest.sources[0].printedPage, null);
assert.deepEqual(inputs.source.pages.map((p) => p.page), [1]);
assert.equal(cases.citationTarget, `${inputs.source.sourceId} p.1`);
assert.equal(inputs.bankedDraft.citation, cases.citationTarget);

// Compare string literals, never import the live proof (which has side effects).
const live = await readFile(new URL('./prove-learning-loop-live.mjs', import.meta.url), 'utf8');
const declaration = live.match(/const SOURCE_TEXT =\s*([\s\S]*?);/);
assert(declaration, 'Existing live-proof source declaration not found');
const literals = [...declaration[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
assert(literals.length > 0, 'Source literals not found');
const text = inputs.source.pages[0].text;
assert.equal(text, literals.join(''), 'Synthetic source must reuse the existing passage verbatim');
for (const sentence of inputs.bankedDraft.lesson.split('.').map((s) => s.trim()).filter(Boolean)) {
  assert(text.includes(sentence), 'Banked lesson claim must occur in the reused source');
}
assert(inputs.rubricTask.performanceSteps.every((s) => text.toLowerCase().includes(s.toLowerCase())));
assert.deepEqual(inputs.useCaseCoverage.map((c) => c.useCase).sort((a, b) => a - b), [1, 9, 12, 13, 16]);
assert.equal(new Set(cases.cases.map((c) => c.id)).size, cases.cases.length);
for (const kind of ['GROUNDED', 'REFUSAL', 'AMBIGUOUS', 'UNAVAILABLE']) {
  assert(cases.cases.some((c) => c.kind === kind), `Missing ${kind} cases`);
}
for (const entry of cases.cases) {
  assert(entry.question && entry.expected);
  if (entry.kind === 'GROUNDED') {
    assert(entry.evidenceQuote && text.includes(entry.evidenceQuote));
    assert(entry.requiredFacts.length > 0);
  }
}
console.log('Golden-content consistency: PASS. Synthetic only; human review PENDING; no live evaluation or import performed.');