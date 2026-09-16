/**
 * Pure helpers for the manual-authoring content contract.
 *
 * This module deliberately has no database, framework, or authentication
 * dependency.  Drafts are JSON values, so all helpers clone their input
 * before returning it and never hand a caller a mutable stored object.
 */

export const AUTHORING_LIMITS = Object.freeze({
  draftBytes: 1024 * 1024,
  title: 160,
  summary: 4000,
  objective: 500,
  objectives: 100,
  lessons: 100,
  blocks: 1000,
  blockText: 30000,
  url: 2048,
  alt: 500,
  caption: 1000,
  label: 300,
  prompt: 10000,
  options: 100,
  optionText: 1000,
  items: 100,
  cardText: 10000,
  points: 200,
  pointText: 2000,
});

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/u;
// Markdown uses ordinary tabs and line breaks; reject other controls.
const MARKDOWN_CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const HTML_TAG = /<\/?[a-z][^>]*>/iu;
const SECRET_URL = /^[a-z][a-z\d+.-]*:\/\/[^/?#]*@/iu;

const BLOCK_TYPES = new Set([
  'text',
  'image',
  'video',
  'attachment',
  'accordion',
  'flashcards',
  'hotspots',
  'check',
  'scenario',
]);

const BLOCK_FIELDS = Object.freeze({
  text: new Set(['id', 'type', 'body']),
  image: new Set(['id', 'type', 'url', 'alt', 'caption']),
  video: new Set(['id', 'type', 'url', 'alt', 'caption']),
  attachment: new Set(['id', 'type', 'url', 'label']),
  accordion: new Set(['id', 'type', 'items']),
  flashcards: new Set(['id', 'type', 'cards']),
  hotspots: new Set(['id', 'type', 'url', 'alt', 'points']),
  check: new Set(['id', 'type', 'prompt', 'body', 'options', 'correctOptionId', 'explanation']),
  scenario: new Set(['id', 'type', 'prompt', 'body', 'options', 'correctOptionId', 'explanation']),
});

const DRAFT_FIELDS = new Set(['title', 'summary', 'objectives', 'lessons']);
const LESSON_FIELDS = new Set(['id', 'title', 'blocks']);

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function issue(path, message) {
  return { path, message };
}

function text(value, path, max, errors, { required = false, markdown = false } = {}) {
  if (value === undefined) {
    if (required) errors.push(issue(path, 'is required'));
    return;
  }
  if (typeof value !== 'string') {
    errors.push(issue(path, 'must be text'));
    return;
  }
  if (value.length > max) errors.push(issue(path, `must be at most ${max} characters`));
  if ((markdown ? MARKDOWN_CONTROL_CHARS : CONTROL_CHARS).test(value)) {
    errors.push(issue(path, 'contains a control character'));
  }
  if (markdown && HTML_TAG.test(value)) {
    errors.push(issue(path, 'must use Markdown without raw HTML'));
  }
  if (required && !value.trim()) errors.push(issue(path, 'is required'));
}

function id(value, path, errors, seen, { required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) errors.push(issue(path, 'is required'));
    return;
  }
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    errors.push(issue(path, 'must be a bounded opaque identifier'));
    return;
  }
  if (seen.has(value)) errors.push(issue(path, 'must be unique within the draft'));
  else seen.add(value);
}

function array(value, path, errors, { required = false, max = Infinity } = {}) {
  if (value === undefined) {
    if (required) errors.push(issue(path, 'is required'));
    return false;
  }
  if (!Array.isArray(value)) {
    errors.push(issue(path, 'must be an array'));
    return false;
  }
  if (value.length > max) errors.push(issue(path, `must contain at most ${max} entries`));
  return true;
}

function url(value, path, errors, { required = false } = {}) {
  if (value === undefined || value === '') {
    if (required) errors.push(issue(path, 'is required'));
    return;
  }
  if (typeof value !== 'string' || value.length > AUTHORING_LIMITS.url) {
    errors.push(issue(path, `must be an HTTPS URL of at most ${AUTHORING_LIMITS.url} characters`));
    return;
  }
  if (CONTROL_CHARS.test(value) || SECRET_URL.test(value)) {
    errors.push(issue(path, 'must not contain credentials or control characters'));
    return;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || !parsed.hostname) {
      errors.push(issue(path, 'must be an HTTPS URL'));
    }
  } catch {
    errors.push(issue(path, 'must be an HTTPS URL'));
  }
}

