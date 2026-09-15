"use client";

import { signOutOfSchoolCircle } from "../../lib/firebase.js";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { I, RailButton, UserMenu } from "./shell";
import { InstructorAAR, InstructorFidelity, InstructorSyllabus, RubricsView } from "./instructor-features";
import { downloadAuthenticated, useApiMutation, useApiQuery, useAuthUser, useLearningStatus } from "./use-learning";
import styles from "./learning.module.css";

type RefreshHandler = () => void | Promise<void>;

function apiErrorMessage(error: any, fallback: string) {
  const message = typeof error === "string"
    ? error
    : error?.error || error?.message || error?.detail;
  return typeof message === "string" && message.trim() ? message : fallback;
}

function SourceMaterial({ source }: { source: any }) {
  const pages = Array.isArray(source?.pages) ? source.pages : [];
  const chunks = Array.isArray(source?.chunks) ? source.chunks : [];

  if (pages.length > 0) {
    return (
      <div className="source-document">
        {pages.map((page: any, index: number) => (
          <div key={`page-${page?.page ?? index + 1}`} style={{ marginBottom: "1rem" }}>
            <strong className="learning-dim" style={{ display: "block", marginBottom: "0.25rem" }}>
              Page {page?.page ?? index + 1}
            </strong>
            <p style={{ margin: 0 }}>{page?.text || "No text available for this page."}</p>
          </div>
        ))}
      </div>
    );
  }

  if (chunks.length > 0) {
    return (
      <div className="source-document">
        {chunks.map((chunk: any, index: number) => (
          <div key={`chunk-${index}`} style={{ marginBottom: "1rem" }}>
            <strong className="learning-dim" style={{ display: "block", marginBottom: "0.25rem" }}>
              Chunk {index + 1}
            </strong>
            <p style={{ margin: 0 }}>{chunk?.text || "No text available for this chunk."}</p>
          </div>
        ))}
      </div>
    );
  }

  return <div className="source-document">{source?.text || "No content available."}</div>;
}

export default function TeachApp() {
  const router = useRouter();
  const [area, setArea] = useState("sources");
  const { user, loading: userLoading } = useAuthUser();
  const { status, loading: statusLoading } = useLearningStatus();

  if (statusLoading || userLoading) return <div className={`${styles.learningRoot} s-root`} style={{ padding: "2rem" }}>Loading...</div>;
  if (!status?.auth?.ready || !user) {
    return (
      <div className={`${styles.learningRoot} s-root learning-gate`}>
        <h2>Authentication Required</h2>
        <p>{status?.auth?.reason || "Please log in to continue."}</p>
        <a href="/login?next=%2Fteach" className="p-btn" style={{ width: "max-content" }}>Sign in with email or Google</a>
        <a href="/api/login?returnTo=/teach" className="p-btn ghost" style={{ width: "max-content" }}>Sign in with Replit</a>
      </div>
    );
  }
  if (user.role === "LEARNER") {
    return (
      <div className={`${styles.learningRoot} s-root learning-gate`}>
        <h2>Instructor Access Required</h2>
        <p>You are logged in as a Learner. This area is restricted to Instructors.</p>
        <a href="/learn" className="p-btn" style={{ width: "max-content" }}>Go to Learner App</a>
      </div>
    );
  }

  const instName = user.name || "Instructor";
  return (
    <div className={`${styles.learningRoot} s-root i-root`}>
      <nav className="s-rail">
        <UserMenu
          name={instName}
          role={user.role || "Instructor"}
          initials={instName.charAt(0).toUpperCase()}
          inst
          items={[
            { label: "Settings", onClick: () => {} },
            { label: "Sign out", danger: true, onClick: () => { void signOutOfSchoolCircle(); } },
          ]}
        />
        <div className="s-rail-sec">Library</div>
        <RailButton icon={I.dashboard} label="Sources" on={area === "sources"} onClick={() => setArea("sources")} />
        <RailButton icon={I.courses} label="Courses" on={area === "courses"} onClick={() => setArea("courses")} />
        <RailButton icon={I.dashboard} label="Rubrics" on={area === "rubrics"} onClick={() => setArea("rubrics")} />
        <div className="s-rail-spacer" />
        <RailButton icon={I.swap} label="View as learner" onClick={() => router.push("/learn")} />
        <RailButton icon={I.back} label="Planning board" onClick={() => router.push("/plan")} />
      </nav>
      <div className="s-content">
        <div className="s-crumbs"><span className="s-crumb-cur">Instructor / {area === "sources" ? "Sources" : area === "courses" ? "Courses" : "Rubrics"}</span></div>
        <main className="s-main"><div className="s-container instructor-container">
          {area === "sources" && <SourcesView />}
          {area === "courses" && <CoursesView />}
          {area === "rubrics" && <RubricsView />}
        </div></main>
      </div>
    </div>
  );
}

