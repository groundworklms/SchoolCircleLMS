/**
 * Persistence and authorization helpers for the source library.
 *
 * Source PDFs deliberately live in a second LearningRecord.  Keeping the
 * binary out of SOURCE payloads means the normal source list/get and ingest
 * responses can never accidentally serialise it.
 */
import {
  db,
  createLearningRecord,
  getLearningRecord,
  listLearningRecords,
  updateLearningRecordIfVersion,
} from '../db.js';
import { hasRole } from '../auth.js';
import { notFound } from '../learning/http.js';

export const SOURCE_TYPE = 'SOURCE';
export const SOURCE_PDF_TYPE = 'SOURCE_PDF';
export const SOURCE_REMOVED_STATUS = 'REMOVED';
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

const PDF_SIGNATURE = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
const INSTRUCTOR = 'INSTRUCTOR';

function payloadOf(record) {
  return record?.payload && typeof record.payload === 'object' ? record.payload : {};
}

export function isRemovedSource(record) {
  return record?.type === SOURCE_TYPE && record.status === SOURCE_REMOVED_STATUS;
}

function sourcePdfSourceId(record) {
  const payload = payloadOf(record);
  return payload.sourceRecordId || payload.sourceId || null;
}

function isMemoryTestAdapter() {
  return (
    db?.sourcePdfTestAdapter === 'memory' ||
    db?.learningRecord?.sourcePdfTestAdapter === 'memory'
  );
}

function sourceGuardConflict(message = 'Source changed while the draft was being generated.') {
  const error = new Error(message);
  error.code = 'SOURCE_GUARD_CONFLICT';
  error.status = 409;
  return error;
}

function sourcePdfExistsError() {
  const error = new Error('Source already has an original PDF.');
  error.code = 'SOURCE_PDF_EXISTS';
  error.status = 409;
  return error;
}

export function sourcePdfRecordId(sourceId) {
  return `${sourceId}:pdf`;
}

export function sourcePdfRecordFor(sourceId, records = []) {
  return records.find((record) => (
    record?.type === SOURCE_PDF_TYPE &&
    sourcePdfSourceId(record) === sourceId
  )) || null;
}

function sourcePdfWhere(sourceId) {
  return {
    type: SOURCE_PDF_TYPE,
    OR: [
      { payload: { path: ['sourceRecordId'], equals: sourceId } },
      { payload: { path: ['sourceId'], equals: sourceId } },
    ],
  };
}

async function targetedSourcePdf(client, sourceId, { metadataOnly = false } = {}) {
  const model = client?.learningRecord;
  if (typeof model?.findUnique === 'function' && typeof model?.findFirst === 'function') {
    const select = metadataOnly ? { id: true } : undefined;
    const deterministic = await model.findUnique({
      where: { id: sourcePdfRecordId(sourceId) },
      ...(select ? { select } : {}),
    });
    if (deterministic) return deterministic;
    return model.findFirst({
      where: sourcePdfWhere(sourceId),
      ...(select ? { select } : {}),
    });
  }

  // Production Prisma always takes the targeted path above.  The explicit
  // marker is used by injected in-memory adapters so contract tests do not
  // need a Prisma client; never silently make this fallback for a production
  // client that lacks the required query surface.
  if (!isMemoryTestAdapter()) {
    throw new TypeError('A targeted SOURCE_PDF adapter is required');
  }
  const records = await listLearningRecords({ type: SOURCE_PDF_TYPE });
  return sourcePdfRecordFor(sourceId, records);
}

export async function sourcePdfFor(sourceId) {
  return targetedSourcePdf(db, sourceId);
}

export async function sourcePdfMap(sourceIds) {
  const wanted = new Set(
    (Array.isArray(sourceIds) ? sourceIds : [])
      .filter((id) => typeof id === 'string' && id.trim())
      .map((id) => id.trim()),
  );
  if (wanted.size === 0) return new Map();
  const model = db?.learningRecord;
  if (typeof model?.findMany === 'function') {
    const deterministic = await model.findMany({
      where: { id: { in: [...wanted].map(sourcePdfRecordId) } },
      select: { id: true },
    });
    const result = new Map(
      deterministic.map((record) => [
        record.id.slice(0, -':pdf'.length),
        record,
      ]),
    );
    const missing = [...wanted].filter((sourceId) => !result.has(sourceId));
    const legacy = await Promise.all(
      missing.map(async (sourceId) => [
        sourceId,
        await targetedSourcePdf(db, sourceId, { metadataOnly: true }),
      ]),
    );
    for (const [sourceId, record] of legacy) {
      if (record) result.set(sourceId, record);
    }
    return result;
  }
  const rows = await Promise.all(
    [...wanted].map(async (sourceId) => [sourceId, await targetedSourcePdf(db, sourceId, { metadataOnly: true })]),
  );
  return new Map(rows.filter(([, record]) => record));
}

