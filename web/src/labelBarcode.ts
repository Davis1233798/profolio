// Limit labels to the printable ASCII subset of Code128 to keep scans stable.
export function labelBarcodeValue(value: string): string | null {
  return value.length > 0 && /^[\x20-\x7e]+$/.test(value) ? value : null;
}
