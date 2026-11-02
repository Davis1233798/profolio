import test from 'node:test';
import assert from 'node:assert/strict';
import {labelBarcodeValue} from '../../web/src/labelBarcode';

test('preserves printable ASCII barcode values and rejects unsupported text', () => {
  assert.equal(labelBarcodeValue('FG-123/ABC'), 'FG-123/ABC');
  assert.equal(labelBarcodeValue(''), null);
  assert.equal(labelBarcodeValue('批次-123'), null);
  assert.equal(labelBarcodeValue('FG\n123'), null);
  assert.equal(labelBarcodeValue('FG\x7f123'), null);
});
