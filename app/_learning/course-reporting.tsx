"use client";

import type { ReactNode } from "react";
import { useApiQuery } from "./use-learning";
import {
  errorMessage,
  cohortProfileViewModel,
  isExpectedNotFound,
  sextantViewModel,
} from "./evidence-ui.js";

const PROFILE_DIMENSIONS = [
  ["visual", "Visual"],
  ["verbal", "Verbal"],
  ["reading", "Reading"],
  ["hands_on", "Hands-on"],
  ["self_paced", "Pace"],
  ["structured", "Structure"],
] as const;

function formatPercent(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${Math.round(value * 100)}%`
    : "Not measured";
}

function formatNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "Not measured";
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return <div className="p-rationale"><strong>{label}</strong><div>{value}</div></div>;
}

function CohortSextant({ data, error, loading }: { data: any; error: any; loading: boolean }) {
  if (loading) return <p>Loading cohort progress...</p>;
  if (error) {
    return (
      <div>
        <p className="learning-critical"><strong>Cohort progress could not be loaded.</strong></p>
        <p>{errorMessage(error, "The cohort analytics service returned an error.")}</p>
      </div>
    );
  }
  if (!data) return <p className="learning-dim">No saved cohort progress evidence is available yet.</p>;

  const analytics = sextantViewModel(data);
  const gainInsufficient = analytics.gain?.status === "insufficient_evidence";
  return (
    <div>
      {analytics.privacy.observedLearners != null && (
        <p className="learning-dim">Observed learners: {String(analytics.privacy.observedLearners)}. Learner identities are not displayed.</p>
      )}
      {gainInsufficient ? (
        <div className="p-rationale">
          <strong className="learning-warning">Insufficient evidence</strong>
          <p style={{ marginTop: "0.35rem", marginBottom: 0 }}>{analytics.gain?.reason || "A cohort needs sufficient distinct learners and explicit pre/post evidence."}</p>
        </div>
      ) : analytics.overall ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(8rem, 1fr))", gap: "0.5rem" }}>
          <Metric label="Pre" value={formatPercent(analytics.overall.prePct)} />
          <Metric label="Post" value={formatPercent(analytics.overall.postPct)} />
          <Metric label="Gain" value={formatPercent(analytics.overall.gain)} />
          <Metric label="Normalized gain" value={formatPercent(analytics.overall.normalizedGain)} />
        </div>
      ) : (
        <p className="learning-dim">No measurable pre/post gain is available.</p>
      )}

      <div style={{ marginTop: "1rem" }}>
        <h4>Objective gaps</h4>
        {analytics.gaps.length === 0 ? (
          <p className="learning-dim">No cohort gap rows were emitted.</p>
        ) : (
          <ul style={{ paddingLeft: "1.5rem", marginBottom: 0 }}>
            {analytics.gaps.map((gap: any, index: number) => (
              <li key={`${gap.objective || "objective"}-${index}`}>
                <strong>{gap.objective || "Overall"}</strong> · miss rate {formatPercent(gap.missRate)} · {formatNumber(gap.attempts)} attempts
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ marginTop: "1rem" }}>
        <h4>Mastery rollup</h4>
        {analytics.masteryStatus === "insufficient_evidence" ? (
          <p className="learning-warning">{analytics.masteryReason || "Insufficient evidence for a cohort mastery rollup."}</p>
        ) : analytics.mastery.length === 0 ? (
          <p className="learning-dim">No validated mastery criteria are available.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {analytics.mastery.map((mastery: any, index: number) => (
              <div className="p-rationale" key={`${mastery.competency || "competency"}-${index}`}>
                <strong>{mastery.competency || "Unlabelled competency"}</strong>
                <div style={{ fontSize: "0.9em" }}>
                  Developing: {formatNumber(mastery.developing)} · Competent: {formatNumber(mastery.competent)} · Mastered: {formatNumber(mastery.mastered)} · Mastered rate: {formatPercent(mastery.masteredRate)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CohortProfile({ data, error, loading }: { data: any; error: any; loading: boolean }) {
  if (loading) return <p>Loading cohort profile...</p>;
  if (error && !isExpectedNotFound(error, "NO_COHORT_PROFILES")) {
    return (
      <div>
        <p className="learning-critical"><strong>Cohort profile could not be loaded.</strong></p>
        <p>{errorMessage(error, "The cohort profile service returned an error.")}</p>
      </div>
    );
  }
  if (error || !data) return <p className="learning-dim">No saved cohort profiles are available yet.</p>;
  if (data.status === "insufficient_evidence") {
    return (
      <div className="p-rationale">
        <strong className="learning-warning">Insufficient evidence</strong>
        <p style={{ marginTop: "0.35rem", marginBottom: 0 }}>{data.reason || "A cohort profile requires sufficient distinct learners."}</p>
      </div>
    );
  }

  const view = cohortProfileViewModel(data);
  const dims = view.dims;
  const modalityMix = view.modalityMix;
  const recommendations = view.recommendations;
  return (
    <div>
      <p className="learning-dim">Cohort size: {formatNumber(view.n)}. Raw response maps and learner identities are not displayed.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(8rem, 1fr))", gap: "0.5rem" }}>
        {PROFILE_DIMENSIONS.map(([key, label]) => <Metric key={key} label={label} value={dims[key] == null ? "Not enough evidence to display" : formatPercent(dims[key])} />)}
      </div>
      <p className="learning-dim">Each reported statistic needs at least five distinct contributors. Sparse statistics are withheld even when the overall cohort is large enough.</p>
      {modalityMix.length > 0 && (
        <div style={{ marginTop: "1rem" }}>
          <h4>Modality mix</h4>
          <ul style={{ paddingLeft: "1.5rem", marginBottom: 0 }}>
            {modalityMix.map((entry: any, index: number) => <li key={`${entry.modality || "modality"}-${index}`}>{entry.modality || "Unlabelled"} · {formatPercent(entry.share)} · {formatNumber(entry.count)} learner(s)</li>)}
          </ul>
        </div>
      )}
      {recommendations.length > 0 && (
        <div style={{ marginTop: "1rem" }}>
          <h4>Delivery recommendations</h4>
          <ul style={{ paddingLeft: "1.5rem", marginBottom: 0 }}>{recommendations.map((item: unknown, index: number) => <li key={index}>{String(item)}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

export function CourseReporting({
  courseId,
  renderApprovedSyllabus,
  children,
}: {
  courseId: string;
  renderApprovedSyllabus?: () => ReactNode;
  children: ReactNode;
}) {
  const { data: courseData, error: courseError, loading: courseLoading } = useApiQuery<any>(
    `/courses/${encodeURIComponent(courseId)}`,
    { enabled: !!courseId },
  );
  const analytics = useApiQuery<any>(`/analytics/cohort?courseId=${encodeURIComponent(courseId)}`, { enabled: !!courseId });
  const profile = useApiQuery<any>(`/profile/cohort?courseId=${encodeURIComponent(courseId)}`, { enabled: !!courseId });
  const status = String(courseData?.status || courseData?.course?.status || "").toUpperCase();
  const approved = status === "APPROVED";
  const pending = status === "PENDING";

  return (
    <div>
      {courseLoading && <p className="learning-dim">Checking course status...</p>}
      {courseError && (
        <div className="p-panel">
          <h3>Course planning status</h3>
          <p className="learning-critical"><strong>Course status could not be loaded.</strong></p>
          <p>{errorMessage(courseError, "The course record returned an error.")}</p>
          <p className="learning-dim">Syllabus editing is withheld until approval can be verified.</p>
        </div>
      )}
      {approved && renderApprovedSyllabus?.()}
      {!courseLoading && !courseError && !approved && !pending && (
        <p className="learning-dim">Syllabus editing is available after this course is approved.</p>
      )}

      <div className="p-panel">
        <h3>Cohort Reporting (Sextant · Waypoint)</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(18rem, 1fr))", gap: "1rem" }}>
          <div>
            <h4>Progress evidence</h4>
            <CohortSextant data={analytics.data} error={analytics.error} loading={analytics.loading} />
          </div>
          <div>
            <h4>Learning preferences</h4>
            <CohortProfile data={profile.data} error={profile.error} loading={profile.loading} />
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}
