import { NextRequest } from 'next/server';
import { exportWorkspaceCsv } from '@/lib/tenant-backup';
import { authorizeWorkspaceExport } from '@/lib/workspace-security';
import { workspaceDownload, workspaceFailure } from '@/lib/workspace-http';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try {
    const table = request.nextUrl.searchParams.get('table') || 'pos_sales';
    const context = await authorizeWorkspaceExport(request, table);
    return workspaceDownload(await exportWorkspaceCsv(context, table), `${table.replace(/[^a-z_]/g, '')}.csv`, 'text/csv; charset=utf-8');
  } catch (error) { return workspaceFailure(error); }
}