async function hasApprovedCitation(sourceId) {
  const courses = await listLearningRecords({
    type: 'COURSE_DRAFT',
    status: 'APPROVED',
  });
  return courses.some((course) => {
    const sourceIds = payloadOf(course).sourceIds;
    return Array.isArray(sourceIds) && sourceIds.includes(sourceId);
  });
}

/**
 * Resolve a source without allowing a removed source back into a new draft.
 * A removed source remains readable when it is an archived citation in an
 * approved course.  The approved-course check is intentionally independent of
 * the requesting user's ownership, because approved courses are learner
 * visible to every authenticated member.
 */
export async function sourceFor(
  identity,
  id,
  { approvedOnly = false, allowArchivedCitation = false, rejectRemoved = false } = {},
) {
  const record = await getLearningRecord(id);
  if (!record || record.type !== SOURCE_TYPE) throw notFound('Source not found');

  if (isRemovedSource(record)) {
    if (rejectRemoved) throw notFound('Source not found');
    const ownerInstructor =
      hasRole(identity?.role, INSTRUCTOR) && record.ownerId === identity?.id;
    const archived = allowArchivedCitation && await hasApprovedCitation(record.id);
    // approvedOnly is used by new course/rubric-style generation paths.  A
    // removed source can only cross that boundary as an existing approved
    // course citation, never merely because its owner is an instructor.
    if ((!approvedOnly && ownerInstructor) || archived) return record;
    throw notFound('Source not found');
  }

  if (approvedOnly && record.status !== 'APPROVED') throw notFound('Source not found');
  if (record.status !== 'APPROVED' && !hasRole(identity?.role, INSTRUCTOR)) {
    throw notFound('Source not found');
  }
  if (record.ownerId !== identity?.id && record.status !== 'APPROVED') {
    throw notFound('Source not found');
  }
  return record;
}

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

function base64ToBytes(value) {
  if (
    typeof value !== 'string' ||
    value.length > Math.ceil(MAX_PDF_BYTES / 3) * 4 + 4 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new Error('Stored source PDF is invalid');
  }
  const bytes = new Uint8Array(Buffer.from(value, 'base64'));
  if (
    bytes.byteLength > MAX_PDF_BYTES ||
    bytes.length < PDF_SIGNATURE.length ||
    PDF_SIGNATURE.some((part, index) => bytes[index] !== part)
  ) {
    throw new Error('Stored source PDF is invalid');
  }
  return bytes;
}

export function normalisePdfText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

function expectedSourcePages(source) {
  const payload = payloadOf(source);
  const pages = Array.isArray(payload.pages) ? payload.pages : [];
  const pageProjection = pages
    .map((page, index) => ({
      page: Number.isInteger(page?.page) && page.page > 0 ? page.page : index + 1,
      text: typeof page === 'string' ? page : page?.text,
    }))
    .filter((page) => typeof page.text === 'string');
  if (pageProjection.length) return pageProjection;

  const chunks = Array.isArray(payload.chunks) ? payload.chunks : [];
  const grouped = new Map();
  for (const [index, chunk] of chunks.entries()) {
    if (typeof chunk?.text !== 'string') continue;
    const page = Number.isInteger(chunk.page) && chunk.page > 0 ? chunk.page : index + 1;
    if (!grouped.has(page)) grouped.set(page, []);
    grouped.get(page).push(chunk.text);
  }
  if (grouped.size) {
    return [...grouped.entries()].map(([page, text]) => ({ page, text: text.join('\n') }));
  }

  const text = typeof payload.text === 'string' ? payload.text : '';
  return text ? [{ page: 1, text }] : [];
}

/**
 * Compare the page projection persisted by Quarry with a newly extracted
 * original.  Page labels can differ on legacy records; page count and the
 * ordered, normalised text are the integrity boundary.
 */
