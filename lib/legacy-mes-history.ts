import type { DatabaseSync } from 'node:sqlite';

type LegacyMesReport = {
  reportId: string;
  workOrderId: string;
  orderNumber: string | null;
  goodQuantity: number;
  scrapQuantity: number;
  reportTime: string;
  sharedOrder: number;
};

export function readLegacyMesHistory(db: DatabaseSync, organizationId: string, operatorId: string) {
  return db.prepare(`
    SELECT r.id AS reportId, r.work_order_id AS workOrderId, w.order_no AS orderNumber,
           r.good_quantity AS goodQuantity, r.scrap_quantity AS scrapQuantity,
           r.report_time AS reportTime,
           EXISTS (
             SELECT 1 FROM mes_production_reports peer
             WHERE peer.organization_id = r.organization_id
               AND peer.work_order_id = r.work_order_id AND peer.operator_id <> r.operator_id
           ) AS sharedOrder
    FROM mes_production_reports r
    LEFT JOIN mes_work_orders w ON w.organization_id = r.organization_id AND w.id = r.work_order_id
    WHERE r.organization_id = ? AND r.operator_id = ?
    ORDER BY r.report_time DESC, r.id DESC
    LIMIT 500
  `).all(organizationId, operatorId) as LegacyMesReport[];
}

export const legacyMesIdentitySchema = `
  CREATE TABLE IF NOT EXISTS legacy_mes_identities (
    user_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    operator_id TEXT NOT NULL,
    PRIMARY KEY (user_id, organization_id),
    UNIQUE (organization_id, operator_id)
  );
`;

export function linkLegacyMesIdentity(db: DatabaseSync, userId: string, organizationId: string, operatorId: string) {
  db.prepare(`
    INSERT INTO legacy_mes_identities (user_id, organization_id, operator_id)
    VALUES (?, ?, ?)
    ON CONFLICT (user_id, organization_id) DO NOTHING
  `).run(userId, organizationId, operatorId);
  if (resolveLegacyMesIdentity(db, userId, organizationId) !== operatorId) {
    throw new Error('This Portfolio user already has a different legacy MES identity in this workspace');
  }
}

export function resolveLegacyMesIdentity(db: DatabaseSync, userId: string, organizationId: string) {
  const row = db.prepare(`
    SELECT operator_id FROM legacy_mes_identities WHERE user_id = ? AND organization_id = ?
  `).get(userId, organizationId) as { operator_id: string } | undefined;
  return row?.operator_id;
}
export function clearLegacyMesHistory(db: DatabaseSync, organizationId: string, operatorId: string) {
  if (!organizationId || !operatorId) throw new Error('Legacy MES scope is required');
  const result = db.prepare(`
    UPDATE mes_production_reports
    SET operator_id = '', notes = NULL
    WHERE organization_id = ? AND operator_id = ?
  `).run(organizationId, operatorId);
  return Number(result.changes);
}