function SourcesView() {
  const { data: sources, loading, error, refetch } = useApiQuery<any[]>("/sources");
  const [feedback, setFeedback] = useState("");
  const sourceList = Array.isArray(sources) ? sources : [];
  const handleIngested = async () => {
    setFeedback("Source added successfully.");
    await refetch();
  };

  if (loading && !sources) return <p>Loading sources...</p>;
  if (error && !sources) {
    return (
      <div role="alert">
        <p className="learning-critical">{apiErrorMessage(error, "Unable to load sources.")}</p>
        <button className="p-btn ghost" onClick={() => void refetch()}>Retry</button>
      </div>
    );
  }

  return (
    <div>
      <div className="view-heading"><h2 className="p-h">Source Documents</h2><IngestSourceModal onIngested={handleIngested} /></div>
      {feedback && <p className="learning-good" role="status">{feedback}</p>}
      {error && <p className="learning-critical" role="alert">{apiErrorMessage(error, "Unable to refresh sources.")}</p>}
      {loading && sources && <p className="learning-dim">Refreshing sources...</p>}
      {sourceList.length === 0 ? <p>No sources found.</p> : <div className="p-grid2">{sourceList.map((source: any) => <SourceCard key={source.id} source={source} onApproved={refetch} />)}</div>}
    </div>
  );
}

function SourceCard({ source, onApproved }: { source: any; onApproved: RefreshHandler }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(source.status);
  const [actionError, setActionError] = useState("");
  const [feedback, setFeedback] = useState("");
  const approve = useApiMutation<{ status?: string }>(`/sources/${source.id}/approve`, "POST");
  const {
    data: sourceDetail,
    error: sourceDetailError,
    loading: sourceDetailLoading,
    refetch: refetchDetail,
  } = useApiQuery<any>(`/sources/${source.id}`, { enabled: open });

  useEffect(() => {
    setStatus(source.status);
  }, [source.status]);

  const handleApprove = async () => {
    setActionError("");
    setFeedback("");
    try {
      const result = await approve.mutate();
      setStatus(result?.status || "APPROVED");
      await onApproved();
      if (open) await refetchDetail();
      setFeedback("Source approved successfully.");
    } catch (error: any) {
      setActionError(apiErrorMessage(error, "Failed to approve source."));
    }
  };

  const sourceStatus = status || source.status;

  return (
    <div className="p-panel">
      <h3>{source.title || "Untitled source"}</h3>
      <p className="learning-dim source-meta">ID: {source.id}<br />Status: <strong className={sourceStatus === "APPROVED" ? "learning-good" : "learning-warning"}>{sourceStatus}</strong></p>
      {actionError && <p className="learning-critical" role="alert">{actionError}</p>}
      {feedback && <p className="learning-good" role="status">{feedback}</p>}
      {!open ? <button className="p-btn ghost" onClick={() => setOpen(true)} style={{ marginBottom: "1rem", marginRight: "0.5rem" }}>Inspect Source</button> : (
        <div className="source-inspect">
          <button className="p-btn ghost" onClick={() => setOpen(false)} style={{ marginBottom: "1rem" }}>Close Source</button>
          {sourceDetailError ? (
            <div role="alert">
              <p className="learning-critical">{apiErrorMessage(sourceDetailError, "Unable to load source details.")}</p>
              <button className="p-btn ghost" onClick={() => void refetchDetail()}>Retry</button>
            </div>
          ) : sourceDetail ? (
            <div className="source-inspect-content">
              {sourceDetailLoading && <p className="learning-dim">Refreshing source details...</p>}
              <SourceMaterial source={sourceDetail} />
            </div>
          ) : (
            <p>Loading source details...</p>
          )}
        </div>
      )}
      {sourceStatus === "PENDING" && <button className="p-btn" onClick={() => void handleApprove()} disabled={approve.loading}>{approve.loading ? "Approving..." : "Approve Source"}</button>}
    </div>
  );
}

