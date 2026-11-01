package main

import "testing"

func TestLegacyStoredValuesCompareSQLiteTypes(t *testing.T) {
	for _, test := range []struct {
		expected, actual any
		equal            bool
	}{
		{true, int64(1), true}, {false, int64(0), true}, {true, int64(2), false},
		{float64(12), int64(12), true}, {float64(12), int64(13), false},
		{"text", "text", true}, {nil, nil, true}, {nil, "", false},
	} {
		if legacyValueEqual(test.expected, test.actual) != test.equal {
			t.Fatalf("comparison %#v %#v", test.expected, test.actual)
		}
	}
}
