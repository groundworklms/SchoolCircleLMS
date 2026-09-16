import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authoringAccountKey,
  clearRecoveryBuffer,
  createRecoveryBuffer,
  duplicateWithFreshIds,
  emptyDraft,
  isDraftDirty,
  moveArrayItem,
  newBlock,
  newLesson,
  readRecoveryBuffer,
  recoveryRemoteStatus,
  recoveryStorageKey,
  normalizeDraft,
  writeRecoveryBuffer,
} from '../app/_authoring/editor-pure.mjs';
import { validateDraft } from '../lib/authoring/content.js';

function sequentialIds() {
  let count = 0;
  return () => `copy_${++count}`;
}

function allIds(value, result = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => allIds(item, result));
  } else if (value && typeof value === 'object') {
    if (typeof value.id === 'string') result.push(value.id);
    Object.values(value).forEach((item) => allIds(item, result));
  }
  return result;
}

test('duplicateWithFreshIds regenerates lesson, block, and nested IDs', () => {
  const lesson = {
    id: 'lesson-original',
    title: 'Safety',
    blocks: [{
      id: 'block-original',
      type: 'accordion',
      items: [{ id: 'item-original', title: 'One', body: 'Body' }],
    }, {
      id: 'check-original',
      type: 'check',
      options: [
        { id: 'option-a', text: 'A' },
        { id: 'option-b', text: 'B' },
      ],
      correctOptionId: 'option-b',
    }],
  };
  const copy = duplicateWithFreshIds(lesson, sequentialIds());

  assert.notDeepEqual(copy, lesson);
  assert.equal(allIds(copy).length, 6);
  assert.equal(new Set(allIds(copy)).size, 6);
  assert.deepEqual(allIds(copy), ['copy_1', 'copy_2', 'copy_3', 'copy_4', 'copy_5', 'copy_6']);
  assert.equal(copy.blocks[1].correctOptionId, copy.blocks[1].options[1].id);
  assert.notEqual(copy.blocks[1].correctOptionId, lesson.blocks[1].correctOptionId);
  assert.deepEqual(lesson.blocks[1].options.map((option) => option.id), ['option-a', 'option-b']);
});

test('editor-created multiline duplicated lessons satisfy the draft contract', () => {
  const draft = emptyDraft();
  draft.title = 'Manual safety course';
  draft.summary = 'A short course with authored Markdown.';
  const lesson = newLesson();
  lesson.title = 'Lesson one';

  const text = newBlock('text');
  text.body = '# Heading\n\nUse the checklist before starting.';
  const check = newBlock('check');
  check.prompt = 'Which step comes first?\nChoose one.';
  check.body = 'Review the context.\nThen select an answer.';
  check.options = [
    { ...check.options[0], text: 'Review the context' },
    { id: 'option-second', text: 'Skip the briefing' },
  ];
  check.correctOptionId = check.options[0].id;
  check.explanation = 'The briefing comes first.\nIt sets the context.';
  const accordion = newBlock('accordion');
  accordion.items[0].title = 'Why it matters';
  accordion.items[0].body = 'A clear briefing reduces risk.\nIt also gives the team a shared plan.';
  lesson.blocks = [text, check, accordion];
  draft.lessons = [lesson];

  const duplicate = duplicateWithFreshIds(lesson);
  const editorDraft = normalizeDraft({
    ...draft,
    lessons: moveArrayItem([...draft.lessons, duplicate], 1, -1),
  });
  const validation = validateDraft(editorDraft);

  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  assert.deepEqual(validation.errors, []);
  assert.equal(editorDraft.lessons.length, 2);
  for (const copiedLesson of editorDraft.lessons) {
    const copiedCheck = copiedLesson.blocks.find((block) => block.type === 'check');
    assert.ok(copiedCheck.options.some((option) => option.id === copiedCheck.correctOptionId));
    assert.match(copiedLesson.blocks.find((block) => block.type === 'text').body, /\n/);
    assert.match(copiedLesson.blocks.find((block) => block.type === 'accordion').items[0].body, /\n/);
  }
  assert.notEqual(
    editorDraft.lessons[0].blocks.find((block) => block.type === 'check').correctOptionId,
    editorDraft.lessons[1].blocks.find((block) => block.type === 'check').correctOptionId,
  );
});

test('moveArrayItem returns reordered copy and keeps source unchanged', () => {
  const source = ['one', 'two', 'three'];
  assert.deepEqual(moveArrayItem(source, 2, -1), ['one', 'three', 'two']);
  assert.deepEqual(moveArrayItem(source, 0, 1), ['two', 'one', 'three']);
  assert.deepEqual(moveArrayItem(source, 0, -1), source);
  assert.deepEqual(source, ['one', 'two', 'three']);
});

test('isDraftDirty distinguishes an unchanged saved snapshot from edits', () => {
  const saved = { title: 'Course', lessons: [{ id: 'lesson-1', blocks: [] }] };
  assert.equal(isDraftDirty(saved, structuredClone(saved)), false);
  assert.equal(isDraftDirty({ ...saved, title: 'Changed' }, saved), true);
  assert.equal(isDraftDirty(null, saved), false);
  assert.equal(isDraftDirty(saved, null), false);
});

test('recovery buffers are account/course scoped and explicit to restore or discard', () => {
  const storage = new Map();
  storage.getItem = storage.get.bind(storage);
  storage.setItem = (key, value) => storage.set(key, value);
  storage.removeItem = storage.delete.bind(storage);
  const account = authoringAccountKey({ id: 'account-1' }, { uid: 'firebase-1' });
  const key = recoveryStorageKey(account, 'course-1');
  const draft = { title: 'Local edits', lessons: [] };
  const buffer = createRecoveryBuffer({
    accountKey: account,
    courseId: 'course-1',
    version: 7,
    draft,
    savedAt: 123,
  });

  assert.equal(writeRecoveryBuffer(storage, key, buffer), true);
  assert.deepEqual(readRecoveryBuffer(storage, key), buffer);
  assert.equal(recoveryRemoteStatus(buffer, 7), 'same-version');
  assert.equal(recoveryRemoteStatus(buffer, 8), 'remote-changed');
  assert.deepEqual(readRecoveryBuffer(storage, recoveryStorageKey(account, 'course-2')), null);
  assert.equal(clearRecoveryBuffer(storage, key), true);
  assert.equal(readRecoveryBuffer(storage, key), null);
  assert.deepEqual(draft, { title: 'Local edits', lessons: [] });
});
