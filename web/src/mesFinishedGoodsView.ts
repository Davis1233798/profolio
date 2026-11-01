type Row = Record<string, any>;

export function finishedGoodsView(data: Record<string, Row[]>) {
  const dispositions = data.finishedGoodsQualityDispositions || [];
  const inventory = data.finishedGoodsInventory || [];
  return (data.finishedGoodsBatches || []).map(batch => {
    const quality = dispositions.filter(row => row.batchId === batch.id).sort((a,b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
    const stock = inventory.find(row => row.batchId === batch.id);
    return {
      batchId: String(batch.id), batchNumber: String(batch.batchNumber),
      workOrderId: String(batch.workOrderId), reportId: String(batch.reportId),
      quantity: Number(batch.quantity), status: String(batch.status),
      passedQuantity: quality ? Number(quality.passedQuantity) : undefined,
      failedQuantity: quality ? Number(quality.failedQuantity) : undefined,
      disposition: quality?.disposition as string | undefined,
      receivedQuantity: stock ? Number(stock.quantityOnHand) : undefined
    };
  });
}
