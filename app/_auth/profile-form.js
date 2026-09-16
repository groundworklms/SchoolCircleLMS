export function validateProfileFields(name, rank) {
  const nextName = typeof name === 'string' ? name.trim() : '';
  const nextRank = typeof rank === 'string' ? rank.trim() : '';
  if (nextName.length < 1 || nextName.length > 80) {
    return { error: 'Name must be between 1 and 80 characters.' };
  }
  if (nextRank.length > 40) {
    return { error: 'Rank must be 40 characters or fewer.' };
  }
  return { value: { name: nextName, rank: nextRank || null } };
}