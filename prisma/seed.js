/**
 * Seed the original runnable TC 3-22.9 course. This is opt-in and never runs
 * during the Next build; the root package intentionally exposes no migrate
 * script so an existing database is not changed implicitly.
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

const SECTIONS = [
  { title: 'Ch 5 · Functional Elements', order: 5 },
  { title: 'Ch 6 · Stability & Natural Point of Aim', order: 6 },
  { title: 'Ch 7 · Aiming — Sight Alignment & Picture', order: 7 },
  { title: 'Ch 8 · Trigger Control & Follow-Through', order: 8 },
];

const LESSONS = {
  'Ch 7 · Aiming — Sight Alignment & Picture': [
    {
      stem: 'Sight alignment is the relationship between the aiming device and the firer’s eye; sight picture is the placement of the aligned sights on the target.',
      citation: { citation: 'TC 3-22.9, Ch 7 “Desired Point of Impact”, para 1, p.7-5', pubId: 'TC 3-22.9', page: '7-5' },
      support: 0.96,
    },
  ],
  'Ch 8 · Trigger Control & Follow-Through': [
    {
      stem: 'Trigger control is firing the weapon while maintaining proper aim and stabilization until the bullet leaves the muzzle.',
      citation: { citation: 'TC 3-22.9, Ch 8 “Trigger Control”, para 2, p.8-2', pubId: 'TC 3-22.9', page: '8-2' },
      support: 0.95,
    },
  ],
};

const QUESTIONS = {
  'Ch 7 · Aiming — Sight Alignment & Picture': [
    {
      stem: 'How many phases make up the shot process?',
      options: ['Three — pre-shot, shot, post-shot', 'Four', 'Five', 'Two'],
      answer: 0,
      rationale: 'Aiming is conducted through pre-shot, shot, and post-shot — three phases.',
      citation: { citation: 'TC 3-22.9, Ch 6 “Aiming”, para 3', pubId: 'TC 3-22.9' },
      support: 0.93,
    },
  ],
};

async function findOrCreateUser(name, role) {
  const found = await db.user.findFirst({ where: { name } });
  return found ?? db.user.create({ data: { name, role } });
}

async function main() {
  await findOrCreateUser('SSgt White', 'INSTRUCTOR');
  await findOrCreateUser('LCpl Doe', 'LEARNER');

  let course = await db.course.findFirst({ where: { sourceId: 'TC 3-22.9' } });
  if (!course) {
    course = await db.course.create({
      data: { title: 'Rifle Marksmanship — TC 3-22.9', sourceId: 'TC 3-22.9' },
    });
  }

  for (const s of SECTIONS) {
    let section = await db.section.findFirst({ where: { courseId: course.id, title: s.title } });
    if (!section) section = await db.section.create({ data: { ...s, courseId: course.id } });

    for (const l of LESSONS[s.title] || []) {
      const exists = await db.item.findFirst({ where: { sectionId: section.id, stem: l.stem } });
      if (!exists) await db.item.create({ data: { sectionId: section.id, kind: 'LESSON', status: 'APPROVED', ...l } });
    }
    for (const q of QUESTIONS[s.title] || []) {
      const exists = await db.item.findFirst({ where: { sectionId: section.id, stem: q.stem } });
      if (!exists) await db.item.create({ data: { sectionId: section.id, kind: 'QUESTION', status: 'APPROVED', ...q } });
    }
  }
  console.log('Seeded: course, sections, verified items, 1 instructor + 1 learner.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
}).finally(() => db.$disconnect());