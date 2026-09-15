'use client';

import { useState, useEffect } from 'react';
import { downloadAuthenticated, useApiQuery, useApiMutation } from '../_learning/useLearning';

export function LearnerProfile() {
  const { data: profileData, loading, refetch } = useApiQuery("/profile", { enabled: true });
  const [editing, setEditing] = useState(false);
  const [responses, setResponses] = useState({});
  const saveProfile = useApiMutation("/profile", "POST");

  useEffect(() => {
    if (editing && profileData?.responses) {
      setResponses(profileData.responses);
    }
  }, [editing, profileData]);

  const handleSubmit = async () => {
    try {
      await saveProfile.mutate({ responses });
      setEditing(false);
      refetch();
    } catch (e) {
      alert(e.error || "Failed to save profile");
    }
  };

  if (loading) return <p>Loading profile...</p>;

  return (
    <div>
      <h2 className="p-h">Learning Profile (Waypoint)</h2>
      {profileData && !editing ? (
        <div className="p-panel">
          <h3>Profile Overview</h3>
          <p><strong>Name:</strong> {profileData.profile?.name}</p>
          <p><strong>Dominant Modality:</strong> {profileData.profile?.dominantModality}</p>
          <p><strong>Pace:</strong> {profileData.profile?.pace}</p>
          <p><strong>Structure:</strong> {profileData.profile?.structure}</p>
          <button className="p-btn ghost" onClick={() => setEditing(true)} style={{ marginTop: "1rem" }}>Edit Survey</button>
        </div>
      ) : (
        <div className="p-panel">
          <h3>Waypoint Survey</h3>
          <p style={{ color: "var(--p-dim)", marginBottom: "1rem" }}>Answer these questions to help personalize your learning experience.</p>
          
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <label>
              <span style={{ display: "block", marginBottom: "0.25rem" }}>I prefer visual diagrams over text (1-5)</span>
              <input type="number" min="1" max="5" value={responses["v1"] || ""} onChange={(e) => setResponses({ ...responses, v1: parseInt(e.target.value) || 0 })} className="scw-ti" style={{ width: "100px", padding: "0.5rem" }} />
            </label>
            <label>
              <span style={{ display: "block", marginBottom: "0.25rem" }}>I like hands-on practice (1-5)</span>
              <input type="number" min="1" max="5" value={responses["h1"] || ""} onChange={(e) => setResponses({ ...responses, h1: parseInt(e.target.value) || 0 })} className="scw-ti" style={{ width: "100px", padding: "0.5rem" }} />
            </label>
          </div>
          
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "1.5rem" }}>
            <button className="p-btn ghost" onClick={() => setEditing(false)}>Cancel</button>
            <button className="p-btn" onClick={handleSubmit} disabled={saveProfile.loading}>
              {saveProfile.loading ? "Saving..." : "Save Profile"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function LearnerProgress() {
  const { data: analytics, loading } = useApiQuery("/analytics", { enabled: true });

  if (loading) return <p>Loading progress...</p>;

  return (
    <div>
      <h2 className="p-h">My Progress (Sextant)</h2>
      {analytics ? (
        <div className="p-panel">
          <h3>Progress Overview</h3>
          <p>Scope: {analytics.scope}</p>
          <p>Gain Overall: {JSON.stringify(analytics.gain?.overall)}</p>
          <p>Gaps detected: {analytics.gaps?.length}</p>
          <p>Mastery elements: {analytics.mastery?.length}</p>
          {analytics.mastery?.length > 0 && (
            <div style={{ marginTop: "1rem" }}>
              <h4>Past Mastery Sessions</h4>
              <ul style={{ paddingLeft: "1.5rem" }}>
                {analytics.mastery.map((midx) => (
                  <li key={idx} style={{ marginBottom: "0.5rem" }}>
                    <span style={{ fontWeight: 600, color: m.verdict === "PASS" ? "var(--p-good)" : (m.verdict === "FAIL" ? "var(--p-critical)" : "var(--p-dim)") }}>
                      {m.verdict || "INCOMPLETE"}
                    </span>
                    {" - Score: "}{m.score}
                    {m.courseId && ` (Course: ${m.courseId})`}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <p>No progress data available yet.</p>
      )}
    </div>
  );
}

export function LearnerStudyPlan({ courseId }) {
  const [selectedCourseId, setSelectedCourseId] = useState(courseId || "");
  const { data: planData, loading, refetch, error } = useApiQuery(
    `/study-plan?courseId=${selectedCourseId}`,
    { enabled: !!selectedCourseId }
  );
  const { data: courses } = useApiQuery("/courses");
  const createPlan = useApiMutation("/study-plan", "POST");
  const [availability, setAvailability] = useState(60);

  const handleCreate = async () => {
    if (!selectedCourseId) return;
    try {
      await createPlan.mutate({
        courseId: selectedCourseId,
        asOf: new Date().toISOString().split("T")[0],
        availability,
        ics: { calendarName: "My study plan", startHour: 18 }
      });
      refetch();
    } catch (e) {
      alert(e.error || "Failed to create study plan");
    }
  };

  return (
    <div>
      <h2 className="p-h">Study Plan (Cadence)</h2>
      <div className="p-panel" style={{ marginBottom: "1rem" }}>
        <label>
          <strong>Select Course: </strong>
          <select className="scw-ti" value={selectedCourseId} onChange={e => setSelectedCourseId(e.target.value)} style={{ padding: "0.2rem 0.5rem" }}>
            <option value="">-- Choose a course --</option>
            {courses?.map(c => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>
        </label>
      </div>

      {!selectedCourseId ? (
        <p>Please select a course to view or create a study plan.</p>
      ) : loading ? (
        <p>Loading study plan...</p>
      ) : (planData && !planData.error) ? (
        <div className="p-panel">
          <h3>Current Plan Status: <strong style={{ color: planData.plan?.status === "behind" ? "var(--p-warning)" : "var(--p-good)" }}>{planData.plan?.status || "On track"}</strong></h3>
          <p>Recommended Action: {planData.plan?.recommended}</p>
          <div style={{ marginTop: "1rem" }}>
            <button
              type="button"
              className="p-btn ghost"
              style={{ textDecoration: "none" }}
              onClick={() => downloadAuthenticated(
                `/api/learning/study-plan?courseId=${selectedCourseId}&format=ics`,
                "schoolcircle-study-plan.ics",
              ).catch((error) => alert(error.message))}
            >
              Download ICS Calendar
            </button>
          </div>
        </div>
      ) : (
        <div className="p-panel">
          <p>You don't have a study plan for this course yet.</p>
          <div style={{ marginTop: "1rem", display: "flex", gap: "1rem", alignItems: "center" }}>
            <label>
              Minutes per day:
              <input type="number" className="scw-ti" style={{ width: "80px", marginLeft: "0.5rem", padding: "0.2rem 0.5rem" }} value={availability} onChange={e => setAvailability(parseInt(e.target.value) || 60)} />
            </label>
            <button className="p-btn" onClick={handleCreate} disabled={createPlan.loading}>
              {createPlan.loading ? "Creating..." : "Generate Plan"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