function unknownFields(value, allowed, path, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(issue(`${path}.${key}`, 'is not allowed'));
  }
}

function validateChoiceList(value, path, errors, seen, publishing) {
  if (!array(value, path, errors, { required: publishing, max: AUTHORING_LIMITS.options })) return;
  value.forEach((option, index) => {
    const itemPath = `${path}[${index}]`;
    if (!option || typeof option !== 'object' || Array.isArray(option)) {
      errors.push(issue(itemPath, 'must be an object'));
      return;
    }
    unknownFields(option, new Set(['id', 'text']), itemPath, errors);
    id(option.id, `${itemPath}.id`, errors, seen);
    text(option.text, `${itemPath}.text`, AUTHORING_LIMITS.optionText, errors, {
      required: publishing,
    });
  });
}

function validateBlock(block, path, errors, seen, publishing) {
  if (!block || typeof block !== 'object' || Array.isArray(block)) {
    errors.push(issue(path, 'must be an object'));
    return;
  }
  id(block.id, `${path}.id`, errors, seen);
  if (typeof block.type !== 'string' || !BLOCK_TYPES.has(block.type)) {
    errors.push(issue(`${path}.type`, 'is not a supported block type'));
    return;
  }
  unknownFields(block, BLOCK_FIELDS[block.type], path, errors);

  switch (block.type) {
    case 'text':
      text(block.body, `${path}.body`, AUTHORING_LIMITS.blockText, errors, {
        required: publishing,
        markdown: true,
      });
      break;
    case 'image':
    case 'video':
      url(block.url, `${path}.url`, errors, { required: publishing });
      text(block.alt, `${path}.alt`, AUTHORING_LIMITS.alt, errors, { required: publishing });
      text(block.caption, `${path}.caption`, AUTHORING_LIMITS.caption, errors);
      break;
    case 'attachment':
      url(block.url, `${path}.url`, errors, { required: publishing });
      text(block.label, `${path}.label`, AUTHORING_LIMITS.label, errors, { required: publishing });
      break;
    case 'accordion':
      if (array(block.items, `${path}.items`, errors, { required: publishing, max: AUTHORING_LIMITS.items })) {
        block.items.forEach((item, index) => {
          const itemPath = `${path}.items[${index}]`;
          if (!item || typeof item !== 'object' || Array.isArray(item)) {
            errors.push(issue(itemPath, 'must be an object'));
            return;
          }
          unknownFields(item, new Set(['id', 'title', 'body']), itemPath, errors);
          id(item.id, `${itemPath}.id`, errors, seen);
          text(item.title, `${itemPath}.title`, AUTHORING_LIMITS.label, errors, {
            required: publishing,
          });
          text(item.body, `${itemPath}.body`, AUTHORING_LIMITS.blockText, errors, {
            required: publishing,
            markdown: true,
          });
        });
      }
      break;
    case 'flashcards':
      if (array(block.cards, `${path}.cards`, errors, { required: publishing, max: AUTHORING_LIMITS.items })) {
        block.cards.forEach((card, index) => {
          const cardPath = `${path}.cards[${index}]`;
          if (!card || typeof card !== 'object' || Array.isArray(card)) {
            errors.push(issue(cardPath, 'must be an object'));
            return;
          }
          unknownFields(card, new Set(['id', 'front', 'back']), cardPath, errors);
          id(card.id, `${cardPath}.id`, errors, seen);
          text(card.front, `${cardPath}.front`, AUTHORING_LIMITS.cardText, errors, {
            required: publishing,
            markdown: true,
          });
          text(card.back, `${cardPath}.back`, AUTHORING_LIMITS.cardText, errors, {
            required: publishing,
            markdown: true,
          });
        });
      }
      break;
    case 'hotspots':
      url(block.url, `${path}.url`, errors, { required: publishing });
      text(block.alt, `${path}.alt`, AUTHORING_LIMITS.alt, errors, { required: publishing });
      if (array(block.points, `${path}.points`, errors, { required: publishing, max: AUTHORING_LIMITS.points })) {
        block.points.forEach((point, index) => {
          const pointPath = `${path}.points[${index}]`;
          if (!point || typeof point !== 'object' || Array.isArray(point)) {
            errors.push(issue(pointPath, 'must be an object'));
            return;
          }
          unknownFields(point, new Set(['id', 'x', 'y', 'label', 'body']), pointPath, errors);
          id(point.id, `${pointPath}.id`, errors, seen);
          for (const coordinate of ['x', 'y']) {
            const value = point[coordinate];
            if (value === undefined && !publishing) continue;
            if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
              errors.push(issue(`${pointPath}.${coordinate}`, 'must be a percentage from 0 to 100'));
            }
          }
          text(point.label, `${pointPath}.label`, AUTHORING_LIMITS.label, errors, {
            required: publishing,
          });
          text(point.body, `${pointPath}.body`, AUTHORING_LIMITS.pointText, errors, {
            required: publishing,
            markdown: true,
          });
        });
      }
      break;
    case 'check':
    case 'scenario': {
      text(block.prompt, `${path}.prompt`, AUTHORING_LIMITS.prompt, errors, {
        required: publishing,
        markdown: true,
      });
      text(block.body, `${path}.body`, AUTHORING_LIMITS.blockText, errors, { markdown: true });
      validateChoiceList(block.options, `${path}.options`, errors, seen, publishing);
      if (block.correctOptionId !== undefined && block.correctOptionId !== '') {
        if (typeof block.correctOptionId !== 'string') {
          errors.push(issue(`${path}.correctOptionId`, 'must be an option identifier'));
        } else if (Array.isArray(block.options) && !block.options.some((item) => item?.id === block.correctOptionId)) {
          errors.push(issue(`${path}.correctOptionId`, 'must reference an option'));
        }
      } else if (publishing) {
        errors.push(issue(`${path}.correctOptionId`, 'is required'));
      }
      if (publishing && Array.isArray(block.options)) {
        const correct = block.options.filter((item) => item?.id === block.correctOptionId);
        if (correct.length !== 1) errors.push(issue(`${path}.correctOptionId`, 'exactly one option must be correct'));
      }
      text(block.explanation, `${path}.explanation`, AUTHORING_LIMITS.blockText, errors, {
        required: publishing,
        markdown: true,
      });
      break;
    }
    default:
      break;
  }
}

