// /api/learning/courses/draft/job -- start a course generation and return at once.
//
// The POST that used to hold a response open for the whole generation is gone
// from this path: Cloud Run caps a response at 300 seconds and a real course
// takes longer, so the work moves to a job row and the client polls
// ./job/[id]. See lib/learning/job.js for why that is the shape, and for the
// one thing it still does not survive.
import { learningRoute } from '../../../../../../lib/learning/http';
import { listCourseJobs, startCourseJob } from '../../../../../../lib/learning/core';

export const runtime = 'nodejs';

export const POST = learningRoute({ roles: ['INSTRUCTOR'] }, ({ identity, ...input }) =>
  startCourseJob(identity, input));

// Generations still running for this instructor, so a reload or a second tab
// rejoins one instead of starting another beside it.
export const GET = learningRoute({ roles: ['INSTRUCTOR'] }, ({ identity }) => listCourseJobs(identity));
