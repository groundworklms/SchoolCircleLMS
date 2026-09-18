/**
 * Course generation as a job, rather than as a request that has to outlive its
 * own platform.
 *
 * WHY THIS EXISTS. The progress stream was an NDJSON response held open for the
 * whole of generation, and Cloud Run caps a response at 300 seconds -- a clock
 * on the whole exchange, not on time-to-first-byte, which actively sending data
 * does not reset. There is no supported way to raise it from this repository:
 * Next.js `maxDuration` is inert outside Vercel, and App Hosting's `runConfig`
 * has five keys and no timeout among them (the long note in
 * app/api/learning/courses/draft/stream/route.js has the receipts).
 *
 * A deep lesson runs about fifty seconds a section, so a real course of ten or
 * twelve sections is cut every time, around section five or six. The comment on
 * that route said the cost was the progress report and not the course, because
 * the generation would run to completion server-side afterwards. That was the
 * reasonable assumption and it is wrong: a generation cut at section three on
 * 2026-09-17 never saved, and fifteen minutes later there was no course. Work
 * detached from a request on Cloud Run gets CPU only while the instance is
 * handling some request, so a promise left running after its own request is
 * torn down slows to a stop -- and an instance with nothing to serve is exactly
 * the state the teardown creates.
 *
 * WHAT THIS DOES ABOUT IT. The work moves off the request and onto a job row,
 * and the client polls that row instead of holding a socket open. The POST that
 * starts a job returns in milliseconds. Each poll is a short request that
 * cannot be cut. And the polling is not only how the browser learns what
 * happened -- it is what keeps the instance serving requests, which is what
 * keeps the detached generation running. The UI's own progress loop is the
 * thing that powers the work it is watching.
 *
 * That last part is worth being plain about rather than quietly relying on: if
 * every client stops polling, a job can stall until something else wakes the
 * instance. It resumes rather than dying, and `minInstances: 1` keeps one alive
 * regardless, but a job is not guaranteed progress in an empty room. The
 * complete fix is chunked resumption -- each advance a separate short request
 * carrying its own state -- and this is the shape to build that on rather than
 * a detour away from it.
 *
 * WHAT IT DOES NOT SURVIVE. A deploy. A rollout replaces the instance and the
 * job goes with it, exactly as observed. A job row left RUNNING with nothing
 * touching it is how that looks from outside, and `staleJob` names it rather
 * than leaving a spinner turning forever.
 */

import {
  createLearningRecord,
  getLearningRecord,
  listLearningRecords,
  updateLearningRecord,
} from '../db.js';

export const COURSE_JOB = 'COURSE_JOB';

export const JOB_RUNNING = 'RUNNING';
export const JOB_DONE = 'DONE';
export const JOB_FAILED = 'FAILED';

// Events are appended constantly -- one per artifact, several per section --
// and writing the row on each would be hundreds of round trips for one course.
// They are buffered and flushed on a timer instead, which is why a poll can be
// up to this far behind the truth. Well under the poll interval, so a reader
// never waits on it.
const FLUSH_INTERVAL_MS = 1200;
// A RUNNING job untouched for this long is not running. Nothing renews the
// heartbeat except a flush, and a flush happens whenever anything is emitted,
// so silence this long means the process that owned it is gone.
export const STALE_AFTER_MS = 180000;

const payloadOf = (record) => (record?.payload && typeof record.payload === 'object' ? record.payload : {});

/** What a resumed run needs: whatever the last checkpoint recorded. */
export function jobProgress(record) {
  const payload = payloadOf(record);
  return payload.progress && typeof payload.progress === 'object' ? payload.progress : null;
}

/** The job as the client sees it. Never the input, which it already has. */
export function jobView(record) {
  if (!record) return null;
  const payload = payloadOf(record);
  return {
    id: record.id,
    status: record.status,
    events: Array.isArray(payload.events) ? payload.events : [],
    ...(payload.courseId ? { courseId: payload.courseId } : {}),
    ...(payload.record ? { record: payload.record } : {}),
    ...(payload.error ? { error: payload.error, code: payload.code || 'ERROR' } : {}),
    stale: isStale(record),
  };
}

/**
 * Has this job stopped being worked on?
 *
 * Only meaningful while RUNNING. A finished job is never stale however old it
 * is, and saying otherwise would turn every completed generation into a
 * warning after three minutes.
 */
export function isStale(record, now = Date.now()) {
  if (!record || record.status !== JOB_RUNNING) return false;
  const touched = new Date(record.updatedAt || record.createdAt || 0).getTime();
  return Number.isFinite(touched) && now - touched > STALE_AFTER_MS;
}

/**
 * Start a job and return immediately.
 *
 * `run` is handed an `emit` and is expected to do the generation. It is
 * deliberately NOT awaited: the point of this function is that the request
 * that called it can return at once. Its rejection is caught and written to the
 * row, because an unhandled rejection here would take the process with it and
 * leave the row RUNNING forever.
 */
