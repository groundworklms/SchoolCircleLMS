// /api/auth/user -- who the bearer Firebase token is, as SchoolCircle sees it.
// The role comes from the Prisma User row, never from the token or the client.
// Anonymous callers get { user: null } (200), so the UI can render a sign-in prompt.
import { resolveIdentity } from '../../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };

export async function GET(request) {
  try {
    const user = await resolveIdentity(request);
    if (!user) return Response.json({ user: null }, { headers });
    return Response.json({
      user: {
        id: user.id,
        name: user.name,
        rank: user.rank || null,
        profileCompletedAt: user.profileCompletedAt || null,
        role: user.role,
        externalId: user.externalId,
        email: user.email || null,
        firstName: user.firstName || null,
        lastName: user.lastName || null,
        profileImageUrl: user.profileImageUrl || null,
      },
    }, { headers });
  } catch (error) {
    return Response.json(
      { error: 'Identity service unavailable', code: 'AUTH_UNAVAILABLE' },
      { status: 503, headers },
    );
  }
}
