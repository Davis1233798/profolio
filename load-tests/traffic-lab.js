import http from 'k6/http';
import { check, fail } from 'k6';
import exec from 'k6/execution';
import { Counter } from 'k6/metrics';

const base = __ENV.BASE_URL || 'http://127.0.0.1:8097';
const site = __ENV.SITE || 'shop';
const vus = Number(__ENV.VUS || 16);
const iterations = Number(__ENV.ITERATIONS || 256);
const capacity = Number(__ENV.CAPACITY || 20);
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) throw new Error('Use an isolated loopback service only');
if (!['shop', 'mes'].includes(site)) throw new Error('SITE must be shop or mes');
if (!Number.isInteger(vus) || vus < 1 || vus > 64 || !Number.isInteger(iterations) || iterations < 1 || iterations > 5000 || !Number.isInteger(capacity) || capacity < 1 || capacity > 1000 || iterations < capacity * 2) throw new Error('Invalid or unsafe test parameters');
const accepted = new Counter('lab_accepted');
const duplicate = new Counter('lab_duplicate');
const rejected = new Counter('lab_capacity_rejected');
export const options = {
  scenarios: { contention: { executor: 'shared-iterations', vus, iterations, maxDuration: '2m' } },
  thresholds: { checks: ['rate==1'], http_req_failed: ['rate==0'], iterations: [`count==${iterations}`], lab_accepted: [`count==${capacity-1}`], lab_capacity_rejected: ['count>0'] },
};
const endpoint = `/api/stations/${site}/traffic`;
function body(response) { try { return response.json(); } catch { return null; } }
function post(path, value, cookie) {
  return http.post(base + path, JSON.stringify(value), {headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})}, timeout:'20s'});
}
function requireSuccess(response, label) {
  const value=body(response);
  if (response.status!==200 || !value || !value.success) fail(`${label}: HTTP ${response.status} ${response.body}`);
  return value.data;
}
export function setup() {
  const login=post('/api/auth/login',{email:'admin@suite.test',password:'SuiteDemo!2026',site});
  requireSuccess(login,'login');
  const key=`suite_session_${site}`;
  if (!login.cookies[key] || !login.cookies[key][0]) fail('Missing station session cookie');
  const cookie=`${key}=${login.cookies[key][0].value}`;
  const prepared=requireSuccess(post(endpoint,{action:'prepare',capacity},cookie),'prepare');
  // A committed key replayed by all VUs verifies deduplication under contention.
  const initial=requireSuccess(post(endpoint,{action:'submit',runId:prepared.runId,key:'shared-retry'},cookie),'initial submit');
  if(initial.outcome!=='accepted') fail('Could not establish retry key');
  return {cookie,runId:prepared.runId};
}
export default function (data) {
  const i=exec.scenario.iterationInTest;
  const key=i%4===0?'shared-retry':`request-${i}`;
  const response=post(endpoint,{action:'submit',runId:data.runId,key},data.cookie);
  const result=body(response);
  const outcome=result && result.success && result.data && result.data.outcome;
  check(response, {'valid lab response':r=>r.status===200 && ['accepted','duplicate','capacity_rejected'].includes(outcome)});
  if(outcome==='accepted') accepted.add(1);
  else if(outcome==='duplicate') duplicate.add(1);
  else if(outcome==='capacity_rejected') rejected.add(1);
}
export function teardown(data) {
  if (!data) return;
  const params={headers:{Cookie:data.cookie},timeout:'20s'};
  const state=requireSuccess(http.get(`${base}${endpoint}?runId=${encodeURIComponent(data.runId)}`,params),'snapshot');
  if(state.capacity!==capacity || state.committed!==capacity || state.remaining!==0 || state.queued!==capacity || state.processed!==0) fail('Capacity or durable queue invariant failed');
  const drained=requireSuccess(post(endpoint,{action:'drain',runId:data.runId},data.cookie),'drain');
  const replay=requireSuccess(post(endpoint,{action:'drain',runId:data.runId},data.cookie),'repeat drain');
  if(drained.queued!==0 || drained.processed!==capacity || replay.processed!==capacity) fail('Consumer invariant failed');
  console.log(`${site}: capacity=${capacity}; committed=${state.committed}; pending=${state.queued}; processed=${drained.processed}; retry and consumer checks passed`);
}
