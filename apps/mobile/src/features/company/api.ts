import { supabase } from '../../lib/supabase';
import { loadReceiptImage } from '../../store/receiptImages';
import type { NewSubmission, SubmissionSnapshot } from './snapshot';

export type Role = 'owner' | 'admin' | 'approver' | 'member';
export const canApprove = (r: Role | undefined) => r === 'owner' || r === 'admin' || r === 'approver';
export const canManage = (r: Role | undefined) => r === 'owner' || r === 'admin';

export interface Company {
  id: string;
  name: string;
  home_currency: string;
  role: Role;
}

export interface Member {
  user_id: string;
  email: string | null;
  role: Role;
}

export type SubmissionStatus = 'submitted' | 'approved' | 'rejected';

export interface Submission {
  id: string;
  org_id: string;
  user_id: string;
  trip_id: string;
  title: string;
  period: string;
  base_currency: string;
  total: string;
  item_count: number;
  flagged_count: number;
  status: SubmissionStatus;
  submitted_at: string;
  submitter: string | null;
  decider: string | null;
  decided_at: string | null;
  comment: string | null;
}

export type SubmissionDetail = Submission & { snapshot: SubmissionSnapshot };

const LIST_COLUMNS =
  'id,org_id,user_id,trip_id,title,period,base_currency,total,item_count,flagged_count,status,submitted_at,submitter,decider,decided_at,comment';

/** Postgres error codes the screens explain in words. */
export type CompanyError = 'account' | 'code' | 'permission' | 'network' | 'other';

export function toCompanyError(e: unknown): CompanyError {
  const err = e as { code?: string; message?: string } | null;
  if (err?.message === 'account required') return 'account';
  if (err?.code === 'P0002') return 'code';
  if (err?.code === '42501') return 'permission';
  if (err?.message?.includes('Failed to fetch') || err?.message?.includes('Network')) return 'network';
  return 'other';
}

async function check<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data;
}

export const myCompanies = () => check(supabase().rpc('my_companies')) as Promise<Company[]>;
export const createCompany = (name: string, currency: string) =>
  check(supabase().rpc('create_company', { p_name: name, p_currency: currency })) as Promise<string>;
export const createInvite = (orgId: string) => check(supabase().rpc('create_invite', { p_org: orgId })) as Promise<string>;
export const joinCompany = (code: string) => check(supabase().rpc('join_company', { p_code: code })) as Promise<string>;
export const setMemberRole = (orgId: string, userId: string, role: Role) =>
  check(supabase().rpc('set_member_role', { p_org: orgId, p_user: userId, p_role: role }));
export const removeMember = (orgId: string, userId: string) =>
  check(supabase().rpc('remove_member', { p_org: orgId, p_user: userId }));
export const decideSubmission = (id: string, approve: boolean, comment: string) =>
  check(supabase().rpc('decide_submission', { p_id: id, p_approve: approve, p_comment: comment }));

export const members = (orgId: string) =>
  check(supabase().from('org_members').select('user_id,email,role').eq('org_id', orgId).order('created_at')) as Promise<Member[]>;

/** Submissions an approver sees for the company, newest first. */
export const companySubmissions = (orgId: string) =>
  check(supabase().from('submissions').select(LIST_COLUMNS).eq('org_id', orgId).order('submitted_at', { ascending: false }).limit(200)) as Promise<
    Submission[]
  >;

/** The caller's own submissions for one trip, newest first. */
export const tripSubmissions = async (tripId: string) => {
  const { data } = await supabase().auth.getSession();
  const uid = data.session?.user.id ?? '';
  return check(
    supabase().from('submissions').select(LIST_COLUMNS).eq('user_id', uid).eq('trip_id', tripId).order('submitted_at', { ascending: false }),
  ) as Promise<Submission[]>;
};

export const submissionDetail = (id: string) =>
  check(supabase().from('submissions').select(`${LIST_COLUMNS},snapshot`).eq('id', id).single()) as Promise<SubmissionDetail>;

export const submissionFiles = (id: string) =>
  check(supabase().from('submission_files').select('receipt_id,uri').eq('submission_id', id)) as Promise<Array<{ receipt_id: string; uri: string }>>;

/** Sends the trip and copies its receipt photos alongside. */
export async function submit(sub: NewSubmission): Promise<string> {
  const row = (await check(supabase().from('submissions').insert(sub).select('id').single())) as { id: string };
  const receipts = sub.snapshot.expenses.flatMap((e) => (e.receiptId ? [e.receiptId] : []));
  for (let i = 0; i < receipts.length; i += 4) {
    const files = (
      await Promise.all(receipts.slice(i, i + 4).map(async (rid) => ({ submission_id: row.id, receipt_id: rid, uri: await loadReceiptImage(rid) })))
    ).filter((f): f is { submission_id: string; receipt_id: string; uri: string } => !!f.uri);
    if (files.length) await check(supabase().from('submission_files').insert(files));
  }
  return row.id;
}
