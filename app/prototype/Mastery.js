'use client';

import { MasteryPanel } from './shared';
import { POIS } from './poi';
import { useState } from 'react';
import { useApiQuery, useApiMutation } from '../_learning/useLearning';
import { VERDICTS } from '../../lib/learning/reliability';

/* ---------- real course: Sextant cohort analytics ---------- */

const RELIABILITY_PATH = (id) => `/courses/${id}/reliability`;
const SESSIONS_PATH = (id) => `/mastery/sessions?courseId=${id}`;
const RATE_PATH = (id) => (id ? `/mastery/sessions/${id}/rate` : null);


function Insufficient({ evidence, what }) {
  return (
    <div className="p-panel">
      <h3>{what}</h3>
      <p className="p-src">
        {evidence?.reason || `Not enough evidence yet to show ${what.toLowerCase()}.`}
        {Number.isInteger(evidence?.observedLearners) && ` Observed learners: ${evidence.observedLearners} of ${evidence.minimumLearners}.`}
        {Number.isInteger(evidence?.observedContributors) && ` Contributors: ${evidence.observedContributors} of ${evidence.minimumContributors}.`}
      </p>
    </div>
  );
}

function pct(v) {
  return typeof v === 'number' ? `${Math.round(v <= 1 ? v * 100 : v)}%` : '—';
}

/*
 * Whether the grader and this instructor reach the same tier.
 *
 * "Rubric reliability is measured" is one of the four things this platform
 * claims to prove rather than assert, and Rubricon has shipped the arithmetic
 * for it from the start -- percentAgreement, cohenKappa, weightedKappa. Nothing
 * called any of it, so the claim was true of the library and false of the
 * product. This is where it becomes true of the product.
 *
 * Kappa rather than raw agreement, and both are shown. Three tiers means two
 * raters agree a third of the time by luck alone, so a headline "78% agreement"
 * is largely chance wearing a percentage; kappa is what corrects for it, which
 * is exactly why an assessment shop asks for it.
 *
 * It rates the INSTRUCTOR'S OWN sessions. Re-rating a Marine's session would
 * hand an instructor that learner's written answers, and every aggregate on
 * this screen exists in its current shape so that cannot happen.
 */
function GraderAgreement({ course }) {
  const { data, refetch } = useApiQuery(RELIABILITY_PATH(course.id));
  const summary = data?.reliability;
  const rated = data?.rated ?? 0;
  const unrated = data?.unrated ?? 0;
  if (!data) return null;
  if (rated === 0) {
    return (
      <div className="p-panel">
        <h3>Grader agreement</h3>
        <p className="p-src">
          Nothing measured yet. Sit one of this course&apos;s mastery sessions yourself, then rate
          each criterion the way you would have — the agreement between your verdicts and the
          grader&apos;s is what says whether this rubric can be trusted to grade anybody.
          {unrated > 0 && ' ' + unrated + ' of your finished ' + (unrated === 1 ? 'session is' : 'sessions are') + ' waiting to be rated.'}
        </p>
        <RateSessions course={course} onRated={refetch} />
      </div>
    );
  }
  return (
    <div className="p-panel">
      <h3>Grader agreement</h3>
      <p className="p-src">
        Your verdicts against the grader&apos;s, over {summary.n} rated{' '}
        {summary.n === 1 ? 'criterion' : 'criteria'} in {rated} {rated === 1 ? 'session' : 'sessions'}.
        {' '}Cohen&apos;s kappa corrects for the agreement three tiers produce by chance; raw
        agreement does not.
        {unrated > 0 && ' ' + unrated + ' finished ' + (unrated === 1 ? 'session has' : 'sessions have') + ' not been rated.'}
      </p>
      <div className="p-tiles">
        <div className="p-tile">
          <div className="p-tilelab">Kappa</div>
          <div
            className="p-tileval"
            style={{ color: summary.substantial === false ? 'var(--p-warning)' : summary.substantial ? 'var(--p-good)' : undefined }}
          >
            {typeof summary.kappa === 'number' ? summary.kappa.toFixed(2) : '—'}
          </div>
          <div className="p-tilenote">{summary.interpretation || summary.reason || 'chance-corrected'}</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Weighted kappa</div>
          <div className="p-tileval">{typeof summary.weightedKappa === 'number' ? summary.weightedKappa.toFixed(2) : '—'}</div>
          <div className="p-tilenote">partial credit one tier apart</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Raw agreement</div>
          <div className="p-tileval">{pct(summary.agreement)}</div>
          <div className="p-tilenote">before correcting for chance</div>
        </div>
      </div>
      {summary.substantial === false && (
        <p className="p-src" style={{ color: 'var(--p-warning)' }}>
          Below the conventional floor for substantial agreement (0.60). The rubric&apos;s anchors are
          the thing to fix: two raters disagreeing means the tiers are not distinguishable from each
          other on the evidence a session actually produces.
        </p>
      )}
      <RateSessions course={course} onRated={refetch} />
    </div>
  );
}

