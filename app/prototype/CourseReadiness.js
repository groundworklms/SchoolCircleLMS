'use client';

import { useState } from 'react';

/** Human acknowledgement is tied to the exact candidate, never a course-wide flag.
 * These are review prompts, not a duplicate of the server's grounding validator.
 *
 * The copy here is the panel's whole job, so it is laid out to be read: the
 * server's conditions as a scannable list, and the two sentences that say what
 * this panel does NOT promise set apart where they cannot be skimmed past.
 * Neither of those sentences is softened or shortened — a panel that lists
 * checks and then quietly implies it ran them would be the one real lie on
 * this screen. */
export function CourseReadiness({ courseId, version, candidate, pending, published, busy, unavailable, onApprove }) {
  const [reviewedCandidate, setReviewedCandidate] = useState(null);
  const reviewKey = JSON.stringify([courseId, version, candidate]);
  const reviewed = reviewedCandidate === reviewKey;
  const hasContent = Array.isArray(candidate?.sections) && candidate.sections.length > 0;
  const hasSources = Array.isArray(candidate?.sourceIds) && candidate.sourceIds.length > 0;

  return (
    <section className="p-panel" aria-labelledby="course-readiness-title">
      <h3 id="course-readiness-title">{pending ? 'Review and publish' : 'Published course'}</h3>
      {published && pending && (
        <p className="p-measure">The previous release stays available to learners while you review.</p>
      )}

      <h4 className="p-sectionlab">Required by the server</h4>
      <ul className="p-checklist">
        <li>The exact reviewed version must still be current.</li>
        <li>Persisted source relationships must exist and every selected source must still be approved.</li>
        <li>Lessons and pre/post questions must pass content, answer-key, citation and grounding validation.</li>
      </ul>
      <p className="p-truth">These checks run again when you approve. This panel does not certify that they have passed.</p>

      <h4 className="p-sectionlab">Human review</h4>
      <p className="p-measure">Inspect every lesson, cited passage, question and answer key below. Request AI revisions where needed.</p>

      {pending && (
        <>
          {(!hasContent || !hasSources) && <p role="status">The candidate needs generated lessons and linked sources before approval.</p>}
          <label className="p-ack">
            <input
              type="checkbox"
              checked={reviewed}
              disabled={busy || unavailable || !hasContent || !hasSources}
              onChange={(event) => setReviewedCandidate(event.target.checked ? reviewKey : null)}
            />
            <span>I reviewed version {version}, including its citations and answer keys.</span>
          </label>
          <button type="button" className="p-btn" disabled={busy || unavailable || !reviewed || !hasContent || !hasSources} onClick={onApprove}>
            {busy ? 'Saving…' : 'Approve and publish'}
          </button>
        </>
      )}
      {!pending && <p className="p-measure">This approved version is published. A new AI revision will need its own review and approval.</p>}

      <div className="p-note">
        <b>Optional QA and learning tools:</b>
        {/* Naming the controls rather than the fact that they exist: "available
            under secondary controls" told an instructor nothing they could act
            on, and a tool nobody can find is a tool nobody runs. */}
        <span>
          Fidelity check and Objective rubrics are in the rail, under Quality checks. Syllabus and
          mastery plan are at the foot of this page. None is a course publishing requirement.
        </span>
      </div>
    </section>
  );
}
