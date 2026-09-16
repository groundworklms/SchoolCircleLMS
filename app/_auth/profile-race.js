/*
 * Small, dependency-free guards for profile requests. Firebase can emit a
 * sign-out followed by a sign-in for the same UID; object identity and the
 * session counter are both intentional parts of the check.
 */
export function isCurrentProfileRequest({
  expectedFirebaseUser,
  activeFirebaseUser,
  expectedSession,
  activeSession,
  expectedRequest,
  activeRequest,
  observedFirebaseUser = activeFirebaseUser,
  mounted = true,
}) {
  return Boolean(
    mounted &&
      expectedFirebaseUser &&
      expectedFirebaseUser === activeFirebaseUser &&
      expectedFirebaseUser === observedFirebaseUser &&
      expectedSession === activeSession &&
      expectedRequest === activeRequest,
  );
}

export function isCurrentProfileMutation({
  expectedFirebaseUser,
  activeFirebaseUser,
  expectedSession,
  activeSession,
  expectedProfileId,
  activeProfileId,
  observedFirebaseUser = activeFirebaseUser,
}) {
  return Boolean(
    expectedFirebaseUser &&
      expectedFirebaseUser === activeFirebaseUser &&
      expectedFirebaseUser === observedFirebaseUser &&
      expectedSession === activeSession &&
      expectedProfileId &&
      expectedProfileId === activeProfileId,
  );
}