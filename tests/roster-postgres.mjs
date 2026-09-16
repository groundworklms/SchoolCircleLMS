/**
 * Opt-in native PostgreSQL roster persistence check.
 *
 * This script deliberately refuses to write unless the caller explicitly
 * selects the development target:
 *
 *   SCHOOLCIRCLE_DB_ENV=development RUN_DB_TESTS=1 DATABASE_URL=... \
 *     node tests/roster-postgres.mjs
 *
 * It does not run migrations and cleans only records created by this fixture.
 */
import assert from 'node:assert/strict';

const enabled =
  process.env.SCHOOLCIRCLE_DB_ENV === 'development' &&
  process.env.RUN_DB_TESTS === '1' &&
  Boolean(process.env.DATABASE_URL);

if (!enabled) {
  console.log(
    'SKIP roster PostgreSQL test: set SCHOOLCIRCLE_DB_ENV=development, RUN_DB_TESTS=1, and DATABASE_URL.',
  );
} else {
  const { db } = await import('../lib/db.js');
  const { createRosterService, ENROLLMENT, ENROLLMENT_EVENT } =
    await import('../lib/roster/service.js');

  const suffix = `${Date.now()}-${process.pid}`;
  const userId = `roster-pg-user-${suffix}`;
  const courseId = `roster-pg-course-${suffix}`;
  const email = `roster-${suffix}@example.test`;
  const identity = {
    id: userId,
    name: 'Roster PostgreSQL Fixture',
    role: 'INSTRUCTOR',
    email,
    emailVerified: true,
  };
  const ownedRecordIds = [courseId];
  const service = createRosterService({ db });

  try {
    await db.user.create({
      data: {
        id: userId,
        name: identity.name,
        role: 'INSTRUCTOR',
        externalId: `roster-pg-external-${suffix}`,
      },
    });
    await db.learningRecord.create({
      data: {
        id: courseId,
        ownerId: userId,
        type: 'MANUAL_COURSE',
        status: 'DRAFT',
        payload: { title: 'Roster PostgreSQL Fixture' },
      },
    });

    const students = Array.from({ length: 500 }, (_, index) => ({
      name: `Roster Student ${index}`,
      email: `roster-${suffix}-${index}@example.test`,
      section: index % 2 ? 'Bravo' : 'Alpha',
    }));
    const imported = await service.addStudents(identity, {
      params: { id: courseId },
      body: { students },
    });
    assert.equal(imported.json.students.length, 500);

    const persisted = await db.learningRecord.findMany({
      where: {
        type: ENROLLMENT,
        ownerId: userId,
        payload: { path: ['courseId'], equals: courseId },
      },
    });
    assert.equal(persisted.length, 500);

    const repeated = await Promise.all(
      Array.from({ length: 4 }, () =>
        service.addStudents(identity, {
          params: { id: courseId },
          body: { name: 'Repeated', email: students[0].email, section: 'Alpha' },
        })),
    );
    assert.equal(new Set(repeated.flatMap((result) => result.json.students
      .filter((student) => student.email === students[0].email)
      .map((student) => student.id))).size, 1);
    const afterRepeat = await db.learningRecord.findMany({
      where: {
        type: ENROLLMENT,
        ownerId: userId,
        payload: { path: ['courseId'], equals: courseId },
      },
    });
    assert.equal(afterRepeat.length, 500);

    const ownRows = await db.learningRecord.findMany({ where: { ownerId: userId } });
    ownedRecordIds.push(...ownRows
      .filter((row) =>
        row.id !== courseId &&
        ([ENROLLMENT, ENROLLMENT_EVENT].includes(row.type)) &&
        row.payload?.courseId === courseId)
      .map((row) => row.id));
    console.log('PASS roster PostgreSQL import 500, deterministic duplicate concurrency, and scoped persistence.');
  } finally {
    // The user is synthetic and newly created above. Delete only its known
    // course/roster rows; never truncate or scan/delete another owner's data.
    const ownedRows = await db.learningRecord.findMany({ where: { ownerId: userId } });
    const ids = [...new Set([
      ...ownedRecordIds,
      ...ownedRows
        .filter((row) => row.payload?.courseId === courseId)
        .map((row) => row.id),
    ])];
    if (ids.length) await db.learningRecord.deleteMany({ where: { id: { in: ids } } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  }
}