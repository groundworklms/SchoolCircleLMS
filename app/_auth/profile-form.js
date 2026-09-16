import {
  getPayGrades,
  getRanks,
  PROFILE_ROLES,
  SERVICE_BRANCHES,
} from '../../lib/profile-options.js';

const ROLE_VALUES = new Set((PROFILE_ROLES || []).map((option) => option.value));
const BRANCH_VALUES = new Set((SERVICE_BRANCHES || []).map((option) => option.value));

function optionValues(options) {
  return new Set((options || []).map((option) => option.value));
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/*
 * Validate the account form at the client boundary as well as on the server.
 *
 * The old two-argument call is intentionally retained for consumers of the
 * first profile slice. New callers should pass one object (or all five
 * positional fields) so that a profile can never accidentally omit its role
 * or service branch.
 */
export function validateProfileFields(fieldsOrName, roleOrRank, branchArg, payGradeArg, rankArg) {
  const legacyCall = typeof fieldsOrName !== 'object' &&
    arguments.length <= 2;
  if (legacyCall) {
    const name = cleanText(fieldsOrName);
    const rank = cleanText(roleOrRank);
    if (name.length < 1 || name.length > 80) {
      return { error: 'Name must be between 1 and 80 characters.' };
    }
    if (rank.length > 40) {
      return { error: 'Rank must be 40 characters or fewer.' };
    }
    return { value: { name, rank: rank || null } };
  }

  const fields = fieldsOrName && typeof fieldsOrName === 'object'
    ? fieldsOrName
    : {
        name: fieldsOrName,
        role: roleOrRank,
        branch: branchArg,
        payGrade: payGradeArg,
        rank: rankArg,
      };
  const name = cleanText(fields.name);
  const role = cleanText(fields.role);
  const branch = cleanText(fields.branch);
  const payGrade = cleanText(fields.payGrade);
  const rank = cleanText(fields.rank);

  if (name.length < 1 || name.length > 80) {
    return { error: 'Name must be between 1 and 80 characters.' };
  }
  if (!ROLE_VALUES.has(role)) {
    return { error: 'Choose whether you are a learner, instructor, or both.' };
  }
  if (!BRANCH_VALUES.has(branch)) {
    return { error: 'Choose a service branch.' };
  }

  if (branch === 'CIVILIAN') {
    return { value: { name, role, branch, payGrade: null, rank: null } };
  }

  const grades = getPayGrades(branch);
  if (!optionValues(grades).has(payGrade)) {
    return { error: 'Choose a valid pay grade for this service branch.' };
  }
  const ranks = getRanks(branch, payGrade);
  if (!optionValues(ranks).has(rank)) {
    return { error: 'Choose a valid rank for this service branch and pay grade.' };
  }

  return { value: { name, role, branch, payGrade, rank } };
}
