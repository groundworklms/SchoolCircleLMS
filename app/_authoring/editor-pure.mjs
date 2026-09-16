/*
 * Framework-free authoring primitives.  Keeping this module free of React,
 * Next, and browser APIs makes the ID, ordering, and dirty-state contracts
 * directly testable from node:test as well as reusable by the editor views.
 */

let idCounter = 0;

/** Generate a short opaque ID for newly-created and duplicated content. */
export function createAuthoringId(prefix = 'id') {
  const cryptoObject = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
  let suffix = '';
  if (cryptoObject?.randomUUID) suffix = cryptoObject.randomUUID().replaceAll('-', '').slice(0, 16);
  else {
    idCounter += 1;
    suffix = `${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }
  return `${prefix}_${suffix}`.slice(0, 48);
}

export function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
  }
  return value;
}

function collectIds(value, ids) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectIds(item, ids));
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (typeof value.id === 'string' && value.id) ids.push(value.id);
  Object.values(value).forEach((item) => collectIds(item, ids));
}

/**
 * Clone any lesson/block tree while changing every object `id`, including
 * accordion items, flashcards, hotspot points, and answer options.
 *
 * `correctOptionId` is a reference rather than an object ID. It is remapped
 * alongside the option IDs so a duplicated check still has one valid answer.
 */
export function duplicateWithFreshIds(value, makeId = createAuthoringId) {
  const originalIds = [];
  collectIds(value, originalIds);
  const reserved = new Set(originalIds);
  const remapped = new Map();
  const nextId = () => {
    let id = makeId();
    while (!id || reserved.has(id)) id = makeId();
    reserved.add(id);
    return id;
  };
  originalIds.forEach((id) => {
    if (!remapped.has(id)) remapped.set(id, nextId());
  });

  const visit = (item) => {
    if (Array.isArray(item)) return item.map(visit);
    if (!item || typeof item !== 'object') return item;
    return Object.fromEntries(
      Object.entries(item).map(([key, child]) => {
        if (key === 'id' && typeof child === 'string') return [key, remapped.get(child) || child];
        if (key === 'correctOptionId' && typeof child === 'string') return [key, remapped.get(child) || child];
        return [key, visit(child)];
      }),
    );
  };
  return visit(cloneValue(value));
}

export function newBlock(type = 'text') {
  const id = createAuthoringId('block');
  switch (type) {
    case 'image':
    case 'video':
      return { id, type, url: '', alt: '', caption: '' };
    case 'attachment':
      return { id, type, url: '', label: '' };
    case 'accordion':
      return { id, type, items: [{ id: createAuthoringId('item'), title: '', body: '' }] };
    case 'flashcards':
      return { id, type, cards: [{ id: createAuthoringId('card'), front: '', back: '' }] };
    case 'hotspots':
      return { id, type, url: '', alt: '', points: [{ id: createAuthoringId('point'), x: 50, y: 50, label: '', body: '' }] };
    case 'check':
    case 'scenario': {
      const optionId = createAuthoringId('option');
      return {
        id,
        type,
        prompt: '',
        body: '',
        options: [{ id: optionId, text: '' }],
        correctOptionId: optionId,
        explanation: '',
      };
    }
    case 'text':
    default:
      return { id, type: 'text', body: '' };
  }
}

export function newLesson() {
  return { id: createAuthoringId('lesson'), title: '', blocks: [] };
}

export function emptyDraft() {
  return { title: '', summary: '', objectives: [], lessons: [] };
}

function normalizeBlock(block) {
  const source = block && typeof block === 'object' ? block : {};
  const type = source.type || 'text';
  const base = { ...source, id: source.id || createAuthoringId('block'), type };
  if (type === 'text') return { ...base, body: source.body || '' };
  if (type === 'image' || type === 'video') {
    return { ...base, url: source.url || '', alt: source.alt || '', caption: source.caption || '' };
  }
  if (type === 'attachment') return { ...base, url: source.url || '', label: source.label || '' };
  if (type === 'accordion') {
    return {
      ...base,
      items: Array.isArray(source.items)
        ? source.items.map((item) => ({ ...item, id: item.id || createAuthoringId('item'), title: item.title || '', body: item.body || '' }))
        : [],
    };
  }
  if (type === 'flashcards') {
    return {
      ...base,
      cards: Array.isArray(source.cards)
        ? source.cards.map((card) => ({ ...card, id: card.id || createAuthoringId('card'), front: card.front || '', back: card.back || '' }))
        : [],
    };
  }
  if (type === 'hotspots') {
    return {
      ...base,
      url: source.url || '',
      alt: source.alt || '',
      points: Array.isArray(source.points)
        ? source.points.map((point) => ({
          ...point,
          id: point.id || createAuthoringId('point'),
          x: point.x ?? '',
          y: point.y ?? '',
          label: point.label || '',
          body: point.body || '',
        }))
        : [],
    };
  }
  if (type === 'check' || type === 'scenario') {
    const options = Array.isArray(source.options)
      ? source.options.map((option) => ({ ...option, id: option.id || createAuthoringId('option'), text: option.text || '' }))
      : [];
    return {
      ...base,
      prompt: source.prompt || '',
      body: source.body || '',
      options,
      correctOptionId: source.correctOptionId || '',
      explanation: source.explanation || '',
    };
  }
  return base;
}

export function normalizeDraft(draft) {
  const source = draft && typeof draft === 'object' ? draft : {};
  return {
    ...emptyDraft(),
    ...source,
    title: source.title || '',
    summary: source.summary || '',
    objectives: Array.isArray(source.objectives) ? source.objectives.map((objective) => String(objective ?? '')) : [],
    lessons: Array.isArray(source.lessons)
      ? source.lessons.map((lesson) => ({
        ...lesson,
        id: lesson?.id || createAuthoringId('lesson'),
        title: lesson?.title || '',
        blocks: Array.isArray(lesson?.blocks) ? lesson.blocks.map(normalizeBlock) : [],
      }))
      : [],
  };
}

export function invalidCourseError(message = 'The authoring service returned an invalid course.') {
  const error = new Error(message);
  error.error = message;
  error.status = 502;
  return error;
}

export function normalizeCourse(course) {
  if (!course || typeof course !== 'object' || !course.id || !course.draft) {
    throw invalidCourseError();
  }
  return { ...course, draft: normalizeDraft(course.draft) };
}

export function moveArrayItem(items, index, offset) {
  const nextIndex = index + offset;
  if (nextIndex < 0 || nextIndex >= items.length) return items;
  const next = items.slice();
  const [item] = next.splice(index, 1);
  next.splice(nextIndex, 0, item);
  return next;
}

export function isDraftDirty(draft, savedDraft) {
  return Boolean(draft && savedDraft && JSON.stringify(draft) !== JSON.stringify(savedDraft));
}

export const AUTHORING_RECOVERY_PREFIX = 'schoolcircle.authoring.unsaved.v1';

export function authoringAccountKey(profile, user) {
  return String(
    profile?.id
      || profile?.externalId
      || user?.uid
      || user?.email
      || 'anonymous',
  );
}

export function recoveryStorageKey(accountKey, courseId) {
  return `${AUTHORING_RECOVERY_PREFIX}:${encodeURIComponent(String(accountKey))}:${encodeURIComponent(String(courseId))}`;
}

export function createRecoveryBuffer({ accountKey, courseId, version, draft, savedAt = Date.now() }) {
  return {
    schema: 1,
    accountKey: String(accountKey),
    courseId: String(courseId),
    version,
    draft: cloneValue(draft),
    savedAt,
  };
}

export function readRecoveryBuffer(storage, key) {
  if (!storage || !key) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (
      value?.schema !== 1
      || typeof value.accountKey !== 'string'
      || typeof value.courseId !== 'string'
      || !value.draft
      || typeof value.draft !== 'object'
    ) return null;
    return value;
  } catch {
    return null;
  }
}

export function writeRecoveryBuffer(storage, key, buffer) {
  if (!storage || !key || !buffer) return false;
  try {
    storage.setItem(key, JSON.stringify(buffer));
    return true;
  } catch {
    return false;
  }
}

export function clearRecoveryBuffer(storage, key) {
  if (!storage || !key) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function recoveryRemoteStatus(buffer, remoteVersion) {
  if (!buffer) return 'none';
  return String(buffer.version) === String(remoteVersion) ? 'same-version' : 'remote-changed';
}
