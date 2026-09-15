"use client";

import { signOutOfSchoolCircle } from "../../lib/firebase.js";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { I, RailButton, UserMenu } from "./shell";
import { LearnerProfile, LearnerProgress, LearnerStudyPlan } from "./learner-features";
import { LearnerTutor, SourceViewer } from "./learner-tutor";
import { useApiMutation, useApiQuery, useAuthUser, useLearningStatus } from "./use-learning";
import styles from "./learning.module.css";

type LearnArea = "dashboard" | "courses" | "course" | "study-plan" | "progress" | "profile";

const LEARN_AREAS = new Set<LearnArea>([
  "dashboard",
  "courses",
  "course",
  "study-plan",
  "progress",
  "profile",
]);

function readLearnNavigation(): { area: LearnArea; courseId: string | null } {
  if (typeof window === "undefined") return { area: "dashboard", courseId: null };

  const params = new URLSearchParams(window.location.search);
  const requestedArea = params.get("area");
  const courseId = params.get("courseId") || params.get("course");

  // Accept a course URL without an area as a convenient deep link, while
  // keeping malformed course links from rendering an empty shell.
  if (courseId && (!requestedArea || requestedArea === "course")) {
    return { area: "course", courseId };
  }
  if (requestedArea === "course") {
    return { area: "dashboard", courseId: null };
  }
  if (requestedArea && LEARN_AREAS.has(requestedArea as LearnArea)) {
    return {
      area: requestedArea as LearnArea,
      courseId: requestedArea === "course" ? courseId || null : null,
    };
  }
  return { area: "dashboard", courseId: null };
}

function learnNavigationUrl(area: LearnArea, courseId: string | null = null) {
  const params = new URLSearchParams();
  if (area !== "dashboard") params.set("area", area);
  if (area === "course" && courseId) params.set("courseId", courseId);
  const query = params.toString();
  return `/learn${query ? `?${query}` : ""}`;
}

// Whetstone normally returns strings, but persisted rows may come from an
// older/model-backed response where a question or feedback value was wrapped
// in an object. Never pass those objects directly to React.
function masteryText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value)) {
    return value.map((item) => masteryText(item)).filter(Boolean).join(" ");
  }

  const record = value as Record<string, unknown>;
  for (const key of ["text", "question", "nextQuestion", "feedback", "message", "content", "prompt"]) {
    const text = masteryText(record[key]);
    if (text) return text;
  }
  return "";
}

function masteryScore(value: unknown): number | null {
  const score = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(score) ? Math.min(100, Math.max(0, score)) : null;
}

function apiErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["error", "message", "reason"]) {
      if (typeof record[key] === "string" && record[key].trim()) return record[key] as string;
    }
  }
  return fallback;
}

function RetryNotice({
  title,
  message,
  loading,
  onRetry,
}: {
  title: string;
  message: string;
  loading: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="p-rationale" role="alert" style={{ marginBottom: "1rem" }}>
      <strong>{title}</strong>
      <p style={{ margin: "0.35rem 0 0.75rem" }}>{message}</p>
      <button type="button" className="p-btn ghost" onClick={onRetry} disabled={loading}>
        {loading ? "Retrying..." : "Retry"}
      </button>
    </div>
  );
}

function LearnerCourseCard({ course, onOpen }: { course: any; onOpen: (courseId: string) => void }) {
  const title = masteryText(course?.title) || "Course";
  const sectionCount = Array.isArray(course?.sections)
    ? course.sections.length
    : typeof course?.sections === "number"
      ? course.sections
      : 0;
  return (
    <button
      type="button"
      className="p-panel course-card"
      onClick={() => onOpen(course.id)}
      aria-label={`Open ${title}`}
      style={{ width: "100%", color: "inherit", textAlign: "left" }}
    >
      <span style={{ display: "block", marginBottom: "0.9rem", fontSize: "1.15rem", fontWeight: 600 }}>{title}</span>
      <span className="learning-dim" style={{ display: "block", fontSize: "0.85em" }}>{sectionCount} sections</span>
    </button>
  );
}

