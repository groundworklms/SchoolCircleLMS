/**
 * The learner view: one account, answered the way a learner would be answered.
 *
 * An instructor may read their own unpublished course drafts — canViewCourse
 * admits a course by approval OR by ownership — which is correct everywhere
 * they author. It is wrong on the student side. "View as student" is precisely
 * the control an instructor uses to confirm the product's central promise,
 * that nothing unreviewed reaches a student, and answering it with the owner's
 * view showed them a "Draft · needs review" course sitting in Available
 * courses: false, and false in the reassuring direction.
 *
 * So a request made from a learner surface says so, and the server drops the
 * instructor capability for that request (lib/auth.js `learnerScopedIdentity`,
 * applied in lib/learning/http.js). The header is not a role claim and cannot
 * be one: it only ever subtracts, the role still comes from the database, and
 * the instructor surfaces never send it, so nothing an instructor can do today
 * becomes harder.
 *
 * This module is deliberately free of React, Next and firebase-admin so the
 * browser and the route handlers can share the one definition.
 */
import { BASE, parse } from '../app/prototype/routes.js';

export const LEARNER_VIEW_HEADER = 'x-schoolcircle-view';
export const LEARNER_VIEW = 'learner';

/**
 * Whether a prototype pathname is a learner surface.
 *
 * The URL already decides the role, so it also decides which view a request is
 * made from: every learner screen is covered by one rule, no flag is threaded
 * through a component tree, and an instructor screen cannot opt in by mistake.
 * Anything outside the prototype's grammar — including its explicit not-found
 * location — is left alone rather than guessed at.
 */
export function isLearnerSurface(pathname) {
  if (typeof pathname !== 'string') return false;
  if (pathname !== BASE && !pathname.startsWith(`${BASE}/`)) return false;
  const location = parse(pathname);
  return location.role === 'student' && location.area !== 'not-found';
}

/** Whether a request asked to be answered as a learner. */
export function asksForLearnerView(request) {
  const asked = request?.headers?.get?.(LEARNER_VIEW_HEADER);
  return typeof asked === 'string' && asked.trim().toLowerCase() === LEARNER_VIEW;
}