function IngestSourceModal({ onIngested }: { onIngested: RefreshHandler }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const ingest = useApiMutation<any>("/sources", "POST");
  const handleSubmit = async () => {
    if (!title.trim() || !text.trim()) {
      setError("A source title and source text are required.");
      return;
    }
    setError("");
    try {
      await ingest.mutate({ title, text });
      await onIngested();
      setOpen(false); setTitle(""); setText("");
    } catch (error: any) {
      setError(apiErrorMessage(error, "Failed to ingest source."));
    }
  };
  if (!open) return <button className="p-btn" onClick={() => { setError(""); setOpen(true); }}>Add Source</button>;
  return (
    <div className="learning-modal">
      <div className="p-panel learning-modal-panel">
        <h3>Ingest New Source</h3>
        {error && <p className="learning-critical" role="alert">{error}</p>}
        <input className="scw-ti" placeholder="Source Title" value={title} onChange={(event) => setTitle(event.target.value)} style={{ width: "100%", padding: "0.5rem", marginBottom: "0.5rem" }} />
        <textarea className="scw-ti" placeholder="Paste source text here..." value={text} onChange={(event) => setText(event.target.value)} rows={6} style={{ width: "100%", padding: "0.5rem", marginBottom: "1rem" }} />
        <div className="modal-actions"><button className="p-btn ghost" onClick={() => setOpen(false)}>Cancel</button><button className="p-btn" onClick={() => void handleSubmit()} disabled={ingest.loading || !title.trim() || !text.trim()}>{ingest.loading ? "Ingesting..." : "Ingest"}</button></div>
      </div>
    </div>
  );
}

function CoursesView() {
  const { data: courses, loading, error, refetch } = useApiQuery<any[]>("/courses");
  const {
    data: sources,
    loading: sourcesLoading,
    error: sourcesError,
    refetch: refetchSources,
  } = useApiQuery<any[]>("/sources");
  const [feedback, setFeedback] = useState("");
  const courseList = Array.isArray(courses) ? courses : [];
  const approvedSources = Array.isArray(sources)
    ? sources.filter((source: any) => source.status === "APPROVED")
    : [];
  const handleDrafted = async () => {
    setFeedback("Course draft created successfully.");
    await refetch();
  };

  if (loading && !courses) return <p>Loading courses...</p>;
  if (error && !courses) {
    return (
      <div role="alert">
        <p className="learning-critical">{apiErrorMessage(error, "Unable to load courses.")}</p>
        <button className="p-btn ghost" onClick={() => void refetch()}>Retry</button>
      </div>
    );
  }

  return (
    <div>
      <div className="view-heading"><h2 className="p-h">Course Drafts</h2><DraftCourseModal sources={approvedSources} loadingSources={sourcesLoading} sourceError={sourcesError} onRetrySources={refetchSources} onDrafted={handleDrafted} /></div>
      {feedback && <p className="learning-good" role="status">{feedback}</p>}
      {error && <p className="learning-critical" role="alert">{apiErrorMessage(error, "Unable to refresh courses.")}</p>}
      {loading && courses && <p className="learning-dim">Refreshing courses...</p>}
      {courseList.length === 0 ? <p>No courses found.</p> : <div className="p-grid2">{courseList.map((course: any) => <CourseCard key={course.id} course={course} onApproved={refetch} />)}</div>}
    </div>
  );
}

