package main

// inspectLegacyLedger checks whether each item/warehouse has a possible
// zero-based balance chain, independent of the backup's row order. This does
// not establish chronological order when timestamps are missing or tied.
func inspectLegacyLedger(rows []map[string]any) map[string]int {
	type key struct{ item, warehouse string }
	type chain struct {
		out                 map[float64][]float64
		inDegree, outDegree map[float64]int
		edges               int
	}
	chains := map[key]*chain{}
	orderedBalances := map[key]float64{}
	warnings := map[string]int{}
	for _, row := range rows {
		item, itemOK := row["itemId"].(string)
		warehouse, warehouseOK := row["warehouseId"].(string)
		change, changeOK := row["quantityChange"].(float64)
		balance, balanceOK := row["balanceAfter"].(float64)
		if !itemOK || item == "" || !warehouseOK || warehouse == "" || !changeOK || !balanceOK {
			warnings["erp_stock_ledger.invalid"]++
			continue
		}
		previous := balance - change
		if previous < 0 || balance < 0 {
			warnings["erp_stock_ledger.balance"]++
			continue
		}
		k := key{item, warehouse}
		if orderedBalances[k]+change != balance {
			warnings["erp_stock_ledger.exportOrder"]++
		}
		orderedBalances[k] = balance
		c := chains[k]
		if c == nil {
			c = &chain{out: map[float64][]float64{}, inDegree: map[float64]int{}, outDegree: map[float64]int{}}
			chains[k] = c
		}
		c.out[previous] = append(c.out[previous], balance)
		c.outDegree[previous]++
		c.inDegree[balance]++
		c.edges++
	}
	for _, c := range chains {
		valid, ends := true, 0
		vertices := map[float64]bool{}
		for v := range c.inDegree {
			vertices[v] = true
		}
		for v := range c.outDegree {
			vertices[v] = true
		}
		for v := range vertices {
			delta := c.outDegree[v] - c.inDegree[v]
			if delta == -1 {
				ends++
			} else if delta != 0 && !(v == 0 && delta == 1) {
				valid = false
			}
		}
		startDelta := c.outDegree[0] - c.inDegree[0]
		if !((startDelta == 0 && ends == 0) || (startDelta == 1 && ends == 1)) {
			valid = false
		}
		stack, used := []float64{0}, 0
		for len(stack) > 0 {
			v := stack[len(stack)-1]
			if len(c.out[v]) == 0 {
				stack = stack[:len(stack)-1]
				continue
			}
			last := len(c.out[v]) - 1
			next := c.out[v][last]
			c.out[v] = c.out[v][:last]
			stack = append(stack, next)
			used++
		}
		if !valid || used != c.edges {
			warnings["erp_stock_ledger.balance"]++
		}
	}
	return warnings
}
