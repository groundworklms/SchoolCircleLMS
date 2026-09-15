import { isCurrentProfileMutation, isCurrentProfileRequest } from './profile-race.js';

function clientError(body, status, fallback) {
  const message = body?.error || body?.message || fallback;
  const error = new Error(message);
  error.error = message;
  error.status = status;
  if (body?.code) error.code = body.code;
  return error;
}

/*
 * Stateful profile synchronization kept outside React so account transitions
 * can be tested with deferred requests. AuthProvider owns the Firebase
 * listener; this coordinator owns which response is allowed to publish.
 */
export function createProfileCoordinator({ getActiveUser, loadProfile, saveProfile }) {
  let observedUser = null;
  let account = null;
  let session = 0;
  let pendingGet = null;
  let state = { profile: null, loading: false, error: null };
  const listeners = new Set();

  const publish = (next) => {
    state = next;
    listeners.forEach((listener) => listener(state));
  };

  const invalidateGet = () => {
    pendingGet?.controller?.abort();
    pendingGet = null;
  };

  const requestIsCurrent = (expectedUser, expectedSession, request) =>
    isCurrentProfileRequest({
      mounted: true,
      expectedFirebaseUser: expectedUser,
      activeFirebaseUser: getActiveUser(),
      expectedSession,
      activeSession: session,
      expectedRequest: request,
      activeRequest: pendingGet,
      observedFirebaseUser: observedUser,
    });

  const load = async (expectedUser, expectedSession) => {
    invalidateGet();
    const request = { controller: new AbortController() };
    pendingGet = request;
    publish({ ...state, loading: true, error: null });
    try {
      const nextProfile = await loadProfile(expectedUser, { signal: request.controller.signal });
      if (!requestIsCurrent(expectedUser, expectedSession, request)) return null;
      account = nextProfile;
      publish({ profile: nextProfile, loading: false, error: null });
      return nextProfile;
    } catch (error) {
      if (!requestIsCurrent(expectedUser, expectedSession, request) || error?.name === 'AbortError') return null;
      const nextError = error?.error
        ? error
        : clientError(null, error?.status, error?.message || 'Unable to load your account.');
      account = null;
      publish({ profile: null, loading: false, error: nextError });
      return null;
    } finally {
      if (requestIsCurrent(expectedUser, expectedSession, request)) pendingGet = null;
    }
  };

  const onAuthStateChanged = (nextUser) => {
    session += 1;
    observedUser = nextUser;
    account = null;
    invalidateGet();
    publish({ profile: null, loading: Boolean(nextUser), error: null });
    if (nextUser) void load(nextUser, session);
  };

  const refresh = () => {
    const activeUser = getActiveUser();
    if (!activeUser || activeUser !== observedUser) {
      account = null;
      publish({ profile: null, loading: false, error: null });
      return Promise.resolve(null);
    }
    return load(activeUser, session);
  };

  const update = async ({ name, rank }) => {
    const activeUser = getActiveUser();
    const expectedUser = observedUser;
    const expectedAccount = account;
    const expectedSession = session;
    if (!activeUser || activeUser !== expectedUser || !expectedAccount) {
      throw clientError(null, 401, 'Sign in to update your account.');
    }

    // A GET started during account restoration must not be able to publish
    // over this mutation's response.
    invalidateGet();
    publish({ ...state, loading: false, error: null });

    try {
      const payload = {
        name: typeof name === 'string' ? name.trim() : '',
        rank: rank === null ? null : (typeof rank === 'string' ? rank.trim() : ''),
      };
      if (payload.rank === '') payload.rank = null;
      const nextProfile = await saveProfile(
        payload,
        { signal: undefined, user: expectedUser },
      );
      if (
        !isCurrentProfileMutation({
          expectedFirebaseUser: activeUser,
          activeFirebaseUser: getActiveUser(),
          observedFirebaseUser: expectedUser,
          expectedSession,
          activeSession: session,
          expectedProfileId: expectedAccount.id,
          activeProfileId: account?.id,
        })
      ) {
        throw clientError(null, 409, 'Your account changed while saving. Please try again.');
      }
      account = nextProfile;
      publish({ profile: nextProfile, loading: false, error: null });
      return nextProfile;
    } catch (error) {
      if (error?.error) throw error;
      throw clientError(null, error?.status, error?.message || 'Unable to save your account.');
    }
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onAuthStateChanged,
    refresh,
    update,
  };
}

export { clientError };