/* Rating one of your own finished sessions, criterion by criterion. */
function RateSessions({ course, onRated }) {
  const { data: sessions, refetch } = useApiQuery(SESSIONS_PATH(course.id));
  const [openId, setOpenId] = useState(null);
  const [verdicts, setVerdicts] = useState({});
  const [err, setErr] = useState(null);
  const rate = useApiMutation(RATE_PATH(openId), 'POST');
  const finished = (Array.isArray(sessions) ? sessions : []).filter(
    (session) => session?.status === 'COMPLETE'
      && Array.isArray(session.report?.criteria)
      && session.report.criteria.length > 0,
  );
  if (finished.length === 0) return null;
  const open = finished.find((session) => session.id === openId) || null;

  const submit = async () => {
    setErr(null);
    try {
      await rate.mutate({
        criteria: Object.entries(verdicts).map(([competency, verdict]) => ({ competency, verdict })),
      });
      setOpenId(null);
      setVerdicts({});
      await refetch();
      await onRated?.();
    } catch (error) {
      setErr(error?.error || error?.message || 'That rating could not be saved.');
    }
  };

  return (
    <div style={{ marginTop: '1rem', borderTop: '0.5px solid var(--p-border)', paddingTop: '0.9rem' }}>
      <h4 className="s-label">Your finished sessions</h4>
      {err && <p className="s-shell-error" role="alert">{err}</p>}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {finished.map((session) => (
          <li key={session.id} style={{ padding: '0.4rem 0' }}>
            <button
              type="button"
              className="p-btn ghost"
              onClick={() => { setOpenId(session.id === openId ? null : session.id); setVerdicts({}); }}
            >
              {session.raterVerdicts?.length ? 'Re-rate' : 'Rate'} session {String(session.id).slice(-6)}
            </button>
            {open?.id === session.id && (
              <div style={{ marginTop: '0.6rem' }}>
                {open.report.criteria.map((criterion) => {
                  const name = criterion.competency || criterion.elo || '';
                  return (
                    <div key={name} style={{ padding: '0.35rem 0' }}>
                      <div style={{ fontSize: '0.9em', fontWeight: 600 }}>{name}</div>
                      {/* The grader's verdict is deliberately NOT shown here.
                          A rater who has been told the answer is not a second
                          rater, and the number this produces would be worth
                          nothing. */}
                      <div className="p-btnrow" style={{ marginTop: '0.25rem' }}>
                        {VERDICTS.map((verdict) => (
                          <button
                            key={verdict}
                            type="button"
                            className={verdicts[name] === verdict ? 'p-btn' : 'p-btn ghost'}
                            aria-pressed={verdicts[name] === verdict}
                            onClick={() => setVerdicts({ ...verdicts, [name]: verdict })}
                          >
                            {verdict}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
                <button
                  type="button"
                  className="p-btn"
                  style={{ marginTop: '0.6rem' }}
                  disabled={Object.keys(verdicts).length === 0 || rate.loading}
                  onClick={submit}
                >
                  {rate.loading ? 'Saving…' : 'Save my verdicts'}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* Class mastery from persisted Whetstone reports and attempts. Every
   aggregate is suppressed below five distinct learners on the server — this
   screen shows what came back and never fills a gap with a number. */
function CohortMastery({ course }) {
  const { data, loading, error } = useApiQuery(`/analytics/cohort?courseId=${course.id}`);

  if (loading) return <p>Loading class evidence…</p>;
  if (error) {
    return (
      <p className="s-shell-error" role="alert">
        {error.error || error.message || 'Could not load class analytics.'}
      </p>
    );
  }
  if (!data) return null;

  const { gain, gaps, mastery, privacy } = data;
  const masteryRows = Array.isArray(mastery) ? mastery : null;
  const gapRows = Array.isArray(gaps) ? gaps : [];

  return (
    <>
      <h2 className="p-h">Class mastery</h2>
      <p className="p-sub">
        From saved mastery sessions and attempts. Aggregates appear only once
        {privacy?.cohortSuppressedBelow ? ` ${privacy.cohortSuppressedBelow}` : ' enough'} distinct learners have contributed — never any one Marine&apos;s answers.
      </p>

      <div className="p-tiles">
        <div className="p-tile">
          <div className="p-tilelab">Learners observed</div>
          <div className="p-tileval">{privacy?.observedLearners ?? '—'}</div>
          <div className="p-tilenote">with saved evidence</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Contributors</div>
          <div className="p-tileval">{masteryRows ? (privacy?.observedContributors ?? '—') : '—'}</div>
          <div className="p-tilenote">per competency, privacy-gated</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Learning gain</div>
          <div className="p-tileval">{gain?.status === 'insufficient_evidence' ? '—' : pct(gain?.overall?.normalizedGain ?? gain?.overall?.gain)}</div>
          <div className="p-tilenote">{gain?.status === 'insufficient_evidence' ? 'insufficient evidence' : 'pre → post'}</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Gaps flagged</div>
          <div className="p-tileval" style={{ color: gapRows.length ? 'var(--p-warning)' : 'var(--p-good)' }}>{gapRows.length}</div>
          <div className="p-tilenote">objectives below threshold</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Competencies</div>
          <div className="p-tileval">{masteryRows ? masteryRows.length : '—'}</div>
          <div className="p-tilenote">with enough contributors</div>
        </div>
      </div>

      {masteryRows ? (
        <div className="p-panel">
          <h3>Mastery by competency</h3>
          <div className="p-tablewrap">
            <table className="p-table">
              <thead>
                <tr>
                  <th>Competency</th>
                  <th className="p-num">Mastered</th>
                  <th className="p-num">Competent</th>
                  <th className="p-num">Developing</th>
                  <th className="p-num">Mastered rate</th>
                </tr>
              </thead>
              <tbody>
                {masteryRows.map((row, i) => (
                  <tr key={row.competency || i}>
                    <td>{row.competency || `Competency ${i + 1}`}</td>
                    <td className="p-num">{row.mastered ?? '—'}</td>
                    <td className="p-num">{row.competent ?? '—'}</td>
                    <td className="p-num">{row.developing ?? '—'}</td>
                    <td className="p-num" style={{ color: row.masteredRate < 0.65 ? 'var(--p-critical)' : 'var(--p-good)' }}>{pct(row.masteredRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <Insufficient evidence={mastery?.status ? mastery : data.evidence?.mastery} what="Mastery by competency" />
      )}

      <GraderAgreement course={course} />

      {gapRows.length > 0 && (
        <div className="p-panel">
          <h3>Class gaps — queued for lesson review</h3>
          <div className="p-tablewrap">
            <table className="p-table">
              <thead>
                <tr>
                  <th>Objective</th>
                  <th className="p-num">Missed</th>
                  <th className="p-num">Attempts</th>
                  <th className="p-num">Learners</th>
                </tr>
              </thead>
              <tbody>
                {gapRows.map((g, i) => (
                  <tr key={g.objective || i}>
                    <td>{g.objective}</td>
                    <td className="p-num" style={{ color: g.missRate >= 0.6 ? 'var(--p-critical)' : 'var(--p-warning)' }}>{pct(g.missRate)}</td>
                    <td className="p-num">{g.attempts ?? '—'}</td>
                    <td className="p-num">{g.cohort ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="p-src">
            Sextant ranks the objectives the class misses most.
          </p>
        </div>
      )}

      {gain?.status === 'insufficient_evidence' && <Insufficient evidence={gain} what="Learning gain" />}
    </>
  );
}

/* ---------- mock course: the demo numbers ---------- */

function Mastery({ course }) {
  if (course.record) return <CohortMastery course={course} />;

  const avg = Math.round(course.topics.reduce((s, t) => s + t.mastery, 0) / course.topics.length);
  const atRisk = course.topics.filter((t) => t.mastery < 65);

  return (
    <>
      <h2 className="p-h">Mastery &amp; Insights</h2>
      <p className="p-sub">
        Curriculum mastery by topic for the current class.
      </p>

      <div className="p-tiles">
        <div className="p-tile">
          <div className="p-tilelab">Class average</div>
          <div className="p-tileval">{avg}%</div>
          <div className="p-tilenote">{course.students} students</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Topics at risk</div>
          <div className="p-tileval" style={{ color: atRisk.length ? 'var(--p-critical)' : 'var(--p-good)' }}>
            {atRisk.length}
          </div>
          <div className="p-tilenote">below 65%</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Course progress</div>
          <div className="p-tileval">
            {course.week}<span style={{ fontSize: '0.5em', color: 'var(--p-dim)' }}>/{course.weeks}</span>
          </div>
          <div className="p-tilenote">weeks</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Items flagged</div>
          <div className="p-tileval" style={{ color: 'var(--p-warning)' }}>{course.missed.length}</div>
          <div className="p-tilenote">for review</div>
        </div>
      </div>

      <MasteryPanel
        title="Mastery by annex"
        topics={POIS[course.id].mastery.map((m) => ({ name: `${m.letter} — ${m.title}`, mastery: m.mastery }))}
      />

      <div className="p-panel">
        <h3>Most-missed items — queued for lesson review</h3>
        <div className="p-tablewrap">
          <table className="p-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Topic</th>
                <th className="p-num">Missed</th>
                <th>Likely reason</th>
              </tr>
            </thead>
            <tbody>
              {course.missed.map((m) => (
                <tr key={m.q}>
                  <td>{m.q}</td>
                  <td>{m.topic}</td>
                  <td className="p-num" style={{ color: m.pct >= 60 ? 'var(--p-critical)' : 'var(--p-warning)' }}>
                    {m.pct}%
                  </td>
                  <td>{m.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="p-src">
          Drafted from item analysis. The instructor decides what to re-teach.
        </p>
      </div>
    </>
  );
}

export default Mastery;
