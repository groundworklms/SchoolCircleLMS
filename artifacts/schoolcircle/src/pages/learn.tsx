import React, { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import "../prototype/student.css";
import { I, RailButton, UserMenu } from "../prototype/shell";
import { useAuthUser, useLearningStatus, useApiQuery, useApiMutation } from "../hooks/use-learning";
import { LearnerProfile, LearnerProgress, LearnerStudyPlan } from "./learner-features";
import { LearnerTutor, SourceViewer } from "./learner-tutor";

export default function LearnApp() {
  const [location, setLocation] = useLocation();
  const [area, setArea] = useState("dashboard"); // dashboard, courses, study-plan, progress, profile
  const [activeCourseId, setActiveCourseId] = useState<string | null>(null);

  const { user, loading: userLoading } = useAuthUser();
  const { status, error, loading: statusLoading } = useLearningStatus();
  const { data: coursesData, loading: coursesLoading } = useApiQuery<any[]>("/courses");

  if (statusLoading || userLoading) return <div className="s-root" style={{ padding: "2rem" }}>Loading...</div>;
  
  if (!status?.auth?.ready || !user) {
    return (
      <div className="s-root" style={{ padding: "2rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
        <h2>Authentication Required</h2>
        <p>{status?.auth?.reason || "Please log in to continue."}</p>
        <a href="/api/login?returnTo=/learn" className="p-btn" style={{ width: "max-content" }}>Log in</a>
      </div>
    );
  }

  const courses = coursesData || [];
  const learnerName = user.name || "Learner";
  const learnerInitials = learnerName.charAt(0).toUpperCase();

  return (
    <div className="s-root">
      <nav className="s-rail">
        <UserMenu
          name={learnerName}
          role={user.role || "Learner"}
          initials={learnerInitials}
          inst={false}
          items={[
            { label: 'Settings', hint: 'Reminders · How I learn', onClick: () => {} },
            { label: 'Sign out', danger: true, onClick: () => { window.location.href = '/api/logout?returnTo=/'; } },
          ]}
        />
        <RailButton icon={I.dashboard} label="Dashboard" on={area === 'dashboard'} onClick={() => setArea('dashboard')} />
        <RailButton icon={I.courses} label="Courses" on={area === 'courses'} onClick={() => setArea('courses')} />
        <RailButton icon={I.calendar} label="Study Plan" on={area === 'study-plan'} onClick={() => setArea('study-plan')} />
        <RailButton icon={I.dashboard} label="Progress" on={area === 'progress'} onClick={() => setArea('progress')} />
        <RailButton icon={I.dashboard} label="Profile" on={area === 'profile'} onClick={() => setArea('profile')} />

        <div className="s-rail-sec">My courses</div>
        {courses.map((c: any) => (
          <RailButton
            key={c.id}
            sub
            icon={<span className="s-rail-dot" style={{ background: "var(--p-dim)" }} />}
            label={c.title || "Course"}
            onClick={() => {
              setArea("course");
              setActiveCourseId(c.id);
            }}
          />
        ))}

        <div className="s-rail-spacer" />
        <RailButton icon={I.swap} label="View as instructor" onClick={() => setLocation("/teach")} />
        <RailButton icon={I.back} label="Planning board" onClick={() => setLocation("/plan")} />
      </nav>

      <div className="s-content">
        <div className="s-crumbs">
          <span className="s-crumb-cur">{area === "course" ? "Course view" : "Dashboard"}</span>
        </div>
        <main className="s-main">
          <div className="s-container">
            {coursesLoading && <p>Loading courses...</p>}
            {area === "dashboard" && !coursesLoading && (
              <div>
                <h2>Dashboard</h2>
                {courses.length === 0 ? (
                  <p>No approved courses available.</p>
                ) : (
                  <div className="p-grid2">
                    {courses.map((c: any) => (
                      <div key={c.id} className="p-panel" onClick={() => { setArea("course"); setActiveCourseId(c.id); }} style={{ cursor: "pointer" }}>
                        <h3>{c.title}</h3>
                        <p style={{ color: "var(--p-dim)", fontSize: "0.85em" }}>{c.sections?.length || 0} sections</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {area === "course" && activeCourseId && (
              <CourseView key={activeCourseId} courseId={activeCourseId} />
            )}
            {area === "study-plan" && <LearnerStudyPlan />}
            {area === "progress" && <LearnerProgress />}
            {area === "profile" && <LearnerProfile />}
          </div>
        </main>
      </div>
    </div>
  );
}

function CourseView({ courseId }: { courseId: string }) {
  const { data: courseEnvelope, loading } = useApiQuery<any>(`/courses/${courseId}`);
  if (loading) return <p>Loading course details...</p>;
  if (!courseEnvelope || !courseEnvelope.course) return <p>Course not found</p>;

  const course = courseEnvelope.course;
  const sourceId = course.sourceIds?.[0]; // If there's an associated sourceId

  return (
    <div>
      <h2>{course.title || courseEnvelope.title || "Course"}</h2>
      <p>Course ID: {courseEnvelope.id}</p>
      
      <div style={{ marginTop: "2rem" }}>
        <h3>Mastery Session</h3>
        <MasteryWidget sourceId={sourceId} courseId={courseEnvelope.id} />
      </div>

      {sourceId && <LearnerTutor sourceId={sourceId} />}
      {sourceId && <SourceViewer sourceId={sourceId} />}
    </div>
  );
}

function MasteryWidget({ sourceId, courseId }: { sourceId?: string, courseId: string }) {
  const { data: sessions, loading, refetch } = useApiQuery<any[]>(`/mastery/sessions?courseId=${courseId}`, { enabled: !!courseId });
  const startSession = useApiMutation<any>("/mastery/sessions", "POST");
  const [answer, setAnswer] = useState("");

  const activeSession = sessions?.find(s => s.status === "ACTIVE") || sessions?.[0];
  const turnSession = useApiMutation<any>(`/mastery/sessions/${activeSession?.id}/turn`, "POST");

  const handleStart = async () => {
    if (!sourceId) return alert("No source document associated with this course.");
    try {
      await startSession.mutate({ sourceId, courseId });
      refetch();
    } catch (err: any) {
      console.error(err);
      alert(err.error || "Failed to start session");
    }
  };

  const handleTurn = async () => {
    if (!answer.trim() || !activeSession) return;
    try {
      await turnSession.mutate({ answer });
      setAnswer("");
      refetch();
    } catch (err: any) {
      console.error(err);
      if (err.code === "409" || err.status === 409 || String(err.message).includes("409")) {
        alert("Session state changed. Refreshing...");
        refetch();
      } else {
        alert(err.error || "Failed to submit answer");
      }
    }
  };

  if (loading) return <div className="p-panel"><p>Loading mastery session...</p></div>;

  if (!activeSession) {
    return (
      <div className="p-panel">
        <p>Test your knowledge with Whetstone</p>
        <button className="p-btn" onClick={handleStart} disabled={startSession.loading}>
          {startSession.loading ? "Starting..." : "Start Mastery Session"}
        </button>
      </div>
    );
  }

  return (
    <div className="p-panel">
      <h4>{activeSession.currentQuestion || "Session initialized."}</h4>
      
      {activeSession.report?.feedback && (
        <div className="p-rationale" style={{ marginBottom: "1rem" }}>
          <strong>Feedback: </strong> {activeSession.report.feedback}
        </div>
      )}

      {activeSession.status === "COMPLETE" ? (
        <p>Session Complete! Score: {activeSession.report?.score}</p>
      ) : (
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
          <input 
            type="text" 
            className="scw-ti" 
            style={{ flex: 1, padding: "0.5rem" }} 
            value={answer} 
            onChange={(e) => setAnswer(e.target.value)} 
            onKeyDown={(e) => { if (e.key === "Enter") handleTurn(); }}
          />
          <button className="p-btn" onClick={handleTurn} disabled={turnSession.loading}>
            {turnSession.loading ? "..." : "Submit"}
          </button>
        </div>
      )}
    </div>
  );
}
