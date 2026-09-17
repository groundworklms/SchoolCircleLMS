// /api/learning/courses/draft/job/[id] -- one generation's progress.
//
// Polled by the client every few seconds. Two jobs at once: it is how the
// browser learns what has been written, and it is what keeps the instance
// serving requests, which is what keeps the detached generation running.
import { learningRoute } from '../../../../../../../lib/learning/http';
import { readCourseJob } from '../../../../../../../lib/learning/core';

export const runtime = 'nodejs';

export const GET = learningRoute({ roles: ['INSTRUCTOR'] }, ({ identity, params }) =>
  readCourseJob(identity, { params }));
