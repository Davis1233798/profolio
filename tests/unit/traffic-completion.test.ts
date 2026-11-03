import test from 'node:test';
import assert from 'node:assert/strict';
import { trafficCompletion } from '../../web/src/trafficCompletion';

test('distinguishes stopped bursts from completed bursts', () => {
 assert.deepEqual(trafficCompletion(128, 40, true), {stopped:true,unsent:88});
 assert.deepEqual(trafficCompletion(128, 128, true), {stopped:false,unsent:0});
 assert.deepEqual(trafficCompletion(128, 128, false), {stopped:false,unsent:0});
});
