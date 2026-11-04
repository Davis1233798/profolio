import { NextRequest } from 'next/server';
import { exportWorkspace, restoreWorkspace } from '@/lib/tenant-backup';
import { authorizeWorkspaceExport, requireWorkspaceRestoreAccess, verifyWorkspaceRestorePassword, WorkspaceSecurityError } from '@/lib/workspace-security';
import { readWorkspaceJson, workspaceDownload, workspaceFailure } from '@/lib/workspace-http';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try {
    const context = await authorizeWorkspaceExport(request);
    const backup = await exportWorkspace(context);
    if (Object.values(backup.tables).reduce((count, rows) => count + rows.length, 0) > 10_000) throw new WorkspaceSecurityError(413, 'Export exceeds the 10,000 record limit');
    return workspaceDownload(JSON.stringify(backup, null, 2), 'business-suite-backup.json', 'application/json; charset=utf-8');
  } catch (error) { return workspaceFailure(error); }
}
export async function HEAD(request: NextRequest) {
  try { await requireWorkspaceRestoreAccess(request); return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } }); }
  catch (error) { return workspaceFailure(error); }
}
export async function POST(request: NextRequest) {
  try {
    const context = await requireWorkspaceRestoreAccess(request);
    const input = await readWorkspaceJson(request, 5_000_000) as { password?: unknown; backup?: unknown };
    if (!input || typeof input.password !== 'string' || input.password.length > 256) throw new WorkspaceSecurityError(400, 'Password confirmation required');
    await verifyWorkspaceRestorePassword(request, input.password);
    const data = await restoreWorkspace(context, input.backup);
    return Response.json({ success: true, data }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return workspaceFailure(error); }
}
