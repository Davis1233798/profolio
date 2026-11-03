import test from 'node:test';
import assert from 'node:assert/strict';
import { eligibleMESMappings } from '../../web/src/mesERPSelection';

test('only active mappings for the selected pending event may be posted', () => {
 const events = [{id:'e1',status:'pending',mesProductId:'p1'},{id:'e2',status:'processed',mesProductId:'p1'}];
 const mappings = [{id:'m1',mesProductId:'p1',isActive:1},{id:'m2',mesProductId:'p1',isActive:0},{id:'m3',mesProductId:'p2',isActive:1}];
 assert.deepEqual(eligibleMESMappings(events,mappings,'e1').map(m=>m.id),['m1']);
 assert.deepEqual(eligibleMESMappings(events,mappings,'e2'),[]);
 assert.deepEqual(eligibleMESMappings(events,mappings,'missing'),[]);
});
