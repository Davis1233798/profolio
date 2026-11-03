package main

import "testing"

func TestStagedReferencesRejectMissingAndWrongInvoicePartner(t *testing.T) {
	data := map[string][]map[string]any{
		"erp_suppliers": {{"id": "supplier"}},
		"erp_customers": {{"id": "customer"}},
		"erp_invoices":  {{"id": "invoice", "invoiceType": "payable", "partnerType": "supplier", "partnerId": "supplier"}},
		"erp_payments":  {{"id": "payment", "invoiceId": "invoice"}},
	}
	if err := validateStagedReferences(data); err != nil {
		t.Fatal(err)
	}
	data["erp_payments"][0]["invoiceId"] = "missing"
	if err := validateStagedReferences(data); err == nil {
		t.Fatal("missing invoice accepted")
	}
	data["erp_payments"][0]["invoiceId"] = "invoice"
	data["erp_invoices"][0]["partnerType"] = "customer"
	data["erp_invoices"][0]["partnerId"] = "customer"
	if err := validateStagedReferences(data); err == nil {
		t.Fatal("wrong invoice partner type accepted")
	}
}

func TestStagedReturnMustMatchOrderItem(t *testing.T) {
	data := map[string][]map[string]any{
		"shop_orders":      {{"id": "order-a"}, {"id": "order-b"}},
		"shop_variants":    {{"id": "variant"}},
		"shop_order_items": {{"id": "item", "orderId": "order-a", "variantId": "variant"}},
		"shop_returns":     {{"id": "return", "orderId": "order-b", "orderItemId": "item"}},
	}
	if err := validateStagedReferences(data); err == nil {
		t.Fatal("return linked to another order accepted")
	}
	data["shop_returns"][0]["orderId"] = "order-a"
	if err := validateStagedReferences(data); err != nil {
		t.Fatal(err)
	}
}
