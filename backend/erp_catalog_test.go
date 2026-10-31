package main

import (
	"encoding/json"
	"testing"
)

func TestERPCatalogAndSalesOrder(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	office := loginSite(t, a, "office@suite.test", space, "erp")
	front := loginSite(t, a, "front@suite.test", space, "erp")
	other := loginSite(t, a, "admin@suite.test", token(), "erp")
	path := "/api/stations/erp/catalog"
	item := map[string]any{"action": "item", "sku": "EXAMPLE-SKU", "name": "Example item", "unit": "PCS", "boxRatio": 10, "idempotencyKey": "erp-item-create-01"}
	if w := request(a, "POST", path, item, front...); w.Code != 403 {
		t.Fatalf("front %d", w.Code)
	}
	w := request(a, "POST", path, item, office...)
	if w.Code != 200 {
		t.Fatalf("item %d %s", w.Code, w.Body.String())
	}
	if w := request(a, "POST", path, item, office...); w.Code != 200 {
		t.Fatalf("retry %d", w.Code)
	}
	duplicate := map[string]any{"action": "item", "sku": "example-sku", "name": "Duplicate", "unit": "PCS", "boxRatio": 1, "idempotencyKey": "erp-item-create-02"}
	if w := request(a, "POST", path, duplicate, office...); w.Code != 409 {
		t.Fatalf("duplicate %d", w.Code)
	}
	var customer, stocked, warehouse string
	a.db.QueryRow("SELECT id FROM erp_customers WHERE organization_id=? AND is_active=1 LIMIT 1", org).Scan(&customer)
	a.db.QueryRow("SELECT item_id,warehouse_id FROM erp_stock_ledger WHERE organization_id=? AND balance_after>0 ORDER BY rowid DESC LIMIT 1", org).Scan(&stocked, &warehouse)
	sale := map[string]any{"action": "sale", "customerId": customer, "lines": []any{map[string]any{"itemId": stocked, "quantity": 2, "unitPrice": 300}}, "idempotencyKey": "erp-sale-create-01"}
	if w := request(a, "POST", path, sale, other...); w.Code != 404 {
		t.Fatalf("foreign customer %d", w.Code)
	}
	w = request(a, "POST", path, sale, office...)
	if w.Code != 200 {
		t.Fatalf("sale %d %s", w.Code, w.Body.String())
	}
	var value struct {
		Data struct {
			ID    string `json:"salesOrderId"`
			Total int    `json:"total"`
		} `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &value)
	if value.Data.ID == "" || value.Data.Total != 600 {
		t.Fatalf("result %+v", value.Data)
	}
	if w := request(a, "POST", path, sale, office...); w.Code != 200 {
		t.Fatalf("sale replay %d", w.Code)
	}
	var line string
	if e := a.db.QueryRow("SELECT id FROM erp_sales_order_lines WHERE organization_id=? AND so_id=?", org, value.Data.ID).Scan(&line); e != nil {
		t.Fatal(e)
	}
	ship := map[string]any{"action": "ship", "salesOrderId": value.Data.ID, "warehouseId": warehouse, "lines": []any{map[string]any{"lineId": line, "quantity": 2}}, "idempotencyKey": "erp-sale-ship-001"}
	if w := request(a, "POST", "/api/stations/erp/stock-out", ship, office...); w.Code != 200 {
		t.Fatalf("shipment %d %s", w.Code, w.Body.String())
	}
}
