export const statuses = [
  'Preparing',
  'Applied',
  'Response received',
  'Screening',
  'Interview',
  'Offer',
  'Rejected',
  'Withdrawn',
] as const;
export type Application = {
  id: string;
  url: string;
  title: string;
  company: string;
  kind: string;
  applied_at: string;
  rationale: string;
  status: string;
  cv_id: string;
  feedback: string;
  revision: number;
  created_at: string;
  updated_at: string;
  latest_response: string;
  latest_summary: string;
};
export type CV = {
  id: string;
  name: string;
  category: string;
  filename: string;
  sha256: string;
  bytes: number;
  created_at: string;
  applications: number;
};
export type ResponseEvent = {
  id: string;
  occurred_at: string;
  status: string;
  channel: string;
  summary: string;
  body: string;
};
export type Session = { label: string; csrf_token: string; scopes: string[] };
export type Page = { items: Application[]; page: number; page_size: number; total: number };
export type Analysis = {
  submitted: number;
  from: string;
  to: string;
  timezone: string;
  grain: 'day' | 'week';
  responded: number;
  interviews: number;
  offers: number;
  statuses: { name: string; count: number }[];
  activity: { name: string; count: number }[];
  cvs: {
    cv_id: string;
    name: string;
    sha256: string;
    applications: number;
    responses: number;
    interviews: number;
    offers: number;
  }[];
};
export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(url: string, options: RequestInit = {}, csrf?: string): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  if (csrf) headers.set('X-CSRF-Token', csrf);
  const res = await fetch('/api/v1' + url, {
    ...options,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!res.ok) {
    const raw = await res.text();
    let message = raw;
    try {
      message = JSON.parse(raw).error || raw;
    } catch {}
    throw new APIError(message.trim() || 'Request failed.', res.status);
  }
  return res.json() as Promise<T>;
}
export const REPORT_TIMEZONE = 'America/New_York';
export function date(raw: string) {
  if (!raw) return '—';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: REPORT_TIMEZONE,
  }).format(new Date(raw));
}
export function dateTime(raw: string) {
  if (!raw) return 'Not submitted';
  return (
    new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: REPORT_TIMEZONE,
    }).format(new Date(raw)) + ' ET'
  );
}
export function reportDay(instant = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
// The input is already a New York calendar day; UTC arithmetic shifts calendar
// keys without adding/subtracting a 23- or 25-hour DST day.
export function shiftDay(day: string, days: number) {
  const date = new Date(day + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function localDate(raw?: string) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: REPORT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(raw ? new Date(raw) : new Date())
    .replace(' ', 'T');
}
export function reportInputToISO(raw: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(raw);
  if (!match) throw Error('Enter a valid New York date and time.');
  const wall = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  );
  // New York uses UTC-4/UTC-5 in the supported dates (2000 onward). On the
  // repeated fall-back hour choose the earlier occurrence; reject spring gaps.
  for (const offset of [4, 5]) {
    const candidate = new Date(wall + offset * 60 * 60 * 1000);
    if (localDate(candidate.toISOString()) === raw) return candidate.toISOString();
  }
  throw Error(
    'This New York time does not exist because the clocks moved forward. Choose another time.',
  );
}
export function percent(count: number, total: number) {
  return total
    ? new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 }).format(
        count / total,
      )
    : '—';
}
