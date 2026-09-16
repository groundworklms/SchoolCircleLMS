/*
 * The login redirect is built from the browser's same-origin location rather
 * than from a router hook.  Keeping this pure also avoids making AuthGuard
 * depend on useSearchParams (which would force a client-rendering bailout).
 */

export function currentPathAndQuery(location) {
  const pathname = location?.pathname;
  if (
    typeof pathname !== 'string' ||
    !pathname.startsWith('/') ||
    pathname.startsWith('//') ||
    pathname.includes('\\')
  ) {
    return '/prototype';
  }

  const search = typeof location.search === 'string' && location.search.startsWith('?')
    ? location.search
    : '';
  return `${pathname}${search}`;
}

export function loginHref(returnTo = '/prototype') {
  const path = currentPathAndQuery({
    pathname: typeof returnTo === 'string' ? returnTo.split(/[?#]/, 1)[0] : null,
    search: typeof returnTo === 'string' && returnTo.includes('?')
      ? `?${returnTo.split('?').slice(1).join('?').split('#', 1)[0]}`
      : '',
  });
  return `/login?next=${encodeURIComponent(path)}`;
}