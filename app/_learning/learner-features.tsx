"use client";

import { useEffect, useState } from "react";
import { downloadAuthenticated, useApiMutation, useApiQuery } from "./use-learning";
import {
  errorMessage,
  isExpectedNotFound,
  isRecord,
  sextantViewModel,
  studyPlanViewModel,
} from "./evidence-ui.js";

const PROFILE_QUESTIONS = [
  ["v1", "I learn best from diagrams, maps, or a live demonstration."],
  ["v2", "A chart helps me more than a paragraph of text."],
  ["b1", "I understand a topic better when someone explains it out loud."],
  ["b2", "Talking it through with others helps it stick."],
  ["r1", "I prefer a written study guide I can reread on my own."],
  ["r2", "I take detailed notes and review them later."],
  ["h1", "I learn by doing the task myself, not watching."],
  ["h2", "I need practical reps before it really sinks in."],
  ["p1", "I do better setting my own schedule than following a fixed one."],
  ["p2", "A rigid class pace tends to slow me down or leave me behind."],
  ["s1", "I want a clear, step-by-step path with explicit objectives."],
  ["s2", "Open-ended, figure-it-out tasks stress me more than they help."],
] as const;

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

function humanize(value: unknown) {
  return String(value || "").replace(/_/g, " ");
}

function profileResponses(data: any) {
  if (isRecord(data?.responses)) return data.responses;
  return {};
}

