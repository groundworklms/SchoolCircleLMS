'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import '../prototype/student.css';
import { I, RailButton, UserMenu } from '../prototype/shell';
import { useAuth } from '../_auth/AuthProvider';
import AccountProfile from '../_auth/AccountProfile';
import LearningGate from '../_learning/LearningGate';
import { downloadAuthenticated, useApiQuery, useApiMutation } from '../_learning/useLearning';
import { InstructorFidelity, InstructorAAR, InstructorSyllabus, RubricsView } from './InstructorFeatures';

/* The instructor app over the persisted learning loop: ingest and approve
   sources (Quarry), draft and approve cited courses (Coursewright), generate
   and approve rubrics (Rubricon), attach syllabi (Cadence), run fidelity
   benchmarks (Understudy), build AARs (Hotwash), export SCORM (Cartridge).
   Every approval is a human click here; the server never self-approves. */
export default function TeachPage() {
  return (
    <LearningGate returnTo="/teach" requireInstructor>
      {(user) => <TeachApp user={user} />}
    </LearningGate>
  );
}

function TeachApp({ user }) {
  const router = useRouter();
  const { signOut, signOutError } = useAuth();
  const [area, setArea] = useState('sources'); // sources | courses | rubrics | settings

  const instName = user.name || 'Instructor';
  const instInitials = instName.charAt(0).toUpperCase();
  const AREA_LABEL = { sources: 'Sources', courses: 'Courses', rubrics: 'Rubrics', settings: 'Settings' };

  return (
    <div className="s-root i-root">
      <nav className="s-rail">
        <UserMenu
          name={instName}
          role={user.role || 'Instructor'}
          rank={user.rank}
          initials={instInitials}
          inst
          items={[
            { label: 'Settings', hint: 'Account profile', onClick: () => setArea('settings') },
            {
              label: 'Sign out',
              danger: true,
              onClick: async () => {
                try {
                  await signOut();
                  router.push('/');
                } catch {
                  // AuthProvider retains the error for the shell to display.
                }
              },
            },
          ]}
        />

        <div className="s-rail-sec">Library</div>
        <RailButton icon={I.dashboard} label="Sources" on={area === 'sources'} onClick={() => setArea('sources')} />
        <RailButton icon={I.courses} label="Courses" on={area === 'courses'} onClick={() => setArea('courses')} />
        <RailButton icon={I.dashboard} label="Rubrics" on={area === 'rubrics'} onClick={() => setArea('rubrics')} />

        <div className="s-rail-spacer" />
        {['LEARNER', 'BOTH'].includes(user.role) && (
          <RailButton icon={I.swap} label="View as learner" onClick={() => router.push('/learn')} />
        )}
        <RailButton icon={I.back} label="Planning board" onClick={() => router.push('/plan')} />
      </nav>

      <div className="s-content">
        <div className="s-crumbs">
          <span className="s-crumb-cur">Instructor / {AREA_LABEL[area]}</span>
        </div>
        <main className="s-main">
          <div className="s-container" style={{ maxWidth: '60rem' }}>
            {signOutError && (
              <div className="s-shell-error" role="alert">
                {signOutError.error || signOutError.message || 'Unable to sign out. Please try again.'}
              </div>
            )}
            {area === 'sources' && <SourcesView />}
            {area === 'courses' && <CoursesView />}
            {area === 'rubrics' && <RubricsView />}
            {area === 'settings' && <AccountProfile />}
          </div>
        </main>
      </div>
    </div>
  );
}

