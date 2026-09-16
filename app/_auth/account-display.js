export function accountDisplay({ ready, profile, demo }) {
  const authenticated = Boolean(ready && profile);
  const source = authenticated ? profile : demo;
  const name = source?.name || (authenticated ? 'Account' : demo.name);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || demo.initials;

  return {
    authenticated,
    name,
    rank: authenticated ? profile.rank || null : null,
    initials,
    account: authenticated ? profile : null,
  };
}