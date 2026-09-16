'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import '../prototype/student.css';
import { I, RailButton, UserMenu } from '../prototype/shell';
import { useAuth } from '../_auth/AuthProvider';
import AccountProfile from '../_auth/AccountProfile';
import LearningGate from '../_learning/LearningGate';
import { useApiQuery, useApiMutation } from '../_learning/useLearning';
import { LearnerProfile, LearnerProgress, LearnerStudyPlan } from './LearnerFeatures';
import { LearnerTutor, SourceViewer } from './LearnerTutor';

/* The learner app over the persisted learning loop: approved courses, Whetstone
   mastery sessions, the Sourcerer tutor, Cadence study plans, Sextant progress
   and the Waypoint profile. Everything it shows came through an instructor's
   approval on the server -- this UI never sees pending material. */
export default function LearnPage() {
  return (
    <LearningGate returnTo="/learn">
      {(user) => <LearnApp user={user} />}
    </LearningGate>
  );
}

function LearnApp({ user }) {
  const router = useRouter();
  const { signOut, signOutError } = useAuth();
  const [area, setArea] = useState('dashboard'); // dashboard | course | study-plan | progress | profile | settings
  const [activeCourseId, setActiveCourseId] = useState(null);
  const { data: coursesData, loading: coursesLoading } = useApiQuery('/courses');

  const courses = coursesData || [];
  const learnerName = user.name || 'Learner';
  const learnerInitials = learnerName.charAt(0).toUpperCase();
  const openCourse = (id) => {
    setArea('course');
    setActiveCourseId(id);
  };

  return (
    <div className="s-root">
      <nav className="s-rail">
        <UserMenu
          name={learnerName}
          role={user.role || 'Learner'}
          rank={user.rank}
          initials={learnerInitials}
          inst={false}
          items={[
            { label: 'Settings', hint: 'Account · Reminders · How I learn', onClick: () => setArea('settings') },
            {
              label: 'Sign out',
              danger: true,
              onClick: async () => {
                try {
                  await signOut();
                  router.push('/');
                } catch {
                  // AuthProvider exposes the error in the shell so a failed
                  // sign-out never becomes an unhandled promise rejection.
                }
              },
            },
          ]}
        />
        <RailButton icon={I.dashboard} label="Dashboard" on={area === 'dashboard'} onClick={() => setArea('dashboard')} />
        <RailButton icon={I.calendar} label="Study Plan" on={area === 'study-plan'} onClick={() => setArea('study-plan')} />
        <RailButton icon={I.dashboard} label="Progress" on={area === 'progress'} onClick={() => setArea('progress')} />
        <RailButton icon={I.dashboard} label="Profile" on={area === 'profile'} onClick={() => setArea('profile')} />

        <div className="s-rail-sec">My courses</div>
        {courses.map((c) => (
          <RailButton
            key={c.id}
            sub
            icon={<span className="s-rail-dot" style={{ background: 'var(--p-dim)' }} />}
            label={c.title || 'Course'}
            on={area === 'course' && activeCourseId === c.id}
            onClick={() => openCourse(c.id)}
          />
        ))}

        <div className="s-rail-spacer" />
        <RailButton icon={I.swap} label="View as instructor" onClick={() => router.push('/teach')} />
        <RailButton icon={I.back} label="Planning board" onClick={() => router.push('/plan')} />
      </nav>

      <div className="s-content">
        <div className="s-crumbs">
          <span className="s-crumb-cur">
            {area === 'course' ? 'Course view' : area === 'settings' ? 'Settings' : 'Dashboard'}
          </span>
        </div>
        <main className="s-main">
          <div className="s-container">
            {signOutError && (
              <div className="s-shell-error" role="alert">
                {signOutError.error || signOutError.message || 'Unable to sign out. Please try again.'}
              </div>
            )}
            {coursesLoading && <p>Loading courses…</p>}
            {area === 'dashboard' && !coursesLoading && (
              <div>
                <h2>Dashboard</h2>
                {courses.length === 0 ? (
                  <p>No approved courses available.</p>
                ) : (
                  <div className="p-grid2">
                    {courses.map((c) => (
                      <div key={c.id} className="p-panel" onClick={() => openCourse(c.id)} style={{ cursor: 'pointer' }}>
                        <h3>{c.title}</h3>
                        <p style={{ color: 'var(--p-dim)', fontSize: '0.85em' }}>{c.sections || 0} sections</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {area === 'course' && activeCourseId && (
              <CourseView key={activeCourseId} courseId={activeCourseId} />
            )}
            {area === 'study-plan' && <LearnerStudyPlan />}
            {area === 'progress' && <LearnerProgress />}
            {area === 'profile' && <LearnerProfile />}
            {area === 'settings' && <AccountProfile />}
          </div>
        </main>
      </div>
    </div>
  );
}

function CourseView({ courseId }) {
  const { data: envelope, loading } = useApiQuery(`/courses/${courseId}`);
  if (loading) return <p>Loading course details…</p>;
  if (!envelope || !envelope.course) return <p>Course not found</p>;

  const course = envelope.course;
  // Learner responses are redacted server-side; sourceIds is only present for the owning instructor.
  const sourceId = course.sourceIds?.[0];

  return (
    <div>
      <h2>{course.title || envelope.title || 'Course'}</h2>
      <p>Course ID: {envelope.id}</p>

      <div style={{ marginTop: '2rem' }}>
        <h3>Mastery session</h3>
        <MasteryWidget sourceId={sourceId} courseId={envelope.id} />
      </div>

      {sourceId && <LearnerTutor sourceId={sourceId} />}
      {sourceId && <SourceViewer sourceId={sourceId} />}
    </div>
  );
}

function MasteryWidget({ sourceId, courseId }) {
  const { data: sessions, loading, refetch } = useApiQuery(`/mastery/sessions?courseId=${courseId}`, { enabled: !!courseId });
  const startSession = useApiMutation('/mastery/sessions', 'POST');
  const [answer, setAnswer] = useState('');

  const activeSession = sessions?.find((s) => s.status === 'ACTIVE') || sessions?.[0];
  const turnSession = useApiMutation(`/mastery/sessions/${activeSession?.id}/turn`, 'POST');

  const handleStart = async () => {
    if (!sourceId) return alert('No source document is associated with this course.');
    try {
      await startSession.mutate({ sourceId, courseId });
      refetch();
    } catch (err) {
      console.error(err);
      alert(err.error || 'Failed to start session');
    }
  };

  const handleTurn = async () => {
    if (!answer.trim() || !activeSession) return;
    try {
      await turnSession.mutate({ answer });
      setAnswer('');
      refetch();
    } catch (err) {
      console.error(err);
      if (err.code === 'CONFLICT') {
        alert('Session state changed. Refreshing…');
        refetch();
      } else {
        alert(err.error || 'Failed to submit answer');
      }
    }
  };

  if (loading) return <div className="p-panel"><p>Loading mastery session…</p></div>;

  if (!activeSession) {
    return (
      <div className="p-panel">
        <p>Test your knowledge with Whetstone</p>
        <button className="p-btn" onClick={handleStart} disabled={startSession.loading}>
          {startSession.loading ? 'Starting…' : 'Start mastery session'}
        </button>
      </div>
    );
  }

  return (
    <div className="p-panel">
      <h4>{activeSession.currentQuestion || 'Session initialized.'}</h4>

      {activeSession.report?.feedback && (
        <div className="p-rationale" style={{ marginBottom: '1rem' }}>
          <strong>Feedback: </strong> {activeSession.report.feedback}
        </div>
      )}

      {activeSession.status === 'COMPLETE' ? (
        <p>Session complete. Score: {activeSession.report?.score}</p>
      ) : (
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
          <input
            type="text"
            className="scw-ti"
            style={{ flex: 1, padding: '0.5rem' }}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleTurn(); }}
          />
          <button className="p-btn" onClick={handleTurn} disabled={turnSession.loading}>
            {turnSession.loading ? '…' : 'Submit'}
          </button>
        </div>
      )}
    </div>
  );
}
