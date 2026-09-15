import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import "../prototype/student.css";
import { I, RailButton, UserMenu } from "../prototype/shell";
import { downloadAuthenticated, useAuthUser, useLearningStatus, useApiQuery, useApiMutation } from "../hooks/use-learning";
import { InstructorFidelity, InstructorAAR, InstructorSyllabus, RubricsView } from "./instructor-features";

export default function TeachApp() {
  const [location, setLocation] = useLocation();
  const [area, setArea] = useState("sources");

  const { user, loading: userLoading } = useAuthUser();
  const { status, loading: statusLoading } = useLearningStatus();

  if (statusLoading || userLoading) return <div className="s-root" style={{ padding: "2rem" }}>Loading...</div>;
  if (!status?.auth?.ready || !user) {
    return (
      <div className="s-root" style={{ padding: "2rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
        <h2>Authentication Required</h2>
        <p>{status?.auth?.reason || "Please log in to continue."}</p>
        <a href="/api/login?returnTo=/teach" className="p-btn" style={{ width: "max-content" }}>Log in</a>
      </div>
    );
  }

  if (user.role === "LEARNER") {
    return (
      <div className="s-root" style={{ padding: "2rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
        <h2>Instructor Access Required</h2>
        <p>You are logged in as a Learner. This area is restricted to Instructors.</p>
        <a href="/learn" className="p-btn" style={{ width: "max-content" }}>Go to Learner App</a>
      </div>
    );
  }

  const instName = user.name || "Instructor";
  const instInitials = instName.charAt(0).toUpperCase();

  return (
    <div className="s-root i-root">
      <nav className="s-rail">
        <UserMenu
          name={instName}
          role={user.role || "Instructor"}
          initials={instInitials}
          inst={true}
          items={[
            { label: 'Settings', onClick: () => {} },
            { label: 'Sign out', danger: true, onClick: () => { window.location.href = '/api/logout?returnTo=/'; } },
          ]}
        />
        
        <div className="s-rail-sec">Library</div>
        <RailButton icon={I.dashboard} label="Sources" on={area === 'sources'} onClick={() => setArea('sources')} />
        <RailButton icon={I.courses} label="Courses" on={area === 'courses'} onClick={() => setArea('courses')} />
        <RailButton icon={I.dashboard} label="Rubrics" on={area === 'rubrics'} onClick={() => setArea('rubrics')} />
        
        <div className="s-rail-spacer" />
        <RailButton icon={I.swap} label="View as learner" onClick={() => setLocation("/learn")} />
        <RailButton icon={I.back} label="Planning board" onClick={() => setLocation("/plan")} />
      </nav>

      <div className="s-content">
        <div className="s-crumbs">
          <span className="s-crumb-cur">Instructor / {area === "sources" ? "Sources" : "Courses"}</span>
        </div>
        <main className="s-main">
          <div className="s-container" style={{ maxWidth: "60rem" }}>
            {area === "sources" && <SourcesView />}
            {area === "courses" && <CoursesView />}
            {area === "rubrics" && <RubricsView />}
          </div>
        </main>
      </div>
    </div>
  );
}

function SourcesView() {
  const { data: sources, loading, refetch } = useApiQuery<any[]>("/sources");
  
  if (loading) return <p>Loading sources...</p>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h2 className="p-h">Source Documents</h2>
        <IngestSourceModal onIngested={refetch} />
      </div>
      
      {(!sources || sources.length === 0) ? (
        <p>No sources found.</p>
      ) : (
        <div className="p-grid2">
          {sources.map((src) => (
            <SourceCard key={src.id} source={src} onApproved={refetch} />
          ))}
        </div>
      )}
    </div>
  );
}

function SourceCard({ source, onApproved }: { source: any, onApproved: () => void }) {
  const [open, setOpen] = useState(false);
  const approve = useApiMutation(`/sources/${source.id}/approve`, "POST");
  const { data: sourceDetail } = useApiQuery<any>(`/sources/${source.id}`, { enabled: open });

  const handleApprove = async () => {
    try {
      await approve.mutate();
      onApproved();
    } catch (e: any) {
      alert(e.error || "Failed to approve source");
    }
  };

  return (
    <div className="p-panel">
      <h3>{source.title}</h3>
      <p style={{ fontSize: "0.85em", color: "var(--p-dim)", marginBottom: "1rem" }}>
        ID: {source.id}<br/>
        Status: <strong style={{ color: source.status === "APPROVED" ? "var(--p-good)" : "var(--p-warning)" }}>{source.status}</strong>
      </p>

      {!open ? (
        <button className="p-btn ghost" onClick={() => setOpen(true)} style={{ marginBottom: "1rem", marginRight: "0.5rem" }}>Inspect Source</button>
      ) : (
        <div style={{ background: "var(--p-surface-2)", padding: "1rem", borderRadius: "8px", marginBottom: "1rem", fontSize: "0.85em" }}>
          <button className="p-btn ghost" onClick={() => setOpen(false)} style={{ marginBottom: "1rem" }}>Close Source</button>
          {sourceDetail ? (
            <div style={{ maxHeight: "300px", overflowY: "auto", whiteSpace: "pre-wrap" }}>
              {sourceDetail.text || sourceDetail.pages?.map((p: any) => p.text).join("\n\n") || "No content."}
            </div>
          ) : (
            <p>Loading details...</p>
          )}
        </div>
      )}
      
      {source.status === "PENDING" && (
        <button className="p-btn" onClick={handleApprove} disabled={approve.loading}>
          {approve.loading ? "Approving..." : "Approve Source"}
        </button>
      )}
    </div>
  );
}

function IngestSourceModal({ onIngested }: { onIngested: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const ingest = useApiMutation<any>("/sources", "POST");

  const handleSubmit = async () => {
    if (!title || !text) return;
    try {
      await ingest.mutate({ title, text });
      setOpen(false);
      setTitle("");
      setText("");
      onIngested();
    } catch (e: any) {
      alert(e.error || "Failed to ingest source");
    }
  };

  if (!open) return <button className="p-btn" onClick={() => setOpen(true)}>Add Source</button>;

  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="p-panel" style={{ width: "400px", maxWidth: "90%" }}>
        <h3 style={{ fontSize: "1.1em", marginBottom: "1rem" }}>Ingest New Source</h3>
        <input 
          className="scw-ti" 
          placeholder="Source Title" 
          value={title} 
          onChange={e => setTitle(e.target.value)} 
          style={{ width: "100%", padding: "0.5rem", marginBottom: "0.5rem" }} 
        />
        <textarea 
          className="scw-ti" 
          placeholder="Paste source text here..." 
          value={text} 
          onChange={e => setText(e.target.value)} 
          rows={6}
          style={{ width: "100%", padding: "0.5rem", marginBottom: "1rem" }} 
        />
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <button className="p-btn ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button className="p-btn" onClick={handleSubmit} disabled={ingest.loading || !title || !text}>
            {ingest.loading ? "Ingesting..." : "Ingest"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CoursesView() {
  const { data: courses, loading, refetch } = useApiQuery<any[]>("/courses");
  const { data: sources } = useApiQuery<any[]>("/sources");
  const approvedSources = sources?.filter(s => s.status === "APPROVED") || [];

  if (loading) return <p>Loading courses...</p>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h2 className="p-h">Course Drafts</h2>
        <DraftCourseModal sources={approvedSources} onDrafted={refetch} />
      </div>

      {(!courses || courses.length === 0) ? (
        <p>No courses found.</p>
      ) : (
        <div className="p-grid2">
          {courses.map(course => (
            <CourseCard key={course.id} course={course} onApproved={refetch} />
          ))}
        </div>
      )}
    </div>
  );
}

function CourseCard({ course, onApproved }: { course: any, onApproved: () => void }) {
  const [open, setOpen] = useState(false);
  const approve = useApiMutation(`/courses/${course.id}/approve`, "POST");
  const { data: courseDetail } = useApiQuery<any>(`/courses/${course.id}`, { enabled: open });

  const handleApprove = async () => {
    try {
      await approve.mutate();
      onApproved();
    } catch (e: any) {
      alert(e.error || "Failed to approve course");
    }
  };

  return (
    <div className="p-panel">
      <h3>{course.title}</h3>
      <p style={{ fontSize: "0.85em", color: "var(--p-dim)", marginBottom: "1rem" }}>
        Status: <strong style={{ color: course.status === "APPROVED" ? "var(--p-good)" : "var(--p-warning)" }}>{course.status}</strong>
      </p>
      
      {!open ? (
        <button className="p-btn ghost" onClick={() => setOpen(true)} style={{ marginBottom: "1rem", marginRight: "0.5rem" }}>Inspect Draft</button>
      ) : (
        <div style={{ background: "var(--p-surface-2)", padding: "1rem", borderRadius: "8px", marginBottom: "1rem", fontSize: "0.85em" }}>
          <button className="p-btn ghost" onClick={() => setOpen(false)} style={{ marginBottom: "1rem" }}>Close Draft</button>
          {courseDetail ? (
            <div>
              <p><strong>Title:</strong> {courseDetail.course?.title}</p>
              <p><strong>Sections:</strong> {courseDetail.course?.sections?.length || 0}</p>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.9em", color: "var(--p-dim)" }}>
                {JSON.stringify(courseDetail.course?.sections, null, 2)}
              </pre>
            </div>
          ) : (
            <p>Loading details...</p>
          )}
        </div>
      )}

      {course.status === "PENDING" && (
        <button className="p-btn" onClick={handleApprove} disabled={approve.loading} style={{ marginBottom: "1rem" }}>
          {approve.loading ? "Approving..." : "Approve Course"}
        </button>
      )}

      {course.status === "APPROVED" && (
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
          <button
            type="button"
            className="p-btn ghost"
            style={{ textDecoration: "none" }}
            onClick={() => downloadAuthenticated(
              `/api/learning/export?courseId=${course.id}&version=1.2`,
              `${course.id}-scorm-1.2.zip`,
            ).catch((error) => alert(error.message))}
          >
            Export SCORM 1.2
          </button>
          <button
            type="button"
            className="p-btn ghost"
            style={{ textDecoration: "none" }}
            onClick={() => downloadAuthenticated(
              `/api/learning/export?courseId=${course.id}&version=2004`,
              `${course.id}-scorm-2004.zip`,
            ).catch((error) => alert(error.message))}
          >
            Export SCORM 2004
          </button>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {course.status === "PENDING" && <InstructorSyllabus courseId={course.id} />}
        <InstructorFidelity courseId={course.id} />
        <InstructorAAR courseId={course.id} />
      </div>
    </div>
  );
}

function DraftCourseModal({ sources, onDrafted }: { sources: any[], onDrafted: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [sourceId, setSourceId] = useState("");
  const draft = useApiMutation<any>("/courses/draft", "POST");

  const handleSubmit = async () => {
    if (!title || !objective || !sourceId) return;
    try {
      await draft.mutate({
        title,
        objectives: [objective],
        sourceIds: [sourceId],
        diagrams: false
      });
      setOpen(false);
      setTitle("");
      setObjective("");
      setSourceId("");
      onDrafted();
    } catch (e: any) {
      alert(e.error || "Failed to draft course");
    }
  };

  if (!open) return <button className="p-btn" onClick={() => setOpen(true)}>Draft Course</button>;

  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="p-panel" style={{ width: "400px", maxWidth: "90%" }}>
        <h3 style={{ fontSize: "1.1em", marginBottom: "1rem" }}>Draft New Course</h3>
        <input 
          className="scw-ti" 
          placeholder="Course Title" 
          value={title} 
          onChange={e => setTitle(e.target.value)} 
          style={{ width: "100%", padding: "0.5rem", marginBottom: "0.5rem" }} 
        />
        <input 
          className="scw-ti" 
          placeholder="Primary Objective (e.g. Explain the standard)" 
          value={objective} 
          onChange={e => setObjective(e.target.value)} 
          style={{ width: "100%", padding: "0.5rem", marginBottom: "0.5rem" }} 
        />
        <select
          className="scw-ti"
          value={sourceId}
          onChange={e => setSourceId(e.target.value)}
          style={{ width: "100%", padding: "0.5rem", marginBottom: "1rem" }}
        >
          <option value="">Select an Approved Source...</option>
          {sources.map(s => (
            <option key={s.id} value={s.id}>{s.title}</option>
          ))}
        </select>
        
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <button className="p-btn ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button className="p-btn" onClick={handleSubmit} disabled={draft.loading || !title || !objective || !sourceId}>
            {draft.loading ? "Drafting..." : "Draft"}
          </button>
        </div>
      </div>
    </div>
  );
}