export function validatePdfPages(source, extractedPages) {
  const expected = expectedSourcePages(source);
  const actual = (Array.isArray(extractedPages) ? extractedPages : [])
    .map((text) => (typeof text === 'string' ? text : text?.text))
    .filter((text) => typeof text === 'string')
    .map((text) => normalisePdfText(text));

  if (expected.length !== actual.length) {
    const error = new Error(
      `PDF page count does not match source text (expected ${expected.length}, got ${actual.length}).`,
    );
    error.code = 'SOURCE_PDF_MISMATCH';
    error.status = 409;
    throw error;
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (normalisePdfText(expected[index].text) !== actual[index]) {
      const error = new Error(`PDF page ${index + 1} text does not match the source text.`);
      error.code = 'SOURCE_PDF_MISMATCH';
      error.status = 409;
      throw error;
    }
  }
  return true;
}

function pdfPayload(source, bytes, file, extractedPages) {
  return {
    sourceRecordId: source.id,
    sourceId: payloadOf(source).sourceId || null,
    filename: typeof file?.name === 'string' && file.name.trim() ? file.name.trim() : null,
    mimeType: 'application/pdf',
    byteLength: bytes.byteLength,
    pageCount: extractedPages.length,
    bytesBase64: bytesToBase64(bytes),
  };
}

function sourceRecordData(ownerId, payload, status = 'PENDING') {
  return { ownerId, type: SOURCE_TYPE, status, payload };
}

function pdfRecordData(ownerId, payload, id) {
  return {
    ...(id ? { id } : {}),
    ownerId,
    type: SOURCE_PDF_TYPE,
    status: 'STORED',
    payload,
  };
}

/**
 * New PDF sources and their binary record are committed together when the
 * production adapter exposes Prisma transactions.  A deliberately small
 * fallback keeps injected in-memory adapters usable in focused tests.
 */
export async function createSourceWithPdf({
  ownerId,
  sourcePayload,
  bytes,
  file,
  extractedPages,
}) {
  const pdf = pdfPayload({ id: '__SOURCE_ID__', payload: sourcePayload }, bytes, file, extractedPages);
  if (typeof db?.$transaction === 'function') {
    return db.$transaction(async (tx) => {
      const source = await tx.learningRecord.create({
        data: sourceRecordData(ownerId, sourcePayload),
      });
      const storedPdf = await tx.learningRecord.create({
        data: pdfRecordData(
          ownerId,
          { ...pdf, sourceRecordId: source.id },
          sourcePdfRecordId(source.id),
        ),
      });
      return { source, pdf: storedPdf };
    });
  }

  if (!isMemoryTestAdapter()) {
    throw new TypeError('A transactional SOURCE_PDF adapter is required');
  }
  const source = await createLearningRecord(sourceRecordData(ownerId, sourcePayload));
  const storedPdf = await createLearningRecord({
    ...pdfRecordData(ownerId, { ...pdf, sourceRecordId: source.id }),
  });
  return { source, pdf: storedPdf };
}

export async function attachSourcePdf(source, { ownerId, bytes, file, extractedPages }) {
  const existing = await sourcePdfFor(source.id);
  if (existing) {
    throw sourcePdfExistsError();
  }

  const payload = pdfPayload(source, bytes, file, extractedPages);
  if (typeof db?.$transaction === 'function') {
    return db.$transaction(async (tx) => {
      if (await targetedSourcePdf(tx, source.id, { metadataOnly: true })) {
        throw sourcePdfExistsError();
      }
      try {
        return await tx.learningRecord.create({
          data: pdfRecordData(ownerId, payload, sourcePdfRecordId(source.id)),
        });
      } catch (error) {
        if (error?.code === 'P2002') throw sourcePdfExistsError();
        throw error;
      }
    });
  }
  if (!isMemoryTestAdapter()) {
    throw new TypeError('A transactional SOURCE_PDF adapter is required');
  }
  return createLearningRecord(pdfRecordData(ownerId, payload));
}

/**
 * Commit an authoring record only while every source still has the exact
 * version/status observed before generation.  The production transaction
 * increments each source version as a conditional row update, which acquires
 * the row lock before the new record is created.  A failed create rolls those
 * source touches back with the transaction.
 */
