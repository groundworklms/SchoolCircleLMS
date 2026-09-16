'use client';

import { useState } from 'react';

/** Human acknowledgement is tied to the exact candidate, never a course-wide flag.
 * These are review prompts, not a duplicate of the server's grounding validator. */
export function CourseReadiness({ courseId, version, candidate, pending, published, busy, unavailable, onApprove }) {
  const [reviewedCandidate, setReviewedCandidate] = useState(null);
  const reviewKey = JSON.stringify([courseId, version, candidate]);
  const reviewed = reviewedCandidate === reviewKey;
  const hasContent = Array.isArray(candidate?.sections) && candidate.sections.length > 0;
  const hasSources = Array.isArray(candidate?.sourceIds) && candidate.sourceIds.length > 0;

  return (
    <section className="p-panel" aria-labelledby="course-readiness-title">
      <h3 id="course-readiness-title">{pending ? 'Review and publish' : 'Published course'}</h3>
      <p className="p-src">Sources → Generate → Review → Approve and publish</p>
      {published && pending && (
        <p>The previous approved release remains available to learners while you review this revision.</p>
      )}
      <h4>Required by the server</h4>
      <ul>
        <li>The exact reviewed version must still be current.</li>
        <li>Persisted source relationships must exist and every selected source must still be approved.</li>
        <li>Lessons and pre/post questions must pass content, answer-key, citation and grounding validation.</li>
      </ul>
      <p className="p-src">These checks run again when you approve. This panel does not certify that they have passed.</p>
      <h4>Human review</h4>
      <p>Inspect every lesson, cited passage, question and instructor-only answer key below. Request AI revisions where needed, then review the updated version.</p>
      {pending && (
        <>
          {(!hasContent || !hasSources) && <p role="status">The candidate needs generated lessons and linked sources before approval.</p>}
          <label style={{ display: 'flex', gap: '0.5rem', margin: '1rem 0' }}>
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
      {!pending && <p>This approved version is published. A new AI revision will need its own review and approval.</p>}
      <p className="p-src" style={{ marginTop: '1rem' }}><strong>Optional QA and learning tools:</strong> fidelity evaluation, rubrics, syllabus and mastery plans are available under secondary controls. None is a course publishing requirement.</p>
    </section>
  );
}