/** Production Node adapter for the built Worker handler; no Wrangler dev server. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getLocalSqliteD1 } from '../lib/db/sqlite-d1.ts';
import worker from '../dist/server/index.js';
import { stations, stationForPath, stationAllowsPath } from './station-routing.mjs';

const station = process.env.SUITE_STATION;
if (station && !stations.includes(station)) throw new Error('Unknown station runtime');
const proxyStations = process.env.STATION_PROXY === 'true';
if (station && proxyStations) throw new Error('A station cannot proxy to other stations');

const root = path.resolve('dist/client');
const types = {'.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.ico':'image/x-icon','.json':'application/json'};
async function asset(request) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url).pathname); } catch { return new Response(null,{status:400}); }
  const file = path.resolve(root, '.' + pathname);
  if (!file.startsWith(root + path.sep)) return new Response(null,{status:404});
  try {
    const body = await readFile(file);
    return new Response(body,{headers:{'Content-Type':types[path.extname(file)] ?? 'application/octet-stream','Cache-Control':pathname.startsWith('/_next/static/') ? 'public, max-age=31536000, immutable' : 'public, max-age=300'}});
  } catch { return new Response(null,{status:404}); }
}
const env = {DB:getLocalSqliteD1(),ASSETS:{fetch:asset},INFRA_GATEWAY_URL:process.env.INFRA_GATEWAY_URL,INFRA_GATEWAY_TOKEN:process.env.INFRA_GATEWAY_TOKEN,PLATFORM_CONTROL_URL:process.env.PLATFORM_CONTROL_URL};
const context = {waitUntil(promise){promise.catch(()=>console.error('Background task failed'));},passThroughOnException(){}};
const server = createServer(async (incoming,outgoing) => {
  try {
    // Reject an unauthorized restore before buffering the upload at this adapter.
    if (incoming.method === 'POST' && new URL(incoming.url, 'http://localhost').pathname === '/api/workspace/backup') {
      const preflightHeaders = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined && !['content-length', 'transfer-encoding'].includes(key)) preflightHeaders.set(key, Array.isArray(value) ? value.join(',') : value);
      const protocol = incoming.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
      const preflightUrl = new URL(incoming.url, `${protocol}://${incoming.headers.host ?? 'localhost'}`);
      const preflight = await worker.fetch(new Request(preflightUrl, { method: 'HEAD', headers: preflightHeaders }), env, context);
      if (!preflight.ok) {
        outgoing.writeHead(preflight.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        outgoing.end(JSON.stringify({ success: false, error: { message: 'Authenticated restore access required' } }));
        incoming.resume();
        return;
      }
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of incoming) {
      size += chunk.length;
      if (size > 6 * 1024 * 1024) { outgoing.writeHead(413).end(); return; }
      chunks.push(chunk);
    }
    const headers = new Headers();
    for (const [key,value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(key,Array.isArray(value) ? value.join(',') : value);
    const protocol = incoming.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const url = new URL(incoming.url, `${protocol}://${incoming.headers.host ?? 'localhost'}`);
    const request = new Request(url,{method:incoming.method,headers,...(['GET','HEAD'].includes(incoming.method) ? {} : {body:Buffer.concat(chunks)})});
    const staticResponse = incoming.method === 'GET' || incoming.method === 'HEAD' ? await asset(request) : null;
    let response;
    const owner = stationForPath(url.pathname);
    if (staticResponse?.ok) response = staticResponse;
    else if (station && !stationAllowsPath(station,url.pathname)) response = Response.json({error:'Route belongs to another runtime'},{status:404});
    else if (proxyStations && owner) {
      try {
        // Fixed internal host allowlist, original path/cookies and manual redirects.
        // A stopped station must fail visibly rather than run on the main process.
        headers.delete('connection'); headers.delete('content-length'); headers.delete('transfer-encoding');
        response = await fetch(`http://web-${owner}:8080${url.pathname}${url.search}`,{
          method:incoming.method, headers, redirect:'manual', signal:AbortSignal.timeout(30_000),
          ...(['GET','HEAD'].includes(incoming.method) ? {} : {body:Buffer.concat(chunks)}),
        });
      } catch { response = Response.json({error:'Station unavailable',station:owner},{status:503,headers:{'Cache-Control':'no-store'}}); }
    } else response = await worker.fetch(request,env,context);
    outgoing.statusCode = response.status;
    if (station) outgoing.setHeader('X-Suite-Station',station);
    for (const [key,value] of response.headers) if (key !== 'set-cookie') outgoing.setHeader(key,value);
    const cookies = response.headers.getSetCookie();
    if (cookies.length) outgoing.setHeader('Set-Cookie',cookies);
    if (incoming.method !== 'HEAD' && response.body) for await (const chunk of response.body) {
      if (!outgoing.write(chunk)) await new Promise(resolve => outgoing.once('drain',resolve));
    }
    outgoing.end();
  } catch (error) {
    console.error('Request failed:', error instanceof Error ? error.message : 'unknown');
    if (!outgoing.headersSent) outgoing.writeHead(500,{'Content-Type':'application/json'});
    outgoing.end('{"error":"Internal server error"}');
  }
});
let dispatching = false;
const timer = !station && env.INFRA_GATEWAY_URL && env.INFRA_GATEWAY_TOKEN ? setInterval(async () => {
  if (dispatching) return;
  dispatching = true;
  try { await worker.scheduled({cron:'* * * * *',scheduledTime:Date.now()},env,context); }
  catch { console.error('Infrastructure outbox dispatch failed; pending events retained'); }
  finally { dispatching = false; }
},60_000) : null;
timer?.unref();
server.listen(Number(process.env.PORT ?? 8080),process.env.HOST ?? '127.0.0.1',()=>console.log('Business Suite Node production adapter ready'));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{if(timer)clearInterval(timer);server.close(()=>process.exit(0));});
