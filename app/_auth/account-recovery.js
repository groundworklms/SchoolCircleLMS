export async function signOutAndNavigateToLogin({ signOut, navigate, returnTo = '/prototype' }) {
  await signOut();
  const destination = `/login?next=${encodeURIComponent(returnTo)}`;
  navigate(destination);
  return destination;
}