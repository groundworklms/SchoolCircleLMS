import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';

const API_ORIGIN = 'https://schoolcircle.example.test';

function request(path, token) {
  const headers = token
    ? { authorization: `Bearer ${token}` }
    : { 'x-role': 'INSTRUCTOR', 'x-user': 'forged-client-claim' };
  return new Request(`${API_ORIGIN}/api${path}`, { headers });
}

async function json(response) {
  assert.ok(response instanceof Response);
  return response.json();
}

function itemsOf(course) {
  return (course?.sections || []).flatMap((section) => section.items || []);
}

function tokenFor(user, session) {
  return session.createSessionToken({
    userId: user.id,
    subject: user.externalId,
  });
}

test('native course access authenticates and redacts assessment keys by role', async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip('DATABASE_URL is required for the isolated course fixture');
    return;
  }

  const { db } = await import('../lib/server/db.js');
  const session = await import('../lib/server/session.js');
  const listRoute = await import('../app/api/courses/route.js');
  const detailRoute = await import('../app/api/courses/[id]/route.js');

  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = `course-access-${randomUUID()}`;

  let learner;
  let instructor;
  let course;
  try {
    const suffix = `${process.pid}-${randomUUID()}`;
    [learner, instructor] = await Promise.all([
      db.user.create({
        data: {
          name: `Course access learner ${suffix}`,
          role: 'LEARNER',
          externalId: `course-access-learner-${suffix}`,
        },
      }),
      db.user.create({
        data: {
          name: `Course access instructor ${suffix}`,
          role: 'INSTRUCTOR',
          externalId: `course-access-instructor-${suffix}`,
        },
      }),
    ]);
    course = await db.course.create({
      data: {
        title: `Course access fixture ${suffix}`,
        sourceId: `course-access-${suffix}`,
        sections: {
          create: {
            title: 'Verified section',
            order: 1,
            items: {
              create: [
                {
                  kind: 'LESSON',
                  stem: 'Safe cited lesson stem',
                  citation: { citation: 'Fixture §1, para 1' },
                  status: 'APPROVED',
                },
                {
                  kind: 'QUESTION',
                  stem: 'Approved question stem',
                  options: ['correct', 'wrong'],
                  answer: 0,
                  rationale: 'Approved answer rationale',
                  citation: { citation: 'Fixture §1, para 2' },
                  status: 'APPROVED',
                },
                {
                  kind: 'QUESTION',
                  stem: 'Pending question stem',
                  options: ['pending-correct', 'pending-wrong'],
                  answer: 0,
                  rationale: 'Pending answer rationale',
                  citation: { citation: 'Fixture §1, para 3' },
                  status: 'PENDING',
                },
              ],
            },
          },
        },
      },
    });

    const anonymous = await listRoute.GET(request('/courses'));
    assert.equal(anonymous.status, 401);
    assert.equal((await json(anonymous)).code, 'AUTH_REQUIRED');

    const anonymousDetail = await detailRoute.GET(request(`/courses/${course.id}`));
    assert.equal(anonymousDetail.status, 401);
    assert.equal((await json(anonymousDetail)).code, 'AUTH_REQUIRED');

    const learnerToken = tokenFor(learner, session);
    const learnerList = await listRoute.GET(request('/courses', learnerToken));
    assert.equal(learnerList.status, 200);
    const learnerCourse = (await json(learnerList)).courses.find((row) => row.id === course.id);
    assert.ok(learnerCourse);
    const learnerItems = itemsOf(learnerCourse);
    assert.deepEqual(
      learnerItems.map((item) => item.stem).sort(),
      ['Safe cited lesson stem', 'Approved question stem'].sort(),
    );
    assert.ok(learnerItems.some((item) => item.citation?.citation === 'Fixture §1, para 1'));
    assert.ok(learnerItems.every((item) => !('answer' in item) && !('rationale' in item)));

    const learnerDetail = await detailRoute.GET(request(`/courses/${course.id}`, learnerToken));
    assert.equal(learnerDetail.status, 200);
    const learnerDetailItems = itemsOf((await json(learnerDetail)).course);
    assert.deepEqual(
      learnerDetailItems.map((item) => item.stem).sort(),
      ['Safe cited lesson stem', 'Approved question stem'].sort(),
    );
    assert.ok(learnerDetailItems.every((item) => !('answer' in item) && !('rationale' in item)));

    const instructorToken = tokenFor(instructor, session);
    const instructorList = await listRoute.GET(request('/courses', instructorToken));
    assert.equal(instructorList.status, 200);
    const instructorCourse = (await json(instructorList)).courses.find((row) => row.id === course.id);
    assert.ok(instructorCourse);
    const instructorItems = itemsOf(instructorCourse);
    assert.deepEqual(
      instructorItems.map((item) => item.stem).sort(),
      ['Safe cited lesson stem', 'Approved question stem', 'Pending question stem'].sort(),
    );
    const pending = instructorItems.find((item) => item.stem === 'Pending question stem');
    assert.equal(pending.answer, 0);
    assert.equal(pending.rationale, 'Pending answer rationale');

    const instructorDetail = await detailRoute.GET(request(`/courses/${course.id}`, instructorToken));
    assert.equal(instructorDetail.status, 200);
    const instructorDetailItems = itemsOf((await json(instructorDetail)).course);
    const approved = instructorDetailItems.find((item) => item.stem === 'Approved question stem');
    assert.equal(approved.answer, 0);
    assert.equal(approved.rationale, 'Approved answer rationale');
  } finally {
    if (course) await db.course.delete({ where: { id: course.id } });
    if (learner) await db.user.delete({ where: { id: learner.id } });
    if (instructor) await db.user.delete({ where: { id: instructor.id } });
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});