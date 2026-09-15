import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// ID-token verification uses Google's public signing keys, not a service-account key.
export async function requireFirebaseUser(req) {
  const match = /^Bearer (\S+)$/i.exec(req.headers.get('authorization') || '');
  if (!match) {
    return Response.json({ error: 'Sign in to ask the doctrine.', code: 'UNAUTHENTICATED' }, { status: 401 });
  }

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) {
    return Response.json({ error: 'Sign-in is not configured.', code: 'AUTH_NOT_CONFIGURED' }, { status: 503 });
  }

  try {
    const app = getApps().find((app) => app.name === 'doctrine-auth')
      || initializeApp({ projectId }, 'doctrine-auth');
    await getAuth(app).verifyIdToken(match[1]);
    return null;
  } catch {
    // Never forward a question when the token cannot be verified.
    return Response.json({ error: 'Your session could not be verified. Please sign in again.', code: 'UNAUTHENTICATED' }, { status: 401 });
  }
}