function SourcesView() {
  const { data: sources, loading, refetch } = useApiQuery('/sources');

  if (loading) return <p>Loading sources…</p>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 className="p-h">Source documents</h2>
        <IngestSourceModal onIngested={refetch} />
      </div>

      {!sources || sources.length === 0 ? (
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

function SourceCard({ source, onApproved }) {
  const [open, setOpen] = useState(false);
  const approve = useApiMutation(`/sources/${source.id}/approve`, 'POST');
  const { data: sourceDetail } = useApiQuery(`/sources/${source.id}`, { enabled: open });

  const handleApprove = async () => {
    try {
      await approve.mutate();
      onApproved();
    } catch (e) {
      alert(e.error || 'Failed to approve source');
    }
  };

  return (
    <div className="p-panel">
      <h3>{source.title}</h3>
      <p style={{ fontSize: '0.85em', color: 'var(--p-dim)', marginBottom: '1rem' }}>
        ID: {source.id}<br />
        Status: <strong style={{ color: source.status === 'APPROVED' ? 'var(--p-good)' : 'var(--p-warning)' }}>{source.status}</strong>
      </p>

      {!open ? (
        <button className="p-btn ghost" onClick={() => setOpen(true)} style={{ marginBottom: '1rem', marginRight: '0.5rem' }}>Inspect source</button>
      ) : (
        <div style={{ background: 'var(--p-surface-2)', padding: '1rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.85em' }}>
          <button className="p-btn ghost" onClick={() => setOpen(false)} style={{ marginBottom: '1rem' }}>Close source</button>
          {sourceDetail ? (
            <div style={{ maxHeight: '300px', overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
              {sourceDetail.text || sourceDetail.pages?.map((p) => p.text).join('\n\n') || 'No content.'}
            </div>
          ) : (
            <p>Loading details…</p>
          )}
        </div>
      )}

      {source.status === 'PENDING' && (
        <button className="p-btn" onClick={handleApprove} disabled={approve.loading}>
          {approve.loading ? 'Approving…' : 'Approve source'}
        </button>
      )}
    </div>
  );
}

const MODAL_BACKDROP = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  background: 'rgba(0,0,0,0.5)', zIndex: 100,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

function IngestSourceModal({ onIngested }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const ingest = useApiMutation('/sources', 'POST');

  const handleSubmit = async () => {
    if (!title || !text) return;
    try {
      await ingest.mutate({ title, text });
      setOpen(false);
      setTitle('');
      setText('');
      onIngested();
    } catch (e) {
      alert(e.error || 'Failed to ingest source');
    }
  };

  if (!open) return <button className="p-btn" onClick={() => setOpen(true)}>Add source</button>;

  return (
    <div style={MODAL_BACKDROP}>
      <div className="p-panel" style={{ width: '400px', maxWidth: '90%' }}>
        <h3 style={{ fontSize: '1.1em', marginBottom: '1rem' }}>Ingest new source</h3>
        <input
          className="scw-ti"
          placeholder="Source title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ width: '100%', padding: '0.5rem', marginBottom: '0.5rem' }}
        />
        <textarea
          className="scw-ti"
          placeholder="Paste source text here…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          style={{ width: '100%', padding: '0.5rem', marginBottom: '1rem' }}
        />
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button className="p-btn ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button className="p-btn" onClick={handleSubmit} disabled={ingest.loading || !title || !text}>
            {ingest.loading ? 'Ingesting…' : 'Ingest'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CoursesView() {
  const { data: courses, loading, refetch } = useApiQuery('/courses');
  const { data: sources } = useApiQuery('/sources');
  const approvedSources = sources?.filter((s) => s.status === 'APPROVED') || [];

  if (loading) return <p>Loading courses…</p>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 className="p-h">Course drafts</h2>
        <DraftCourseModal sources={approvedSources} onDrafted={refetch} />
      </div>

      {!courses || courses.length === 0 ? (
        <p>No courses found.</p>
      ) : (
        <div className="p-grid2">
          {courses.map((course) => (
            <CourseCard key={course.id} course={course} onApproved={refetch} />
          ))}
        </div>
      )}
    </div>
  );
}

function CourseCard({ course, onApproved }) {
  const [open, setOpen] = useState(false);
  const approve = useApiMutation(`/courses/${course.id}/approve`, 'POST');
  const { data: courseDetail } = useApiQuery(`/courses/${course.id}`, { enabled: open });

  const handleApprove = async () => {
    try {
      await approve.mutate();
      onApproved();
    } catch (e) {
      alert(e.error || 'Failed to approve course');
    }
  };

  const exportScorm = (version) =>
    downloadAuthenticated(
      `/api/learning/export?courseId=${course.id}&version=${version}`,
      `${course.id}-scorm-${version}.zip`,
    ).catch((error) => alert(error.message));

  return (
    <div className="p-panel">
      <h3>{course.title}</h3>
      <p style={{ fontSize: '0.85em', color: 'var(--p-dim)', marginBottom: '1rem' }}>
        Status: <strong style={{ color: course.status === 'APPROVED' ? 'var(--p-good)' : 'var(--p-warning)' }}>{course.status}</strong>
      </p>

      {!open ? (
        <button className="p-btn ghost" onClick={() => setOpen(true)} style={{ marginBottom: '1rem', marginRight: '0.5rem' }}>Inspect draft</button>
      ) : (
        <div style={{ background: 'var(--p-surface-2)', padding: '1rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.85em' }}>
          <button className="p-btn ghost" onClick={() => setOpen(false)} style={{ marginBottom: '1rem' }}>Close draft</button>
          {courseDetail ? (
            <div>
              <p><strong>Title:</strong> {courseDetail.course?.title}</p>
              <p><strong>Sections:</strong> {courseDetail.course?.sections?.length || 0}</p>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.9em', color: 'var(--p-dim)' }}>
                {JSON.stringify(courseDetail.course?.sections, null, 2)}
              </pre>
            </div>
          ) : (
            <p>Loading details…</p>
          )}
        </div>
      )}

      {course.status === 'PENDING' && (
        <button className="p-btn" onClick={handleApprove} disabled={approve.loading} style={{ marginBottom: '1rem' }}>
          {approve.loading ? 'Approving…' : 'Approve course'}
        </button>
      )}

      {course.status === 'APPROVED' && (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <button type="button" className="p-btn ghost" onClick={() => exportScorm('1.2')}>Export SCORM 1.2</button>
          <button type="button" className="p-btn ghost" onClick={() => exportScorm('2004')}>Export SCORM 2004</button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {course.status === 'PENDING' && <InstructorSyllabus courseId={course.id} />}
        <InstructorFidelity courseId={course.id} />
        <InstructorAAR courseId={course.id} />
      </div>
    </div>
  );
}

function DraftCourseModal({ sources, onDrafted }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [sourceId, setSourceId] = useState('');
  const draft = useApiMutation('/courses/draft', 'POST');

  const handleSubmit = async () => {
    if (!title || !objective || !sourceId) return;
    try {
      await draft.mutate({ title, objectives: [objective], sourceIds: [sourceId], diagrams: false });
      setOpen(false);
      setTitle('');
      setObjective('');
      setSourceId('');
      onDrafted();
    } catch (e) {
      alert(e.error || 'Failed to draft course');
    }
  };

  if (!open) return <button className="p-btn" onClick={() => setOpen(true)}>Draft course</button>;

  return (
    <div style={MODAL_BACKDROP}>
      <div className="p-panel" style={{ width: '400px', maxWidth: '90%' }}>
        <h3 style={{ fontSize: '1.1em', marginBottom: '1rem' }}>Draft new course</h3>
        <input
          className="scw-ti"
          placeholder="Course title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ width: '100%', padding: '0.5rem', marginBottom: '0.5rem' }}
        />
        <input
          className="scw-ti"
          placeholder="Primary objective (e.g. Explain the standard)"
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          style={{ width: '100%', padding: '0.5rem', marginBottom: '0.5rem' }}
        />
        <select
          className="scw-ti"
          value={sourceId}
          onChange={(e) => setSourceId(e.target.value)}
          style={{ width: '100%', padding: '0.5rem', marginBottom: '1rem' }}
        >
          <option value="">Select an approved source…</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>{s.title}</option>
          ))}
        </select>

        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button className="p-btn ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button className="p-btn" onClick={handleSubmit} disabled={draft.loading || !title || !objective || !sourceId}>
            {draft.loading ? 'Drafting…' : 'Draft'}
          </button>
        </div>
      </div>
    </div>
  );
}
