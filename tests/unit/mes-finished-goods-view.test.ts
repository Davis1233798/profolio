import test from 'node:test';
import assert from 'node:assert/strict';
import {finishedGoodsView} from '../../web/src/mesFinishedGoodsView';

test('reconstructs independent batch states from server datasets', () => {
  const rows = finishedGoodsView({
    finishedGoodsBatches: [
      {id:'a',batchNumber:'A',workOrderId:'w',reportId:'r',quantity:4,status:'released'},
      {id:'b',batchNumber:'B',workOrderId:'w',reportId:'r',quantity:2,status:'pending_inspection'},
      {id:'c',batchNumber:'C',workOrderId:'w',reportId:'r',quantity:3,status:'received'}
    ],
    finishedGoodsQualityDispositions: [{batchId:'a',passedQuantity:4,failedQuantity:0,disposition:'release'}],
    finishedGoodsInventory: [{batchId:'c',quantityOnHand:3}]
  });
  assert.equal(rows.length, 3);
  assert.equal(rows[0].batchId, 'a');
  assert.equal(rows[0].passedQuantity, 4);
  assert.equal(rows[1].passedQuantity, undefined);
  assert.equal(rows[2].receivedQuantity, 3);
  assert.deepEqual(finishedGoodsView({}), []);
});
