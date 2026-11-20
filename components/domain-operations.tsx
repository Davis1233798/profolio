"use client";
import { OperationForm, type Option } from "./operation-form";
import { usePortfolioLocale } from "./portfolio-experience";

type Row = Record<string, any>;
const options = (rows: Row[] = [], name = "name"): Option[] =>
  rows.map(row => ({ value: row.id, label: `${row[name] || row.id}${row.status ? ` · ${row.status}` : ""}` }));

export function MesOperations({ data, onSaved }: { data: Row; onSaved: () => void }) {
  const { t } = usePortfolioLocale();
  const workOrders = options(data.workOrders, "orderNo");
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">{t("Production workflow", "生產作業流程")}</h2>
      <p className="text-xs text-stone-500">
        {t(
          "Create → Release → Prepare materials → Start → Report → Inspect → Close. Changes are saved in this demo workspace.",
          "建立工單 → 下達 → 備料 → 開工 → 報工 → 檢驗 → 結案。所有異動皆即時保存於示範工作區。"
        )}
      </p>
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        <OperationForm
          module="mes"
          action="product"
          title="New product"
          onSaved={onSaved}
          fields={[
            { name: "sku", label: "Unique finished-product SKU" },
            { name: "name", label: "Product name" },
          ]}
        />
        <OperationForm
          module="mes"
          action="lot"
          title="Receive material lot"
          onSaved={onSaved}
          fields={[
            { name: "materialSku", label: "Material SKU (must match BOM)" },
            { name: "lotNumber", label: "Unique lot number" },
            { name: "quantity", label: "Received quantity", type: "number", min: 1, value: 200 },
          ]}
        />
        <OperationForm
          module="mes"
          action="center"
          title="New work center"
          onSaved={onSaved}
          fields={[
            { name: "code", label: "Unique work center code" },
            { name: "name", label: "Center name" },
            { name: "capacityMinutesPerDay", label: "Daily capacity (minutes)", type: "number", min: 1, value: 480 },
          ]}
        />
        <OperationForm
          module="mes"
          action="create"
          title="Create work order"
          onSaved={onSaved}
          fields={[
            { name: "productId", label: "Product (latest active BOM)", options: options(data.products) },
            { name: "targetQuantity", label: "Target quantity", type: "number", min: 1, value: 100 },
          ]}
        />
        <OperationForm
          module="mes"
          action="status"
          title="Change work order status"
          onSaved={onSaved}
          fields={[
            { name: "workOrderId", label: "Work order", options: workOrders },
            {
              name: "status",
              label: "Next status",
              options: [
                { value: "released", label: "Release" },
                { value: "in_progress", label: "Start (materials required)" },
                { value: "closed", label: "Close (completion and quality approval required)" },
              ],
            },
          ]}
        />
        <OperationForm
          module="mes"
          action="material"
          title="Issue or return materials"
          onSaved={onSaved}
          fields={[
            { name: "workOrderId", label: "Work order", options: workOrders },
            { name: "materialLotId", label: "Material lot", options: options(data.lots, "lotNumber") },
            { name: "issuedQty", label: "Issued quantity", type: "number", min: 1, value: 200 },
            { name: "returnedQty", label: "Returned quantity", type: "number", min: 0, value: 0 },
          ]}
        />
        <OperationForm
          module="mes"
          action="quality"
          title="Record completion inspection"
          onSaved={onSaved}
          fields={[
            { name: "workOrderId", label: "Work order", options: workOrders },
            { name: "sampleQuantity", label: "Sample quantity", type: "number", min: 1, value: 10 },
            { name: "failedQuantity", label: "Defect quantity", type: "number", min: 0, value: 0 },
            { name: "notes", label: "Inspection notes", optional: true },
          ]}
        />
        <OperationForm
          module="mes"
          action="downtime"
          title="Record equipment downtime"
          onSaved={onSaved}
          fields={[
            { name: "workCenterId", label: "Work center", options: options(data.workCenters) },
            { name: "startTime", label: "Start (Taipei time)", type: "datetime-local" },
            { name: "endTime", label: "End (Taipei time)", type: "datetime-local" },
            { name: "reason", label: "Cause and resolution" },
          ]}
        />
        <OperationForm
          module="mes"
          action="bom"
          title="Create BOM version"
          onSaved={onSaved}
          fields={[
            { name: "productId", label: "Finished product", options: options(data.products) },
            { name: "materialSku", label: "Material SKU (no cycles)" },
            { name: "materialName", label: "Material name" },
            { name: "quantityPerUnit", label: "Material per unit", type: "number", min: 1, value: 2 },
          ]}
        />
      </div>
      <div className="rounded-xl border border-stone-200 bg-white p-5">
        <h3 className="text-sm font-semibold mb-3">
          {t("Material input traceability", "原物料投料追溯明細")}
        </h3>
        {!(data.materials || []).length && (
          <p className="text-xs text-stone-500">
            {t("No material issues recorded", "目前無領料紀錄")}
          </p>
        )}
        <ul className="text-xs space-y-2">
          {(data.materials || []).map((row: Row) => (
            <li key={row.id}>
              {data.workOrders.find((wo: Row) => wo.id === row.workOrderId)?.orderNo} ·{" "}
              {data.lots.find((lot: Row) => lot.id === row.materialLotId)?.lotNumber} · {row.materialSku} ·{" "}
              {t("Issued", "已領料")} {row.issuedQuantity} / {t("Returned", "已退料")}{" "}
              {row.returnedQuantity} / {t("Net consumption", "淨耗用量")} {row.netQuantity}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function ErpOperations({ data, onSaved }: { data: Row; onSaved: () => void }) {
  const { t } = usePortfolioLocale();
  const warehouses = options(data.warehouses);
  const items = options(data.items);
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">{t("Purchasing and sales", "採購與銷售作業")}</h2>
      <p className="text-xs text-stone-500">
        {t(
          "Create and approve orders, then receive or ship in batches. Each movement is recorded in the stock ledger.",
          "建立並審核訂單，支援分批收貨與出貨；每一筆庫存異動皆完整記錄於庫存明細帳中。"
        )}
      </p>
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        <OperationForm
          module="erp"
          action="item"
          title="New inventory item"
          onSaved={onSaved}
          fields={[
            { name: "sku", label: "Unique SKU" },
            { name: "name", label: "Item name" },
            { name: "boxConversionRatio", label: "Units per pack", type: "number", min: 1, value: 1 },
          ]}
        />
        <OperationForm
          module="erp"
          action="purchase"
          title="Create purchase order"
          onSaved={onSaved}
          fields={[
            { name: "supplierId", label: "Supplier", options: options(data.suppliers) },
            { name: "itemId", label: "Item", options: items },
            { name: "quantity", label: "Quantity", type: "number", min: 1, value: 10 },
            { name: "unitPrice", label: "Unit cost (TWD)", type: "number", min: 1, value: 100 },
          ]}
        />
        <OperationForm
          module="erp"
          action="approve"
          title="Review purchase order"
          onSaved={onSaved}
          fields={[
            {
              name: "poId",
              label: "Draft purchase order",
              options: options(
                (data.purchaseOrders || []).filter((p: Row) => p.status === "draft"),
                "poNumber"
              ),
            },
            {
              name: "decision",
              label: "Review decision",
              options: [
                { value: "approve", label: "Approve" },
                { value: "reject", label: "Reject (reason required)" },
              ],
            },
            { name: "reason", label: "Review notes", optional: true },
          ]}
        />
        <OperationForm
          module="erp"
          action="receive"
          title="Receive purchase items"
          onSaved={onSaved}
          fields={[
            {
              name: "lineId",
              label: "Purchase line / Outstanding",
              options: (data.purchaseLines || [])
                .filter((l: Row) => l.receivedQuantity < l.quantity)
                .map((l: Row) => ({
                  value: l.id,
                  label: `${data.purchaseOrders.find((p: Row) => p.id === l.poId)?.poNumber} · ${
                    data.items.find((it: Row) => it.id === l.itemId)?.name
                  } · ${t("Outstanding", "未到貨")} ${l.quantity - l.receivedQuantity}`,
                })),
            },
            { name: "warehouseId", label: "Receiving warehouse", options: warehouses },
            { name: "quantity", label: "Quantity received", type: "number", min: 1, value: 1 },
          ]}
        />
        <OperationForm
          module="erp"
          action="sale"
          title="Create sales order"
          onSaved={onSaved}
          fields={[
            { name: "customerId", label: "Customer", options: options(data.customers) },
            { name: "itemId", label: "Item", options: items },
            { name: "quantity", label: "Quantity", type: "number", min: 1, value: 5 },
            { name: "unitPrice", label: "Unit price (TWD)", type: "number", min: 1, value: 200 },
          ]}
        />
        <OperationForm
          module="erp"
          action="ship"
          title="Ship sales items"
          onSaved={onSaved}
          fields={[
            {
              name: "lineId",
              label: "Sales line / Outstanding",
              options: (data.salesLines || [])
                .filter((l: Row) => l.shippedQuantity < l.quantity)
                .map((l: Row) => ({
                  value: l.id,
                  label: `${data.salesOrders.find((p: Row) => p.id === l.soId)?.soNumber} · ${
                    data.items.find((it: Row) => it.id === l.itemId)?.name
                  } · ${t("Unshipped", "未出貨")} ${l.quantity - l.shippedQuantity}`,
                })),
            },
            { name: "warehouseId", label: "Shipping warehouse", options: warehouses },
            { name: "quantity", label: "Quantity shipped", type: "number", min: 1, value: 1 },
          ]}
        />
      </div>
    </section>
  );
}
