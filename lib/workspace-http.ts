import { WorkspaceSecurityError } from './workspace-security';

export function workspaceFailure(error: unknown): Response {
  const status = error instanceof WorkspaceSecurityError ? error.status : 500;
  const message = error instanceof WorkspaceSecurityError ? error.message : 'Workspace operation failed';
  return Response.json({ success: false, error: { code: 'WORKSPACE_ACCESS_DENIED', message } }, { status, headers: { 'cache-control': 'no-store' } });
}
export async function readWorkspaceJson(request: Request, maxBytes: number): Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new WorkspaceSecurityError(415, 'JSON content type required');
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new WorkspaceSecurityError(413, 'Request body is too large');
  const reader = request.body?.getReader();
  if (!reader) throw new WorkspaceSecurityError(400, 'JSON body required');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new WorkspaceSecurityError(413, 'Request body is too large'); }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new WorkspaceSecurityError(400, 'Invalid JSON body'); }
  } finally { reader.releaseLock(); }
}
export function workspaceDownload(body: string, filename: string, contentType: string): Response {
  if (new TextEncoder().encode(body).byteLength > 10_000_000) throw new WorkspaceSecurityError(413, 'Export exceeds the 10 MB limit');
  return new Response(body, { headers: { 'content-type': contentType, 'content-disposition': `attachment; filename="${filename}"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}