function CourseCard({ course, onApproved }: { course: any; onApproved: RefreshHandler }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(course.status);
  const [actionError, setActionError] = useState("");
  const [feedback, setFeedback] = useState("");
  const approve = useApiMutation<{ status?: string }>(`/courses/${course.id}/approve`, "POST");
  const {
    data: courseDetail,
    error: courseDetailError,
    loading: courseDetailLoading,
    refetch: refetchDetail,
  } = useApiQuery<any>(`/courses/${course.id}`, { enabled: open });

  useEffect(() => {
    setStatus(course.status);
  }, [course.status]);

  const courseStatus = status || course.status;
  const draft = courseDetail?.course || courseDetail;
  const sections = Array.isArray(draft?.sections) ? draft.sections : [];
  const detailInspected = Boolean(courseDetail && !courseDetailError);
  const canApprove = courseStatus === "PENDING"
    && detailInspected
    && !courseDetailLoading
    && sections.length > 0;

  const handleApprove = async () => {
    setActionError("");
    setFeedback("");
    try {
      const result = await approve.mutate();
      setStatus(result?.status || "APPROVED");
      await onApproved();
      if (open) await refetchDetail();
      setFeedback("Course approved successfully.");
    } catch (error: any) {
      setActionError(apiErrorMessage(error, "Failed to approve course."));
    }
  };

  const approvalBlocker = !canApprove && courseStatus === "PENDING"
    ? !detailInspected
      ? open && courseDetailLoading
        ? "Loading draft details; approval is disabled until the draft is inspected."
        : "Inspect the draft and confirm it contains generated sections before approval."
      : courseDetailError
        ? "Draft details could not be loaded. Retry inspection before approval."
        : courseDetailLoading
          ? "Refreshing draft details; approval is disabled until the current detail is loaded."
          : "Approval blocked: no generated sections were returned in the draft detail."
    : "";

  return (
    <div className="p-panel">
      <h3>{course.title || "Untitled course draft"}</h3>
      <p className="learning-dim source-meta">Status: <strong className={courseStatus === "APPROVED" ? "learning-good" : "learning-warning"}>{courseStatus}</strong></p>
      {actionError && <p className="learning-critical" role="alert">{actionError}</p>}
      {feedback && <p className="learning-good" role="status">{feedback}</p>}
      {approvalBlocker && <p className="learning-critical" role="alert">{approvalBlocker}</p>}
      {!open ? <button className="p-btn ghost" onClick={() => setOpen(true)} style={{ marginBottom: "1rem", marginRight: "0.5rem" }}>Inspect Draft</button> : (
        <div className="source-inspect">
          <button className="p-btn ghost" onClick={() => setOpen(false)} style={{ marginBottom: "1rem" }}>Close Draft</button>
          {courseDetailError ? (
            <div role="alert">
              <p className="learning-critical">{apiErrorMessage(courseDetailError, "Unable to load draft details.")}</p>
              <button className="p-btn ghost" onClick={() => void refetchDetail()}>Retry</button>
            </div>
          ) : courseDetail ? (
            <div>
              {courseDetailLoading && <p className="learning-dim">Refreshing draft details...</p>}
              <p><strong>Title:</strong> {draft?.title || course.title || "Untitled course draft"}</p>
              <p><strong>Sections:</strong> {sections.length}</p>
              {Array.isArray(draft?.objectives) && draft.objectives.length > 0 && <p><strong>Objectives:</strong> {draft.objectives.join("; ")}</p>}
              {Array.isArray(draft?.sourceIds) && draft.sourceIds.length > 0 && <p><strong>Sources:</strong> {draft.sourceIds.join(", ")}</p>}
              {sections.length > 0 ? <pre className="learning-json">{JSON.stringify(sections, null, 2)}</pre> : <p className="learning-critical" role="alert">No generated sections were returned in the draft detail. Approval is unavailable.</p>}
            </div>
          ) : (
            <p>Loading draft details...</p>
          )}
        </div>
      )}
      {courseStatus === "PENDING" && <button className="p-btn" onClick={() => void handleApprove()} disabled={approve.loading || !canApprove} style={{ marginBottom: "1rem" }}>{approve.loading ? "Approving..." : canApprove ? "Approve Course" : "Inspect Draft Before Approving"}</button>}
      {courseStatus === "APPROVED" && <div className="export-actions">
        <button type="button" className="p-btn ghost" onClick={() => downloadAuthenticated(`/api/learning/export?courseId=${course.id}&version=1.2`, `${course.id}-scorm-1.2.zip`).catch((error) => alert(error.message))}>Export SCORM 1.2</button>
        <button type="button" className="p-btn ghost" onClick={() => downloadAuthenticated(`/api/learning/export?courseId=${course.id}&version=2004`, `${course.id}-scorm-2004.zip`).catch((error) => alert(error.message))}>Export SCORM 2004</button>
      </div>}
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {courseStatus === "PENDING" && <InstructorSyllabus courseId={course.id} />}
        <InstructorFidelity courseId={course.id} />
        <InstructorAAR courseId={course.id} />
      </div>
    </div>
  );
}