export async function startJob({ ownerId, input, run, store }) {
  if (!ownerId) throw new TypeError('ownerId is required');
  if (typeof run !== 'function') throw new TypeError('run must be a function');

  /* The two writes this needs, injectable.
   *
   * Not for indirection's sake: the property worth testing here is that the
   * call RETURNS before the generation does, and a test that has to reach a
   * database to observe that is a test of the database. Production passes
   * nothing and gets the real helpers. */
  const create = store?.create || createLearningRecord;
  const update = store?.update || updateLearningRecord;

  const record = await create({
    ownerId,
    type: COURSE_JOB,
    status: JOB_RUNNING,
    payload: { input: input || {}, events: [] },
  });

  const events = [];
  /* How far the generation got, written beside the events.
   *
   * This is the half that makes a job resumable rather than merely
   * restartable: the plan and every finished section live here, so a job whose
   * process was replaced can be handed back its own progress and carry on. See
   * lib/learning/chunked-draft.js. */
  let progress = null;
  let pending = false;
  let flushing = null;
  const flush = async () => {
    if (!pending) return;
    pending = false;
    flushing = update(record.id, {
      payload: { input: input || {}, events: [...events], ...(progress ? { progress } : {}) },
    })
      .catch(() => {
        // A failed flush is not worth failing the generation over: the next one
        // carries the same events, because `events` is the whole list and not a
        // delta. Losing the LAST flush is what `finish` below is for.
      });
    await flushing;
  };
  const timer = setInterval(flush, FLUSH_INTERVAL_MS);
  // Nothing should be kept alive by this timer alone.
  if (typeof timer.unref === 'function') timer.unref();

  const emit = (event) => {
    if (!event || typeof event !== 'object') return;
    events.push(event);
    pending = true;
  };

  const finish = async (data) => {
    clearInterval(timer);
    pending = false;
    if (flushing) await flushing.catch(() => {});
    await update(record.id, {
      status: data.status,
      payload: {
        input: input || {},
        events: [...events],
        ...(progress ? { progress } : {}),
        ...data.payload,
      },
    }).catch(() => {});
  };

  // A checkpoint is worth a write of its own rather than waiting for the
  // flush timer: a section is a minute of work, and losing the record of it to
  // a process that died in the next second is exactly what this exists to
  // prevent.
  const saveProgress = async (next) => {
    progress = next;
    pending = false;
    await update(record.id, {
      payload: { input: input || {}, events: [...events], progress: next },
    }).catch(() => {});
  };

  // Detached on purpose. See the note at the top of this file.
  Promise.resolve()
    .then(() => run(emit, saveProgress))
    .then((result) => finish({
      status: JOB_DONE,
      payload: {
        ...(result?.json?.id ? { courseId: result.json.id } : {}),
        ...(result?.json ? { record: result.json } : {}),
      },
    }))
    .catch((error) => finish({
      status: JOB_FAILED,
      payload: {
        error: error?.message || 'Course generation failed',
        code: error?.code || 'ERROR',
        ...(error?.validation ? { validation: error.validation } : {}),
      },
    }));

  return record;
}

/** One job, for its owner only. Returns null for anyone else's. */
export async function readJob(ownerId, id) {
  const record = await getLearningRecord(id);
  if (!record || record.type !== COURSE_JOB || record.ownerId !== ownerId) return null;
  return record;
}

/**
 * A dead job whose work is worth continuing.
 *
 * "Dead" means RUNNING with nothing touching it, which is what a replaced
 * instance leaves behind -- and a replaced instance is the ordinary way a
 * generation stops here, because App Hosting rolls the service on every push.
 * The row still holds the plan and every section that finished, so the next
 * attempt at the same course should pick that up rather than pay for it again.
 *
 * Matched on the sources, because that is what determines the plan. A
 * different title or objective list is a different course and starts fresh.
 */
export async function resumableJob(ownerId, input) {
  const wanted = [...new Set((Array.isArray(input?.sourceIds) ? input.sourceIds : []).filter(Boolean))].sort();
  if (wanted.length === 0) return null;
  const rows = await listLearningRecords({ ownerId, type: COURSE_JOB, status: JOB_RUNNING });
  const candidates = (Array.isArray(rows) ? rows : [])
    .filter((row) => isStale(row))
    .filter((row) => {
      const progress = jobProgress(row);
      // Nothing to resume without a plan, and a plan is the first checkpoint.
      if (!progress?.plan) return false;
      const theirs = [...new Set((payloadOf(row).input?.sourceIds || []).filter(Boolean))].sort();
      return theirs.length === wanted.length && theirs.every((id, i) => id === wanted[i]);
    })
    .sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));
  return candidates[0] || null;
}

/**
 * The jobs this owner has running, newest first.
 *
 * What it is for: a reload, a second tab, or a closed laptop leaves a
 * generation with nobody watching it, and the course list is the natural place
 * to pick it back up.
 */
export async function runningJobs(ownerId) {
  const rows = await listLearningRecords({ ownerId, type: COURSE_JOB, status: JOB_RUNNING });
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => !isStale(row))
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
}
