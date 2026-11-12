import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { clearLegacyMesHistory, legacyMesIdentitySchema, linkLegacyMesIdentity, readLegacyMesHistory, resolveLegacyMesIdentity } from '../../lib/legacy-mes-history';

test('legacy MES history isolates the operator and organization and identifies shared orders', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`
      CREATE TABLE mes_work_orders (id TEXT, organization_id TEXT, order_no TEXT);
      CREATE TABLE mes_production_reports (
        id TEXT, organization_id TEXT, operator_id TEXT, work_order_id TEXT,
        good_quantity INTEGER, scrap_quantity INTEGER, report_time TEXT, notes TEXT
      );
      INSERT INTO mes_work_orders VALUES ('shared','org-a','WO-1'), ('foreign','org-b','WO-2'), ('idle','org-a','WO-3');
      INSERT INTO mes_production_reports VALUES
        ('mine','org-a','operator-a','shared',2,0,'2026-01-01','private note'),
        ('peer','org-a','operator-b','shared',1,0,'2026-01-02','private note'),
        ('other','org-b','operator-a','foreign',1,0,'2026-01-03','private note');
    `);
    const history = readLegacyMesHistory(db, 'org-a', 'operator-a');
    assert.deepEqual(history.map(row => [row.reportId, row.orderNumber, row.sharedOrder]), [['mine','WO-1',1]]);
    assert.deepEqual(readLegacyMesHistory(db, 'org-a', 'unknown'), []);
    assert.equal(clearLegacyMesHistory(db, 'org-a', 'operator-a'), 1);
    assert.equal(clearLegacyMesHistory(db, 'org-a', 'operator-a'), 0);
    assert.deepEqual(readLegacyMesHistory(db, 'org-a', 'operator-a'), []);
    assert.equal(readLegacyMesHistory(db, 'org-b', 'operator-a').length, 1);
    assert.equal(readLegacyMesHistory(db, 'org-a', 'operator-b').length, 1);
    const retained = db.prepare("SELECT good_quantity, notes FROM mes_production_reports WHERE id='mine'").get();
    assert.equal(retained?.good_quantity, 2);
    assert.equal(retained?.notes, null);

  } finally {
    db.close();
  }
});
test('legacy operator mapping cannot be reassigned to a different Portfolio user', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(legacyMesIdentitySchema);
    linkLegacyMesIdentity(db, 'portfolio-a', 'org-a', 'operator-a');
    linkLegacyMesIdentity(db, 'portfolio-a', 'org-a', 'operator-a');
    assert.throws(() => linkLegacyMesIdentity(db, 'portfolio-b', 'org-a', 'operator-a'));
    assert.equal(resolveLegacyMesIdentity(db, 'portfolio-a', 'org-a'), 'operator-a');
    assert.equal(resolveLegacyMesIdentity(db, 'portfolio-b', 'org-a'), undefined);
    assert.equal(resolveLegacyMesIdentity(db, 'portfolio-a', 'org-b'), undefined);
  } finally {
    db.close();
  }
});
