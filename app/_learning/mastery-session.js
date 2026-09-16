/**
 * Prefer a session created for the currently approved shared plan over a
 * legacy ACTIVE record. If no approved plan is available, retain the original
 * ACTIVE-first behavior so older learner evidence remains visible.
 */
export function selectMasterySession(sessions, masteryPlan) {
  if (!Array.isArray(sessions) || sessions.length === 0) return null;

  const approvedRevision =
    masteryPlan?.status === 'APPROVED' && masteryPlan.revision
      ? masteryPlan.revision
      : null;
  if (approvedRevision) {
    const currentPlanSessions = sessions.filter(
      (session) => session?.masteryPlanRevision === approvedRevision,
    );
    if (currentPlanSessions.length > 0) {
      return currentPlanSessions.find((session) => session.status === 'ACTIVE') || currentPlanSessions[0];
    }
  }

  return sessions.find((session) => session.status === 'ACTIVE') || sessions[0];
}