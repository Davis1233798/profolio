import { handleWorkspaceManagement } from '@/lib/workspace-security';
import { workspaceFailure } from '@/lib/workspace-http';
export const dynamic = 'force-dynamic';
async function handle(request: Request) { try { return await handleWorkspaceManagement(request); } catch (error) { return workspaceFailure(error); } }
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