export function LearnerProfile() {
  const { data: profileData, error, loading, refetch } = useApiQuery<any>("/profile", { enabled: true });
  const [editing, setEditing] = useState(false);
  const [responses, setResponses] = useState<Record<string, number>>({});
  const saveProfile = useApiMutation<any>("/profile", "POST");

  useEffect(() => {
    if (editing) setResponses(profileResponses(profileData));
  }, [editing, profileData]);

  const handleSubmit = async () => {
    try {
      await saveProfile.mutate({ responses });
      setEditing(false);
      await refetch();
    } catch {
      // The mutation error is rendered in the panel below. Do not turn a
      // failed save into an apparently empty or saved profile.
    }
  };

  if (loading) return <p>Loading profile...</p>;

  if (error && !isExpectedNotFound(error, "PROFILE_NOT_FOUND")) {
    return (
      <div>
        <h2 className="p-h">Learning Profile (Waypoint)</h2>
        <div className="p-panel">
          <p className="learning-critical"><strong>Profile could not be loaded.</strong></p>
          <p>{errorMessage(error, "The profile service returned an error.")}</p>
        </div>
      </div>
    );
  }

  const profile = isRecord(profileData?.profile) ? profileData.profile : null;
  const dimensions = isRecord(profile?.dims) ? profile.dims : {};
  const hasSavedProfile = Boolean(profileData && profile);
  const malformedSavedProfile = Boolean(profileData && !profile);

  return (
    <div>
      <h2 className="p-h">Learning Profile (Waypoint)</h2>
      {malformedSavedProfile ? (
        <div className="p-panel">
          <p className="learning-critical"><strong>Saved profile is incomplete.</strong></p>
          <p>The profile response did not include a Waypoint profile. It was not interpreted as an empty survey.</p>
        </div>
      ) : hasSavedProfile && !editing ? (
        <div className="p-panel">
          <h3>Profile Overview</h3>
          <p><strong>Name:</strong> {profile.name || "Authenticated learner"}</p>
          <p><strong>Answered:</strong> {formatNumber(profile.answered)} of {formatNumber(profileData?.profile?.total || PROFILE_QUESTIONS.length)}</p>
          <p><strong>Dominant modality:</strong> {profile.dominantModality || "Not enough answers"}</p>
          <p><strong>Pace:</strong> {dimensions.self_paced == null ? "Flexible (no preference inferred)" : profile.pace || "Not enough answers"}</p>
          <p><strong>Structure:</strong> {dimensions.structured == null ? "Balanced (no preference inferred)" : profile.structure || "Not enough answers"}</p>

          <div style={{ marginTop: "1rem" }}>
            <h4>Dimensions</h4>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(10rem, 1fr))", gap: "0.5rem" }}>
              {PROFILE_DIMENSIONS.map(([key, label]) => (
                <div key={key} className="p-rationale">
                  <strong>{label}</strong>
                  <div>{dimensions[key] == null ? "Not answered" : formatPercent(dimensions[key])}</div>
                </div>
              ))}
            </div>
          </div>

          {Array.isArray(profileData?.recommendations) && profileData.recommendations.length > 0 && (
            <div style={{ marginTop: "1rem" }}>
              <h4>Delivery recommendations</h4>
              <ul style={{ paddingLeft: "1.5rem", marginBottom: 0 }}>
                {profileData.recommendations.map((recommendation: unknown, index: number) => (
                  <li key={index}>{String(recommendation)}</li>
                ))}
              </ul>
            </div>
          )}
          <button className="p-btn ghost" onClick={() => setEditing(true)} style={{ marginTop: "1rem" }}>Edit Survey</button>
        </div>
      ) : (
        <div className="p-panel">
          <h3>{hasSavedProfile ? "Update Waypoint Survey" : "Waypoint Survey"}</h3>
          {!hasSavedProfile && (
            <p className="learning-dim" style={{ marginBottom: "1rem" }}>
              No saved profile yet. Unanswered questions remain unanswered; Waypoint will not infer them.
            </p>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
            {PROFILE_QUESTIONS.map(([id, question]) => (
              <label key={id}>
                <span style={{ display: "block", marginBottom: "0.25rem" }}>{question} (1–5)</span>
                <input
                  type="number"
                  min="1"
                  max="5"
                  step="1"
                  value={responses[id] ?? ""}
                  onChange={(event) => {
                    const raw = event.target.value;
                    const next = { ...responses };
                    if (raw === "") delete next[id];
                    else {
                      const parsed = Number(raw);
                      if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 5) next[id] = parsed;
                    }
                    setResponses(next);
                  }}
                  className="scw-ti"
                  style={{ width: "100px", padding: "0.5rem" }}
                />
              </label>
            ))}
          </div>
          {saveProfile.error && (
            <p className="learning-critical" style={{ marginTop: "1rem" }}>
              {errorMessage(saveProfile.error, "Failed to save profile.")}
            </p>
          )}
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "1.5rem" }}>
            {hasSavedProfile && <button className="p-btn ghost" onClick={() => setEditing(false)}>Cancel</button>}
            <button className="p-btn" onClick={() => void handleSubmit()} disabled={saveProfile.loading}>
              {saveProfile.loading ? "Saving..." : "Save Profile"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function LearnerProgress() {
  const { data: analyticsData, error, loading } = useApiQuery<any>("/analytics", { enabled: true });
  if (loading) return <p>Loading progress...</p>;

  if (error) {
    return (
      <div>
        <h2 className="p-h">My Progress (Sextant)</h2>
        <div className="p-panel">
          <p className="learning-critical"><strong>Progress could not be loaded.</strong></p>
          <p>{errorMessage(error, "The progress service returned an error.")}</p>
        </div>
      </div>
    );
  }

  const analytics = sextantViewModel(analyticsData);
  const hasAnyEvidence = Boolean(
    analytics.gain ||
    analytics.overall ||
    analytics.gaps.length ||
    analytics.mastery.length,
  );
  const gainInsufficient = analytics.gain?.status === "insufficient_evidence";

  return (
    <div>
      <h2 className="p-h">My Progress (Sextant)</h2>
      <div className="p-panel">
        <h3>Learning gain</h3>
        {gainInsufficient ? (
          <div>
            <p className="learning-warning"><strong>Insufficient evidence</strong></p>
            <p>{analytics.gain?.reason || "Saved pre/post attempts with boolean correctness are required."}</p>
          </div>
        ) : analytics.overall ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(9rem, 1fr))", gap: "0.5rem" }}>
            <div className="p-rationale"><strong>Pre</strong><div>{formatPercent(analytics.overall.prePct)}</div></div>
            <div className="p-rationale"><strong>Post</strong><div>{formatPercent(analytics.overall.postPct)}</div></div>
            <div className="p-rationale"><strong>Gain</strong><div>{formatPercent(analytics.overall.gain)}</div></div>
            <div className="p-rationale"><strong>Normalized gain</strong><div>{formatPercent(analytics.overall.normalizedGain)}</div></div>
          </div>
        ) : (
          <p className="learning-dim">No measured pre/post gain yet.</p>
        )}
      </div>

      <div className="p-panel">
        <h3>Objective gaps</h3>
        {analytics.gaps.length === 0 ? (
          <p className="learning-dim">No objective-gap rows were emitted.</p>
        ) : (
          <ul style={{ paddingLeft: "1.5rem", marginBottom: 0 }}>
            {analytics.gaps.map((gap: any, index: number) => (
              <li key={`${gap.objective || "objective"}-${index}`} style={{ marginBottom: "0.5rem" }}>
                <strong>{gap.objective || "Overall"}</strong>
                {" — miss rate "}{formatPercent(gap.missRate)}
                {"; "}{formatNumber(gap.attempts)} attempts
                {gap.cohort != null && `; ${gap.cohort} learner${gap.cohort === 1 ? "" : "s"}`}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="p-panel">
        <h3>Mastery (Whetstone reports rolled up by Sextant)</h3>
        {analytics.mastery.length === 0 ? (
          <p className="learning-dim">No validated mastery criteria have been saved yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
            {analytics.mastery.map((mastery: any, index: number) => (
              <div key={`${mastery.competency || "competency"}-${index}`} className="p-rationale">
                <strong>{mastery.competency || "Unlabelled competency"}</strong>
                <div style={{ fontSize: "0.9em" }}>
                  Developing: {formatNumber(mastery.developing)} · Competent: {formatNumber(mastery.competent)} · Mastered: {formatNumber(mastery.mastered)}
                  {" · Mastered rate: "}{formatPercent(mastery.masteredRate)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {!hasAnyEvidence && (
        <p className="learning-dim">No saved progress evidence is available yet.</p>
      )}
    </div>
  );
}

function StudyPlanCoa({ coa }: { coa: ReturnType<typeof studyPlanViewModel>["coas"][number] }) {
  return (
    <div className="p-rationale" style={{ minHeight: "10rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
        <strong>{coa.label}</strong>
        {coa.recommended && <span className="learning-good">Recommended</span>}
      </div>
      <p style={{ marginTop: "0.5rem", marginBottom: "0.5rem", fontSize: "0.9em" }}>
        {formatNumber(coa.totalMinutes)} minutes · {formatNumber(coa.days)} days · {formatNumber(coa.lateRisk)} late-risk items
      </p>
      {coa.blocks.length === 0 ? (
        <p className="learning-dim" style={{ marginBottom: 0 }}>No scheduled blocks.</p>
      ) : (
        <details>
          <summary>{coa.blocks.length} scheduled block{coa.blocks.length === 1 ? "" : "s"}</summary>
          <ul style={{ paddingLeft: "1.25rem", marginBottom: 0, fontSize: "0.9em" }}>
            {coa.blocks.map((block: any, index: number) => (
              <li key={`${block.date || "block"}-${index}`}>
                {block.date || "Undated"} · {formatNumber(block.minutes)} min · {block.task || block.kind || "Study"}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function LearnerStudyPlan({ courseId }: { courseId?: string } = {}) {
  const [selectedCourseId, setSelectedCourseId] = useState(courseId || "");
  const { data: planData, error, loading, refetch } = useApiQuery<any>(
    `/study-plan?courseId=${encodeURIComponent(selectedCourseId)}`,
    { enabled: !!selectedCourseId },
  );
  const { data: courses, error: coursesError } = useApiQuery<any[]>("/courses");
  const createPlan = useApiMutation<any>("/study-plan", "POST");
  const [availability, setAvailability] = useState(60);

  const handleCreate = async () => {
    if (!selectedCourseId) return;
    try {
      await createPlan.mutate({
        courseId: selectedCourseId,
        asOf: new Date().toISOString().split("T")[0],
        availability,
        ics: { calendarName: "My study plan", startHour: 18 },
      });
      await refetch();
    } catch {
      // Keep the explicit mutation error in the empty/error panel.
    }
  };

  const plan = studyPlanViewModel(planData);
  const expectedEmpty = isExpectedNotFound(error, "STUDY_PLAN_NOT_FOUND");
  const malformedSavedPlan = Boolean(planData && !plan.plan);

  return (
    <div>
      <h2 className="p-h">Study Plan (Cadence)</h2>
      <div className="p-panel" style={{ marginBottom: "1rem" }}>
        <label>
          <strong>Select Course: </strong>
          <select className="scw-ti" value={selectedCourseId} onChange={(event) => setSelectedCourseId(event.target.value)} style={{ padding: "0.2rem 0.5rem" }}>
            <option value="">-- Choose a course --</option>
            {Array.isArray(courses) && courses.map((course: any) => <option key={course.id} value={course.id}>{course.title}</option>)}
          </select>
        </label>
        {coursesError && <p className="learning-critical" style={{ marginTop: "0.75rem", marginBottom: 0 }}>{errorMessage(coursesError, "Courses could not be loaded.")}</p>}
      </div>

      {!selectedCourseId ? (
        <p className="learning-dim">Select a course to view or create a study plan.</p>
      ) : loading ? (
        <p>Loading study plan...</p>
      ) : error && !expectedEmpty ? (
        <div className="p-panel">
          <p className="learning-critical"><strong>Study plan could not be loaded.</strong></p>
          <p>{errorMessage(error, "The planning service returned an error.")}</p>
        </div>
      ) : malformedSavedPlan ? (
        <div className="p-panel">
          <p className="learning-critical"><strong>Saved study plan is incomplete.</strong></p>
          <p>The planning response did not include a Cadence plan. No replacement schedule was inferred.</p>
        </div>
      ) : planData && plan.plan ? (
        <div className="p-panel">
          <h3>
            Current plan status:{" "}
            <strong className={plan.plan.status === "behind" ? "learning-warning" : plan.plan.status === "ahead" ? "learning-good" : ""}>
              {humanize(plan.plan.status || "on_track")}
            </strong>
          </h3>
          <p>Recommended course of action: <strong>{humanize(plan.plan.recommended || "Not set")}</strong></p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(13rem, 1fr))", gap: "0.75rem", marginTop: "1rem" }}>
            {plan.coas.map((coa) => <StudyPlanCoa key={coa.key} coa={coa} />)}
          </div>
          {plan.selectedBlocks.length === 0 && (
            <p className="learning-dim" style={{ marginTop: "1rem" }}>The recommended course of action has no scheduled blocks.</p>
          )}
          <div style={{ marginTop: "1rem" }}>
            <button type="button" className="p-btn ghost" onClick={() => downloadAuthenticated(`/api/learning/study-plan?courseId=${encodeURIComponent(selectedCourseId)}&format=ics`, "schoolcircle-study-plan.ics").catch((downloadError) => alert(downloadError.message))}>
              Download calendar (.ics)
            </button>
          </div>
        </div>
      ) : (
        <div className="p-panel">
          <h3>No saved plan yet</h3>
          <p className="learning-dim">Cadence will use the instructor&apos;s saved syllabus, dated entries, and your available time. It will not invent missing syllabus dates.</p>
          {createPlan.error && (
            <p className="learning-critical">{errorMessage(createPlan.error, "Failed to create study plan.")}</p>
          )}
          <div style={{ marginTop: "1rem", display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
            <label>
              Minutes per day:
              <input type="number" min="1" className="scw-ti" style={{ width: "90px", marginLeft: "0.5rem", padding: "0.2rem 0.5rem" }} value={availability} onChange={(event) => setAvailability(Math.max(1, Number(event.target.value) || 60))} />
            </label>
            <button className="p-btn" onClick={() => void handleCreate()} disabled={createPlan.loading}>
              {createPlan.loading ? "Creating..." : "Generate Plan"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}