function DraftCourseModal({
  sources,
  loadingSources,
  sourceError,
  onRetrySources,
  onDrafted,
}: {
  sources: any[];
  loadingSources: boolean;
  sourceError: any;
  onRetrySources: RefreshHandler;
  onDrafted: RefreshHandler;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [error, setError] = useState("");
  const draft = useApiMutation<any>("/courses/draft", "POST");
  const handleSubmit = async () => {
    if (!title.trim() || !objective.trim() || !sourceId) {
      setError("A course title, objective, and approved source are required.");
      return;
    }
    setError("");
    try {
      await draft.mutate({ title, objectives: [objective], sourceIds: [sourceId], diagrams: false });
      await onDrafted();
      setOpen(false); setTitle(""); setObjective(""); setSourceId("");
    } catch (error: any) {
      setError(apiErrorMessage(error, "Failed to draft course."));
    }
  };
  if (!open) return <button className="p-btn" onClick={() => { setError(""); setOpen(true); }}>Draft Course</button>;
  return (
    <div className="learning-modal">
      <div className="p-panel learning-modal-panel">
        <h3>Draft New Course</h3>
        {error && <p className="learning-critical" role="alert">{error}</p>}
        {sourceError && (
          <div role="alert">
            <p className="learning-critical">{apiErrorMessage(sourceError, "Unable to load approved sources.")}</p>
            <button className="p-btn ghost" onClick={() => void onRetrySources()}>Retry Sources</button>
          </div>
        )}
        {loadingSources && <p className="learning-dim">Loading approved sources...</p>}
        <input className="scw-ti" placeholder="Course Title" value={title} onChange={(event) => setTitle(event.target.value)} style={{ width: "100%", padding: "0.5rem", marginBottom: "0.5rem" }} />
        <input className="scw-ti" placeholder="Primary Objective (e.g. Explain the standard)" value={objective} onChange={(event) => setObjective(event.target.value)} style={{ width: "100%", padding: "0.5rem", marginBottom: "0.5rem" }} />
        <select className="scw-ti" value={sourceId} onChange={(event) => setSourceId(event.target.value)} style={{ width: "100%", padding: "0.5rem", marginBottom: "1rem" }}>
          <option value="">Select an Approved Source...</option>{sources.map((source: any) => <option key={source.id} value={source.id}>{source.title}</option>)}
        </select>
        <div className="modal-actions"><button className="p-btn ghost" onClick={() => setOpen(false)}>Cancel</button><button className="p-btn" onClick={() => void handleSubmit()} disabled={draft.loading || !title.trim() || !objective.trim() || !sourceId}>{draft.loading ? "Drafting..." : "Draft"}</button></div>
      </div>
    </div>
  );
}