/**
 * Validate a draft.  Partial drafts are intentionally useful while an
 * instructor is editing: omitted fields and empty values are accepted unless
 * `publishing` is true.  The return value is stable for both server and UI
 * callers: `{ valid, errors }`.
 */
export function validateDraft(draft, { publishing = false } = {}) {
  const errors = [];
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
    return { valid: false, errors: [issue('$', 'draft must be an object')] };
  }
  try {
    if (JSON.stringify(draft).length > AUTHORING_LIMITS.draftBytes) {
      errors.push(issue('$', `draft must be at most ${AUTHORING_LIMITS.draftBytes} bytes`));
    }
  } catch {
    return { valid: false, errors: [issue('$', 'draft must be JSON data')] };
  }
  unknownFields(draft, DRAFT_FIELDS, '$', errors);
  text(draft.title, '$.title', AUTHORING_LIMITS.title, errors, { required: publishing });
  text(draft.summary, '$.summary', AUTHORING_LIMITS.summary, errors, { required: publishing, markdown: true });
  if (array(draft.objectives, '$.objectives', errors, { required: publishing, max: AUTHORING_LIMITS.objectives })) {
    draft.objectives.forEach((objective, index) => {
      text(objective, `$.objectives[${index}]`, AUTHORING_LIMITS.objective, errors, {
        required: publishing,
      });
    });
  }
  if (array(draft.lessons, '$.lessons', errors, { required: publishing, max: AUTHORING_LIMITS.lessons })) {
    if (publishing && draft.lessons.length === 0) errors.push(issue('$.lessons', 'must contain usable lesson content'));
    let blockCount = 0;
    const ids = new Set();
    draft.lessons.forEach((lesson, lessonIndex) => {
      const lessonPath = `$.lessons[${lessonIndex}]`;
      if (!lesson || typeof lesson !== 'object' || Array.isArray(lesson)) {
        errors.push(issue(lessonPath, 'must be an object'));
        return;
      }
      unknownFields(lesson, LESSON_FIELDS, lessonPath, errors);
      id(lesson.id, `${lessonPath}.id`, errors, ids);
      text(lesson.title, `${lessonPath}.title`, AUTHORING_LIMITS.title, errors, { required: publishing });
      if (!array(lesson.blocks, `${lessonPath}.blocks`, errors, { required: publishing, max: AUTHORING_LIMITS.blocks })) return;
      blockCount += lesson.blocks.length;
      lesson.blocks.forEach((block, blockIndex) =>
        validateBlock(block, `${lessonPath}.blocks[${blockIndex}]`, errors, ids, publishing));
      if (publishing && lesson.blocks.length === 0) {
        errors.push(issue(`${lessonPath}.blocks`, 'must contain usable lesson content'));
      }
    });
    if (blockCount > AUTHORING_LIMITS.blocks) errors.push(issue('$.lessons', `must contain at most ${AUTHORING_LIMITS.blocks} blocks`));
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Remove answer keys before a draft/snapshot crosses the learner boundary.
 * This is recursive on purpose: malformed or future block extensions cannot
 * accidentally leak a nested answer key.
 */
export function redactDraft(draft) {
  const forbidden = new Set([
    'answer',
    'answerKey',
    'answers',
    'correct',
    'correctAnswerId',
    'correctOption',
    'correctAnswer',
    'correctOptionId',
    'explanation',
    'isCorrect',
    'rationale',
    'solution',
  ]);
  const walk = (value) => {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== 'object') return value;
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      if (!forbidden.has(key)) result[key] = walk(child);
    }
    return result;
  };
  return walk(clone(draft));
}

