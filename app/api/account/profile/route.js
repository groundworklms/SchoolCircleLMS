import { accountProfileHandlers } from '../../../../lib/account-profile.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const { GET, PATCH } = accountProfileHandlers();