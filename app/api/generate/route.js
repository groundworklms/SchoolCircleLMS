import { primeModelSettings } from '../../../lib/model-settings.js';
import { generateJSON, providerStatus } from '../../../lib/model';

export const runtime = 'nodejs';
export const maxDuration = 120;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'keyTerms', 'questions'],
  properties: {
    summary: { type: 'string', description: '2-3 sentence overview of the lesson' },
    keyTerms: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['term', 'definition'],
        properties: { term: { type: 'string' }, definition: { type: 'string' } },
      },
    },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['q', 'answers', 'rationale'],
        properties: {
          q: { type: 'string' },
          answers: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['text', 'correct'],
              properties: { text: { type: 'string' }, correct: { type: 'boolean' } },
            },
          },
          rationale: { type: 'string', description: 'Why the correct answer is correct' },
        },
      },
    },
  },
};

const SYSTEM = `You generate study aids for a US Marine Corps schoolhouse from an approved Program of Instruction.

Rules:
- The POI is the authority. Derive only from what it states; never invent doctrine, publication numbers, or standards.
- If the POI does not give enough detail on a topic, say so in the summary rather than filling the gap.
- Questions must test the lesson's stated learning objectives, with exactly one correct answer and plausible distractors.
- Output is a DRAFT for instructor review. Write accordingly.`;

export async function GET() {
  await primeModelSettings();
  return Response.json(providerStatus());
}

export async function POST(req) {
  try {
    await primeModelSettings();
    const { course, annex, lesson, count = 3 } = await req.json();
    if (!course || !lesson) {
      return Response.json({ error: 'course and lesson are required' }, { status: 400 });
    }

    const cacheable = `PROGRAM OF INSTRUCTION\nCourse: ${course.courseTitle} (${course.courseId}) v${course.version}\n\nAnnex structure:\n${(course.annexes || [])
      .map(
        (a) =>
          `Annex ${a.letter} — ${a.title} (${a.hours} h)\n` +
          a.lessons.map((l) => `   ${l.id}  ${l.title}  ${l.hours}h  [${l.kind}]`).join('\n')
      )
      .join('\n\n')}`;

    const prompt = `Generate study aids for this lesson:

Annex ${annex?.letter} — ${annex?.title}
Lesson ${lesson.id} — ${lesson.title} (${lesson.hours} hours, ${lesson.kind})

Produce a summary, 4-6 key terms, and ${count} practice questions with four options each.`;

    const started = Date.now();
    const out = await generateJSON({ system: SYSTEM, cacheable, prompt, schema: SCHEMA });
    return Response.json({ ...out, ms: Date.now() - started, lessonId: lesson.id });
  } catch (err) {
    const status = err.code === 'NO_PROVIDER' ? 503 : 500;
    console.error('[generate]', err.message);
    return Response.json({ error: err.message, code: err.code || 'ERROR' }, { status });
  }
}
