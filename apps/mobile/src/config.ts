/**
 * Public Supabase settings. The publishable key is meant to ship inside the
 * app; row-level security and the Edge Functions guard the data.
 */
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://sxkembehrqovjmovagwy.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_KEY ?? 'sb_publishable_eu98CP8qgSb6JHi3bOBZbA_XvGJWFU1';