export default function LearnApp() {
  const router = useRouter();
  const [navigation, setNavigation] = useState<{ area: LearnArea; courseId: string | null }>({
    area: "dashboard",
    courseId: null,
  });
  const { user, loading: userLoading } = useAuthUser();
  const { status, loading: statusLoading } = useLearningStatus();
  const {
    data: coursesData,
    error: coursesError,
    loading: coursesLoading,
    refetch: refetchCourses,
  } = useApiQuery<any[]>("/courses");

  useEffect(() => {
    const syncNavigation = () => setNavigation(readLearnNavigation());
    syncNavigation();
    window.addEventListener("popstate", syncNavigation);
    return () => window.removeEventListener("popstate", syncNavigation);
  }, []);

  if (statusLoading || userLoading) return <div className={`${styles.learningRoot} s-root`} style={{ padding: "2rem" }}>Loading...</div>;
  if (!status?.auth?.ready || !user) {
    return (
      <div className={`${styles.learningRoot} s-root learning-gate`}>
        <h2>Authentication Required</h2>
        <p>{status?.auth?.reason || "Please log in to continue."}</p>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <a href={`/login?next=${encodeURIComponent("/learn")}`} className="p-btn" style={{ width: "max-content" }}>
            Sign in with Firebase
          </a>
          <a href="/api/login?returnTo=/learn" className="p-btn ghost" style={{ width: "max-content" }}>
            Use organization sign-in
          </a>
        </div>
      </div>
    );
  }

  const area = navigation.area;
  const activeCourseId = navigation.courseId;
  const courses = Array.isArray(coursesData) ? coursesData : [];
  const coursesReady = coursesData !== null || (!coursesLoading && !coursesError);
  const learnerName = user.name || "Learner";
  const learnerInitials = learnerName.charAt(0).toUpperCase();
  const canViewInstructor = String(user.role || "").toUpperCase() === "INSTRUCTOR";
  const navigate = (nextArea: LearnArea, courseId: string | null = null) => {
    const nextNavigation = {
      area: nextArea,
      courseId: nextArea === "course" ? courseId : null,
    };
    setNavigation(nextNavigation);
    router.push(learnNavigationUrl(nextNavigation.area, nextNavigation.courseId));
  };
  const goToCourse = (courseId: string) => navigate("course", courseId);
  const areaLabel =
    area === "study-plan"
      ? "Study Plan"
      : area.charAt(0).toUpperCase() + area.slice(1);

  return (
    <div className={`${styles.learningRoot} s-root`}>
      <nav className="s-rail">
        <UserMenu
          name={learnerName}
          role={user.role || "Learner"}
          initials={learnerInitials}
          items={[
            { label: "Settings", hint: "Reminders · How I learn", onClick: () => {} },
            { label: "Sign out", danger: true, onClick: () => { void signOutOfSchoolCircle(); } },
          ]}
        />
        <RailButton icon={I.dashboard} label="Dashboard" on={area === "dashboard"} onClick={() => navigate("dashboard")} />
        <RailButton icon={I.courses} label="Courses" on={area === "courses"} onClick={() => navigate("courses")} />
        <RailButton icon={I.calendar} label="Study Plan" on={area === "study-plan"} onClick={() => navigate("study-plan")} />
        <RailButton icon={I.dashboard} label="Progress" on={area === "progress"} onClick={() => navigate("progress")} />
        <RailButton icon={I.dashboard} label="Profile" on={area === "profile"} onClick={() => navigate("profile")} />

        <div className="s-rail-sec">My courses</div>
        {courses.map((course: any) => (
          <RailButton
            key={course.id}
            sub
            icon={<span className="s-rail-dot" style={{ background: "var(--p-dim)" }} />}
            label={masteryText(course.title) || "Course"}
            on={area === "course" && activeCourseId === course.id}
            onClick={() => goToCourse(course.id)}
          />
        ))}
        <div className="s-rail-spacer" />
        {canViewInstructor && (
          <a className="s-rail-btn" href="/teach" title="View as instructor" style={{ textDecoration: "none" }}>
            <span className="s-rail-ico">{I.swap}</span>
            <span className="s-rail-lab">View as instructor</span>
          </a>
        )}
        <RailButton icon={I.back} label="Planning board" onClick={() => router.push("/plan")} />
      </nav>

      <div className="s-content">
        <div className="s-crumbs"><span className="s-crumb-cur">{area === "course" ? "Course view" : areaLabel}</span></div>
        <main className="s-main">
          <div className="s-container">
            {coursesError && (
              <RetryNotice
                title="Courses could not be loaded"
                message={apiErrorMessage(coursesError, "We could not load your approved courses.")}
                loading={coursesLoading}
                onRetry={() => { void refetchCourses(); }}
              />
            )}
            {coursesLoading && !coursesData && !coursesError && <p>Loading courses...</p>}
            {area === "dashboard" && coursesReady && (
              <div>
                <h2>Dashboard</h2>
                {courses.length === 0 ? <p>No approved courses available.</p> : (
                  <div className="p-grid2">
                    {courses.map((course: any) => <LearnerCourseCard key={course.id} course={course} onOpen={goToCourse} />)}
                  </div>
                )}
              </div>
            )}
            {area === "courses" && coursesReady && (
              <div>
                <h2>Courses</h2>
                {courses.length === 0 ? <p>No approved courses available.</p> : (
                  <div className="p-grid2">
                    {courses.map((course: any) => <LearnerCourseCard key={course.id} course={course} onOpen={goToCourse} />)}
                  </div>
                )}
              </div>
            )}
            {area === "course" && activeCourseId && <CourseView key={activeCourseId} courseId={activeCourseId} />}
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
  const {
    data: courseEnvelope,
    error,
    loading,
    refetch,
  } = useApiQuery<any>(`/courses/${courseId}`);
  // A successful mutation/focus refresh briefly sets loading while retaining
  // the old response. Keep the course and its tutor mounted in that window so
  // their transcript and input are not reset.
  if (error && !courseEnvelope) {
    return (
      <RetryNotice
        title="Course could not be loaded"
        message={apiErrorMessage(error, "We could not load this course.")}
        loading={loading}
        onRetry={() => { void refetch(); }}
      />
    );
  }
  if (loading && !courseEnvelope) return <p>Loading course details...</p>;
  if (!courseEnvelope?.course) return <p>Course not found</p>;
  const course = courseEnvelope.course;
  const sourceId = course.sourceIds?.[0];
  return (
    <div>
      {error && (
        <RetryNotice
          title="Course refresh failed"
          message={apiErrorMessage(error, "The saved course view is shown, but the latest course data could not be loaded.")}
          loading={loading}
          onRetry={() => { void refetch(); }}
        />
      )}
      <h2>{course.title || courseEnvelope.title || "Course"}</h2>
      <p>Course ID: {courseEnvelope.id}</p>
      <div style={{ marginTop: "2rem" }}>
        <h3>Mastery Session</h3>
        <MasteryWidget sourceId={sourceId} courseId={courseEnvelope.id || courseId} />
      </div>
      <div className="p-rationale" role="status" style={{ marginBottom: "1.1rem" }}>
        <strong>Confidence practice unavailable</strong>
        <p style={{ margin: "0.35rem 0 0" }}>
          Confidence practice is not available yet because its backend contract has not been delivered. No confidence-practice attempt is recorded.
        </p>
      </div>
      {sourceId && <LearnerTutor sourceId={sourceId} />}
      {sourceId && <SourceViewer sourceId={sourceId} />}
    </div>
  );
}

function MasteryWidget({ sourceId, courseId }: { sourceId?: string; courseId: string }) {
  const {
    data: sessions,
    error: sessionsError,
    loading,
    refetch,
  } = useApiQuery<any[]>(`/mastery/sessions?courseId=${encodeURIComponent(courseId)}`, { enabled: !!courseId });
  const startSession = useApiMutation<any>("/mastery/sessions", "POST");
  const [answer, setAnswer] = useState("");
  const [actionPending, setActionPending] = useState(false);
  const [sessionRefreshPending, setSessionRefreshPending] = useState(false);
  const [clearAnswerAfterRefresh, setClearAnswerAfterRefresh] = useState(false);
  const [sessionActionError, setSessionActionError] = useState("");
  const [sessionRefreshError, setSessionRefreshError] = useState("");
  const refreshBaseline = useRef<any[] | null>(null);
  const hasSessionsData = Array.isArray(sessions);
  const activeSession = sessions?.find((session: any) => session && session.status === "ACTIVE") || sessions?.[0];
  const turnSession = useApiMutation<any>(`/mastery/sessions/${activeSession?.id}/turn`, "POST");
  const queryError = sessionsError ? apiErrorMessage(sessionsError, "We could not load this mastery session.") : "";

  useEffect(() => {
    if (!sessionRefreshPending || loading) return;
    if (sessionsError) {
      setSessionRefreshError(apiErrorMessage(sessionsError, "The latest mastery session state could not be loaded."));
      setSessionRefreshPending(false);
      return;
    }
    if (Array.isArray(sessions) && sessions !== refreshBaseline.current) {
      setSessionRefreshError("");
      setSessionRefreshPending(false);
      setSessionActionError("");
      if (clearAnswerAfterRefresh) {
        setAnswer("");
        setClearAnswerAfterRefresh(false);
      }
    }
  }, [clearAnswerAfterRefresh, loading, sessionRefreshPending, sessions, sessionsError]);

  const refreshSessions = async () => {
    setSessionRefreshError("");
    refreshBaseline.current = sessions;
    setSessionRefreshPending(true);
    await refetch();
  };
  const retrySessions = () => {
    if (sessionRefreshPending || loading) return;
    setSessionActionError("");
    void refreshSessions();
  };
  const controlsBlocked =
    loading ||
    actionPending ||
    sessionRefreshPending ||
    Boolean(queryError) ||
    Boolean(sessionRefreshError);

  const handleStart = async () => {
    if (controlsBlocked || startSession.loading) return;
    if (!sourceId) {
      setSessionActionError("No source document is associated with this course.");
      return;
    }
    setSessionActionError("");
    setSessionRefreshError("");
    setActionPending(true);
    let committed = false;
    try {
      await startSession.mutate({ sourceId, courseId });
      committed = true;
      setActionPending(false);
      await refreshSessions();
    } catch (error: any) {
      setActionPending(false);
      if (committed) {
        setSessionRefreshPending(false);
        setSessionRefreshError(apiErrorMessage(error, "The session started, but its saved state could not be loaded."));
      } else {
        setSessionActionError(apiErrorMessage(error, "Failed to start the mastery session."));
      }
    }
  };

  const handleTurn = async () => {
    if (controlsBlocked || turnSession.loading || !answer.trim() || !activeSession?.id) return;
    const submittedAnswer = answer.trim();
    setSessionActionError("");
    setSessionRefreshError("");
    setActionPending(true);
    let committed = false;
    try {
      await turnSession.mutate({ answer: submittedAnswer });
      committed = true;
      setActionPending(false);
      setClearAnswerAfterRefresh(true);
      await refreshSessions();
    } catch (error: any) {
      setActionPending(false);
      if (committed) {
        setSessionRefreshPending(false);
        setSessionRefreshError(apiErrorMessage(error, "Your answer was saved, but the latest session state could not be loaded."));
      } else {
        const conflict =
          error?.code === "CONFLICT" ||
          error?.code === "409" ||
          error?.status === 409 ||
          String(error?.message).includes("409");
        setSessionActionError(
          conflict
            ? "The session changed before this answer was committed. Refreshing the saved session..."
            : apiErrorMessage(error, "Failed to submit the answer."),
        );
        if (conflict) {
          try {
            await refreshSessions();
          } catch (refreshError: any) {
            setSessionRefreshPending(false);
            setSessionRefreshError(apiErrorMessage(refreshError, "The latest mastery session state could not be loaded."));
          }
        }
      }
    }
  };

  // Keep persisted session data mounted during background refetches. This is
  // important after a turn: the hook refreshes the list, but the learner's
  // saved transcript/input should not disappear while it does so.
  if (queryError && !hasSessionsData) {
    return (
      <div className="p-panel">
        <RetryNotice
          title="Mastery session could not be loaded"
          message={queryError}
          loading={loading || sessionRefreshPending}
          onRetry={retrySessions}
        />
      </div>
    );
  }
  if (loading && !hasSessionsData) return <div className="p-panel"><p>Loading mastery session...</p></div>;
  if (sessionRefreshError && !hasSessionsData) {
    return (
      <div className="p-panel">
        <RetryNotice
          title="Mastery session state is unavailable"
          message={sessionRefreshError}
          loading={loading || sessionRefreshPending}
          onRetry={retrySessions}
        />
      </div>
    );
  }
  if (!activeSession) {
    if (sessionRefreshPending || queryError || sessionRefreshError) {
      return (
        <div className="p-panel">
          <RetryNotice
            title="Mastery session state is unavailable"
            message={queryError || sessionRefreshError || "Refreshing the saved mastery session..."}
            loading={loading || sessionRefreshPending}
            onRetry={retrySessions}
          />
        </div>
      );
    }
    return (
      <div className="p-panel">
        {sessionActionError && <div className="p-rationale" role="alert" style={{ marginBottom: "1rem" }}>{sessionActionError}</div>}
        <p>Test your knowledge with Whetstone</p>
        {!sourceId && <p className="learning-dim">No source document is associated with this course.</p>}
        <button
          type="button"
          className="p-btn"
          onClick={() => void handleStart()}
          disabled={controlsBlocked || startSession.loading || !sourceId}
        >
          {startSession.loading || actionPending ? "Starting..." : "Start Mastery Session"}
        </button>
      </div>
    );
  }

  const report = activeSession.report && typeof activeSession.report === "object" ? activeSession.report : {};
  const currentQuestion = masteryText(activeSession.currentQuestion);
  const reportScore = masteryScore(report.score);
  const sessionScore = masteryScore(activeSession.score);
  const score = reportScore ?? sessionScore;
  const criteria = Array.isArray(report.criteria)
    ? report.criteria
    : Array.isArray(activeSession.criteria)
      ? activeSession.criteria
      : [];
  const transcript = Array.isArray(activeSession.transcript) ? activeSession.transcript : [];
  const reportFeedback = masteryText(report.feedback);
  const complete = activeSession.status === "COMPLETE" || report.complete === true;
  const stalled = activeSession.stalled === true || report.stalled === true;

  return (
    <div className="p-panel">
      {(queryError || sessionRefreshError) && (
        <RetryNotice
          title="Mastery session refresh failed"
          message={sessionRefreshError || queryError}
          loading={loading || sessionRefreshPending}
          onRetry={retrySessions}
        />
      )}
      {sessionActionError && <div className="p-rationale" role="alert" style={{ marginBottom: "1rem" }}>{sessionActionError}</div>}
      <h4>{currentQuestion || "Session initialized."}</h4>
      {score !== null && (
        <div style={{ marginBottom: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.35rem" }}>
            <strong>Progress</strong>
            <span className="learning-dim">{score}%</span>
          </div>
          <div aria-label={`Mastery progress: ${score}%`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score} style={{ height: "0.45rem", background: "var(--p-surface-2)", borderRadius: "999px", overflow: "hidden" }}>
            <div style={{ width: `${score}%`, height: "100%", background: "var(--p-accent)", borderRadius: "inherit" }} />
          </div>
        </div>
      )}
      {criteria.length > 0 && (
        <p className="learning-dim" style={{ marginBottom: "1rem" }}>
          {criteria.map((criterion: any, index: number) => {
            const label = masteryText(criterion?.competency || criterion?.elo) || `Criterion ${index + 1}`;
            const verdict = masteryText(criterion?.verdict) || "not yet assessed";
            return `${label}: ${verdict}`;
          }).join(" · ")}
        </p>
      )}
      {reportFeedback && <div className="p-rationale" style={{ marginBottom: "1rem" }}><strong>Feedback: </strong>{reportFeedback}</div>}
      {transcript.length > 0 && (
        <>
          <p className="learning-dim" style={{ marginBottom: "0.5rem" }}><strong>Saved feedback and transcript</strong></p>
          <div className="tutor-history" aria-label="Saved mastery transcript">
            {transcript.map((entry: any, index: number) => {
              const text = masteryText(entry);
              if (!text) return null;
              const role = entry?.role === "user" ? "user" : "assistant";
              return <div key={`${role}-${index}`} className={`tutor-message ${role}`}>{text}</div>;
            })}
          </div>
        </>
      )}
      {complete ? (
        <p>
          {stalled
            ? "Session completed at the practice limit. Review the feedback above; mastery was not established for every criterion."
            : "Session complete."}
          {score !== null ? ` Score: ${score}` : ""}
        </p>
      ) : (
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
          <label htmlFor={`mastery-answer-${courseId}`} style={{ position: "absolute", width: "1px", height: "1px", padding: 0, margin: "-1px", overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0 }}>
            Your answer
          </label>
          <input
            id={`mastery-answer-${courseId}`}
            type="text"
            className="scw-ti"
            aria-label="Your answer"
            style={{ flex: 1, padding: "0.5rem" }}
            value={answer}
            disabled={controlsBlocked || turnSession.loading}
            onChange={(event) => setAnswer(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && !controlsBlocked && !turnSession.loading && answer.trim()) void handleTurn(); }}
          />
          <button
            type="button"
            className="p-btn"
            onClick={() => void handleTurn()}
            disabled={controlsBlocked || turnSession.loading || !answer.trim()}
          >
            {turnSession.loading || actionPending ? "Submitting..." : "Submit"}
          </button>
        </div>
      )}
    </div>
  );
}