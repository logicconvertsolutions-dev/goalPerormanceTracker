// k6 load test: simulated agents browsing Kautis on STAGING ONLY.
//
//   k6 run scripts/load/agent-session.js \
//     -e BASE_URL=https://staging.kautis.ca \
//     -e SUPABASE_URL=https://<staging-ref>.supabase.co \
//     -e SUPABASE_ANON_KEY=<staging publishable key> \
//     -e ACCOUNTS_FILE=/path/outside/repo/accounts.json \
//     -e PEAK_VUS=250
//
// accounts.json (never commit it): [{"email","password","totp_secret"}, ...]
// -- staging test agents with an authenticator enrolled (every app page
// requires aal2) and current terms accepted. setup() signs each one in ONCE
// and the virtual users share those sessions, so the run stays far below the
// per-IP sign-in limit (30 / 5 min) and never refreshes a token (jwt_expiry
// is 1h; keep a run shorter than that).
//
// Read-only: page loads and the read RPCs those pages call. It writes nothing.
//
// Refuses to run against production.

import http from 'k6/http';
import crypto from 'k6/crypto';
import encoding from 'k6/encoding';
import { check, sleep, fail } from 'k6';
import { Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'https://staging.kautis.ca';
const SUPABASE_URL = __ENV.SUPABASE_URL;
const ANON_KEY = __ENV.SUPABASE_ANON_KEY;
const PEAK = Number(__ENV.PEAK_VUS || 250);
const PRODUCTION_REF = 'arswptuybizvceabecyn';

if (/(^|\/\/)(www\.)?kautis\.ca/.test(BASE_URL) || (SUPABASE_URL || '').includes(PRODUCTION_REF)) {
  throw new Error('Refusing to load-test production. Point BASE_URL / SUPABASE_URL at staging.');
}

const accounts = __ENV.ACCOUNTS_FILE ? JSON.parse(open(__ENV.ACCOUNTS_FILE)) : [];

const pageTime = {
  today: new Trend('page_today', true),
  contacts: new Trend('page_contacts', true),
  contactsSearch: new Trend('page_contacts_search', true),
  dashboard: new Trend('page_dashboard', true),
  logs: new Trend('page_logs', true),
};

export const options = {
  scenarios: {
    agents: {
      executor: 'ramping-vus',
      startVUs: 0,
      // Step up and hold, so each level's numbers can be read separately.
      stages: [
        { duration: '1m', target: Math.round(PEAK * 0.2) },
        { duration: '2m', target: Math.round(PEAK * 0.2) },
        { duration: '1m', target: Math.round(PEAK * 0.5) },
        { duration: '2m', target: Math.round(PEAK * 0.5) },
        { duration: '1m', target: PEAK },
        { duration: '3m', target: PEAK },
        { duration: '1m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    // Stop early once it is clearly failing -- this is staging, not a soak.
    http_req_failed: [{ threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '1m' }],
    http_req_duration: ['p(95)<3000'],
  },
  setupTimeout: '5m',
};

// --- TOTP (RFC 6238, SHA-1, 6 digits, 30 s) --------------------------------
function base32ToBytes(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = secret.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = '';
  for (const c of clean) {
    const v = alphabet.indexOf(c);
    if (v < 0) fail(`bad base32 character in TOTP secret`);
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return bytes;
}

function totp(secret, now = Date.now()) {
  const counter = Math.floor(now / 1000 / 30);
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const hex = crypto.hmac('sha1', base32ToBytes(secret).buffer, msg.buffer, 'hex');
  const h = hex.match(/../g).map((b) => parseInt(b, 16));
  const offset = h[h.length - 1] & 0x0f;
  const code =
    (((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3]) % 1e6;
  return String(code).padStart(6, '0');
}

// --- Supabase sign-in -> @supabase/ssr cookies ----------------------------
function authHeaders(token) {
  const h = { apikey: ANON_KEY, 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function signIn(acct) {
  const pw = http.post(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email: acct.email, password: acct.password }),
    { headers: authHeaders() }
  );
  if (pw.status !== 200) fail(`password sign-in failed for ${acct.email}: ${pw.status} ${pw.body}`);
  const aal1 = pw.json();

  const factors = http.get(`${SUPABASE_URL}/auth/v1/user`, { headers: authHeaders(aal1.access_token) }).json()
    .factors;
  const factor = (factors || []).find((f) => f.factor_type === 'totp' && f.status === 'verified');
  if (!factor) fail(`${acct.email} has no verified TOTP factor`);

  const challenge = http
    .post(`${SUPABASE_URL}/auth/v1/factors/${factor.id}/challenge`, '{}', {
      headers: authHeaders(aal1.access_token),
    })
    .json();
  const verify = http.post(
    `${SUPABASE_URL}/auth/v1/factors/${factor.id}/verify`,
    JSON.stringify({ challenge_id: challenge.id, code: totp(acct.totp_secret) }),
    { headers: authHeaders(aal1.access_token) }
  );
  if (verify.status !== 200) fail(`MFA verify failed for ${acct.email}: ${verify.status} ${verify.body}`);
  const session = verify.json();
  session.expires_at = session.expires_at || Math.floor(Date.now() / 1000) + session.expires_in;

  // Same shape @supabase/ssr writes: "base64-" + base64url(JSON), split into
  // 3180-char chunks named <key>.0, <key>.1 ... when it is long.
  const ref = SUPABASE_URL.replace(/^https?:\/\//, '').split('.')[0];
  const key = `sb-${ref}-auth-token`;
  const value = 'base64-' + encoding.b64encode(JSON.stringify(session), 'rawurl');
  const cookies = {};
  if (value.length <= 3180) {
    cookies[key] = value;
  } else {
    for (let i = 0; i * 3180 < value.length; i++) cookies[`${key}.${i}`] = value.slice(i * 3180, (i + 1) * 3180);
  }
  return { email: acct.email, cookies };
}

export function setup() {
  if (!SUPABASE_URL || !ANON_KEY) fail('SUPABASE_URL and SUPABASE_ANON_KEY are required');
  if (accounts.length === 0) fail('ACCOUNTS_FILE with at least one staging test account is required');
  const sessions = accounts.map((a) => {
    const s = signIn(a);
    sleep(1); // stay well inside the sign-in rate limit
    return s;
  });
  // Prove each session reaches an app page instead of a login/MFA redirect.
  for (const s of sessions) {
    const r = http.get(`${BASE_URL}/today`, { cookies: s.cookies, redirects: 0 });
    if (r.status !== 200) fail(`${s.email}: /today returned ${r.status} (location ${r.headers.Location}) -- check MFA/terms`);
  }
  return { sessions };
}

// --- One agent's session ----------------------------------------------------
function page(path, trend, cookies) {
  const r = http.get(`${BASE_URL}${path}`, { cookies, redirects: 0, tags: { name: path.split('?')[0] } });
  trend.add(r.timings.duration);
  check(r, {
    [`${path.split('?')[0]} 200`]: (res) => res.status === 200,
    [`${path.split('?')[0]} not bounced to login`]: (res) => !String(res.headers.Location || '').includes('/login'),
  });
  return r;
}

export default function (data) {
  const s = data.sessions[(__VU - 1) % data.sessions.length];

  // Realistic order and pacing: My Day first, then the call list, a search,
  // the dashboard and the activity log, with reading time in between.
  page('/today', pageTime.today, s.cookies);
  sleep(3 + Math.random() * 4);
  page('/contacts', pageTime.contacts, s.cookies);
  sleep(2 + Math.random() * 3);
  page(`/contacts?page=2`, pageTime.contacts, s.cookies);
  sleep(2 + Math.random() * 3);
  page(`/contacts?q=${['a', 'jo', 'smi', 'li'][__ITER % 4]}`, pageTime.contactsSearch, s.cookies);
  sleep(3 + Math.random() * 4);
  page('/dashboard', pageTime.dashboard, s.cookies);
  sleep(4 + Math.random() * 6);
  page('/logs', pageTime.logs, s.cookies);
  sleep(5 + Math.random() * 10);
}