/** Grade a check/scenario block without exposing its answer key. */
export function gradeBlock(block, optionId) {
  if (!block || (block.type !== 'check' && block.type !== 'scenario')) {
    throw new TypeError('Only check and scenario blocks accept answers');
  }
  const correct = optionId === block.correctOptionId;
  return {
    blockId: block.id,
    optionId,
    correct,
    feedback: typeof block.explanation === 'string' ? block.explanation : '',
  };
}

function freshId(prefix, used) {
  let candidate;
  do {
    const random = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replaceAll('-', '').slice(0, 20)
      : Math.random().toString(36).slice(2, 22);
    candidate = `${prefix}-${random}`;
  } while (used.has(candidate));
  used.add(candidate);
  return candidate;
}

/**
 * Clone a draft for a duplicate operation while guaranteeing fresh IDs for
 * lessons, blocks, and every nested choice/card/point/item.
 */
export function duplicateDraft(draft) {
  const value = clone(draft) || {};
  const used = new Set();
  const remap = new Map();
  const assignIds = (entry, prefix) => {
    if (Array.isArray(entry)) return entry.map((child) => assignIds(child, prefix));
    if (!entry || typeof entry !== 'object') return entry;
    const output = {};
    for (const [key, child] of Object.entries(entry)) {
      if (key === 'id' && typeof child === 'string') {
        const next = freshId(prefix, used);
        remap.set(child, next);
        output[key] = next;
      } else {
        output[key] = assignIds(child, prefix);
      }
    }
    return output;
  };
  const rewriteChoices = (entry) => {
    if (Array.isArray(entry)) return entry.map(rewriteChoices);
    if (!entry || typeof entry !== 'object') return entry;
    const output = {};
    for (const [key, child] of Object.entries(entry)) {
      output[key] = key === 'correctOptionId' && typeof child === 'string'
        ? (remap.get(child) || child)
        : rewriteChoices(child);
    }
    return output;
  };
  return rewriteChoices(assignIds(value, 'copy'));
}
