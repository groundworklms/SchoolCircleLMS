import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cohortProfileViewModel,
  errorMessage,
  fidelityViewModel,
  isExpectedNotFound,
  sextantViewModel,
  studyPlanViewModel,
} from '../app/_learning/evidence-ui.js';

test('Sextant UI view model preserves measured gain and mastery rollup shapes', () => {
  const view = sextantViewModel({
    scope: 'learner',
    gain: {
      objectives: [{ objective: 'movement', prePct: 0.25, postPct: 0.75, gain: 0.5, normalizedGain: 0.667 }],
      overall: { prePct: 0.25, postPct: 0.75, gain: 0.5, normalizedGain: 0.667 },
    },
    gaps: [{ objective: 'movement', attempts: 4, cohort: 4, missRate: 0.25 }],
    mastery: [{ competency: 'movement', developing: 1, competent: 2, mastered: 3, n: 6, masteredRate: 0.5 }],
  });

  assert.equal(view.overall.gain, 0.5);
  assert.equal(view.overall.normalizedGain, 0.667);
  assert.equal(view.mastery[0].competency, 'movement');
  assert.equal(view.mastery[0].masteredRate, 0.5);
});

test('Sextant UI view model keeps insufficient evidence distinct from an empty result', () => {
  const insufficient = sextantViewModel({
    gain: {
      status: 'insufficient_evidence',
      reason: 'Learning gain requires explicit pre/post attempts.',
    },
    gaps: [],
    mastery: { status: 'insufficient_evidence', reason: 'Need five learners.' },
  });
  const empty = sextantViewModel(null);

  assert.equal(insufficient.gain.status, 'insufficient_evidence');
  assert.equal(insufficient.masteryStatus, 'insufficient_evidence');
  assert.equal(empty.gain, null);
  assert.deepEqual(empty.gaps, []);
  assert.deepEqual(empty.mastery, []);
});

test('study plan UI view model exposes all three Cadence COAs without inventing blocks', () => {
  const view = studyPlanViewModel({
    plan: {
      status: 'on_track',
      recommended: 'maintain',
      coas: {
        catch_up: { label: 'Catch up', recommended: false, totalMinutes: 60, days: 1, lateRisk: 0, blocks: [] },
        maintain: { label: 'Maintain', recommended: true, totalMinutes: 45, days: 1, lateRisk: 0, blocks: [{ date: '2026-02-01', minutes: 45 }] },
        get_ahead: { label: 'Get ahead', recommended: false, totalMinutes: 75, days: 2, lateRisk: 1, blocks: [{ date: '2026-02-01', minutes: 60 }] },
      },
    },
    selectedBlocks: [{ date: '2026-02-01', minutes: 45 }],
  });

  assert.deepEqual(view.coas.map((coa) => coa.key), ['catch_up', 'maintain', 'get_ahead']);
  assert.equal(view.coas[1].recommended, true);
  assert.equal(view.coas[2].lateRisk, 1);
  assert.deepEqual(view.coas[0].blocks, []);
});

test('cohort profile UI view model preserves populated privacy-safe aggregates and empty states', () => {
  const populated = cohortProfileViewModel({
    status: 'complete',
    n: 5,
    dims: { visual: 0.8, verbal: null },
    modalityMix: [{ modality: 'visual', share: 0.8, count: 4 }],
    recommendations: ['Lead with diagrams.'],
  });
  const insufficient = cohortProfileViewModel({
    status: 'insufficient_evidence',
    reason: 'Need five learners.',
    profile: null,
  });

  assert.equal(populated.n, 5);
  assert.equal(populated.dims.visual, 0.8);
  assert.equal(populated.dims.verbal, null);
  assert.equal(populated.modalityMix[0].share, 0.8);
  assert.deepEqual(insufficient.recommendations, []);
  assert.equal(insufficient.status, 'insufficient_evidence');
});

test('fidelity UI view model renders actual report fidelity and run fields safely', () => {
  const view = fidelityViewModel({
    status: 'complete',
    report: {
      n: 2,
      scored: 1,
      errored: 1,
      conforming: 1,
      fidelity: 1,
      groundedRate: 1,
      meanGrounding: 0.92,
      byVerdict: { 'in-doctrine': 1, partial: 0, 'off-doctrine': 0, unknown: 0 },
      failures: [],
    },
    runs: [
      { id: 'case-1', verdict: 'in-doctrine', grounded: true, groundingScore: 0.92, response: { action: 'Hold.' } },
      { id: 'case-2', verdict: 'unknown', errored: true, reasons: 'timeout', grounded: false, groundingScore: 0 },
    ],
  });

  assert.equal(view.report.fidelity, 1);
  assert.equal(view.report.errored, 1);
  assert.equal(view.runs[0].groundingScore, 0.92);
  assert.equal(view.runs[1].errored, true);
  assert.equal(view.runs[1].reasons, 'timeout');
});

test('fidelity UI view model keeps unavailable, empty, and malformed reports explicit', () => {
  const unavailable = fidelityViewModel({
    status: 'unavailable',
    reason: 'No injected model',
    report: null,
    runs: [],
  });
  const malformed = fidelityViewModel({
    report: { fidelity: 'not-a-number', runs: { unexpected: true } },
    runs: { unexpected: true },
  });

  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.report, null);
  assert.deepEqual(unavailable.runs, []);
  assert.equal(malformed.report.fidelity, null);
  assert.deepEqual(malformed.runs, []);
});

test('error helpers distinguish expected empty records from service failures', () => {
  const missing = { status: 404, code: 'FIDELITY_NOT_FOUND', error: 'No saved fidelity evaluation' };
  const failed = { status: 503, code: 'MODEL_UNAVAILABLE', error: 'No injected model' };

  assert.equal(isExpectedNotFound(missing, 'FIDELITY_NOT_FOUND'), true);
  assert.equal(isExpectedNotFound(failed, 'FIDELITY_NOT_FOUND'), false);
  assert.equal(errorMessage(failed, 'fallback'), 'No injected model');
});