export async function createRecordWithSourceGuards({
  ownerId,
  type,
  status = 'PENDING',
  payload,
  sources = [],
}) {
  const guards = [...sources]
    .filter((source) => source && typeof source.id === 'string')
    .map((source) => ({
      id: source.id,
      version: Number.isInteger(source.version) ? source.version : 0,
      status: typeof source.status === 'string' ? source.status : 'APPROVED',
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (typeof db?.$transaction === 'function') {
    try {
      return await db.$transaction(async (tx) => {
        for (const guard of guards) {
          const changed = await tx.learningRecord.updateMany({
            where: {
              id: guard.id,
              type: SOURCE_TYPE,
              status: guard.status,
              version: guard.version,
            },
            data: { version: { increment: 1 } },
          });
          if (changed.count !== 1) throw sourceGuardConflict();
        }
        return tx.learningRecord.create({
          data: { ownerId, type, status, payload },
        });
      });
    } catch (error) {
      if (error?.code === 'SOURCE_GUARD_CONFLICT') throw error;
      throw error;
    }
  }
  if (!isMemoryTestAdapter()) {
    throw new TypeError('A transactional source adapter is required');
  }
  for (const guard of guards) {
    const current = await getLearningRecord(guard.id);
    if (
      !current ||
      current.type !== SOURCE_TYPE ||
      current.status !== guard.status ||
      current.version !== guard.version
    ) {
      throw sourceGuardConflict();
    }
  }
  return createLearningRecord({ ownerId, type, status, payload });
}

/**
 * Source lifecycle transitions must match both the observed version and
 * status.  Prisma's conditional update acquires the row lock, while the
 * explicit memory adapter keeps the same check for hermetic tests.
 */
export async function updateSourceStatusIfVersion(
  sourceId,
  version,
  fromStatus,
  toStatus,
) {
  if (typeof db?.learningRecord?.updateMany === 'function') {
    const result = await db.learningRecord.updateMany({
      where: {
        id: sourceId,
        type: SOURCE_TYPE,
        status: fromStatus,
        version,
      },
      data: { status: toStatus, version: { increment: 1 } },
    });
    return result.count === 1;
  }
  if (!isMemoryTestAdapter()) {
    throw new TypeError('A conditional source status adapter is required');
  }
  const current = await getLearningRecord(sourceId);
  if (
    !current ||
    current.type !== SOURCE_TYPE ||
    current.status !== fromStatus ||
    current.version !== version
  ) {
    return false;
  }
  return updateLearningRecordIfVersion(sourceId, version, { status: toStatus });
}

export function pdfBytes(pdfRecord) {
  return base64ToBytes(payloadOf(pdfRecord).bytesBase64);
}

function sanitiseFilenamePart(value) {
  return String(value || '')
    .replace(/[\r\n"]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[-.]+/, '')
    .slice(0, 180);
}

export function safePdfFilename(source, pdfRecord) {
  const payload = payloadOf(pdfRecord);
  const sourcePayload = payloadOf(source);
  const supplied = sanitiseFilenamePart(payload.filename);
  const fallback = sanitiseFilenamePart(
    sourcePayload.title || sourcePayload.sourceId || source.id || 'source',
  );
  const base = (supplied || fallback || 'source').replace(/\.pdf$/i, '');
  return `${base || 'source'}.pdf`;
}

export async function sourcePdfResponse(identity, id) {
  const source = await sourceFor(identity, id, {
    approvedOnly: !hasRole(identity?.role, INSTRUCTOR),
    allowArchivedCitation: true,
  });
  const stored = await sourcePdfFor(source.id);
  if (!stored) throw notFound('Source PDF not found');
  const bytes = pdfBytes(stored);
  return {
    status: 200,
    body: bytes,
    headers: {
      'content-type': 'application/pdf',
      'cache-control': 'private, no-store',
      'content-disposition': `inline; filename="${safePdfFilename(source, stored)}"`,
    },
  };
}

export function sourceSummary(record, payload, { hasPdf = false, canRemove = false } = {}) {
  const body = payloadOf({ payload });
  return {
    id: record.id,
    status: record.status,
    title: body.title,
    sourceId: body.sourceId,
    pages: Array.isArray(body.pages) ? body.pages.length : 0,
    chunks: Array.isArray(body.chunks) ? body.chunks.length : 0,
    canRemove: Boolean(canRemove),
    hasPdf: Boolean(hasPdf),
  };
}

/**
 * Keep source responses explicit and defensive.  The current storage format
 * uses SOURCE_PDF records, but stripping legacy inline binary keys prevents an
 * old adapter payload from turning into a metadata leak.
 */
export function publicSourcePayload(payload) {
  const blocked = new Set([
    'bytes',
    'base64',
    'bytesBase64',
    'pdf',
    'pdfBase64',
    'pdfBytes',
    'originalPdf',
    'file',
  ]);
  const clean = (value) => {
    if (Array.isArray(value)) return value.map(clean);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !blocked.has(key) && !/base64/i.test(key))
        .map(([key, nested]) => [key, clean(nested)]),
    );
  };
  return clean(payload && typeof payload === 'object' ? payload : {});
}