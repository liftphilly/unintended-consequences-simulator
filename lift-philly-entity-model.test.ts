/**
 * LIFT Philly Entity Model — V10 Test Harness
 * =============================================
 * Validates the TypeScript entity model against the v10 spreadsheet values.
 * Reference scenario: $1M revenue / $600K expenses / $100K W-2
 *
 * Run: bun test scripts/lift-philly-entity-model.test.ts
 */

import { describe, expect, test } from "bun:test";
import { calcScorp, calcLlcReform, calcLlcActual, federalIncomeTax, saltDeduction, qbiDeduction, DEFAULTS } from "./lift-philly-entity-model";

const TOLERANCE = 1.0; // $1 tolerance, matching Python model

function expectClose(actual: number, expected: number, label: string) {
  const diff = Math.abs(actual - expected);
  if (diff >= TOLERANCE) {
    throw new Error(`${label}: expected ${expected.toFixed(2)}, got ${actual.toFixed(2)}, diff ${diff.toFixed(2)}`);
  }
}

// ============================================================
// V10 Reference Scenario: $1M revenue / $600K expenses / $100K W-2
// ============================================================

describe("V10 Reference Scenario ($1M/$600K/$100K)", () => {
  const s = calcScorp(1_000_000, 400_000, 100_000);
  const l = calcLlcReform(1_000_000, 400_000);

  // --- S-Corp assertions (13 checks) ---
  describe("S-Corp", () => {
    test("birt_total = $16,675.69", () => expectClose(s.birtTotal, 16_675.685, "birtTotal"));
    test("pa_pit = $11,234.36", () => expectClose(s.paPit, 11_234.358, "paPit"));
    test("wage_tax = $3,740.00", () => expectClose(s.wageTax, 3_740.000, "wageTax"));
    test("sit = $9,375.22", () => expectClose(s.sit, 9_375.219, "sit"));
    test("employee_payroll = $7,650.00", () => expectClose(s.employeePayroll, 7_650.000, "employeePayroll"));
    test("fed_income_tax = $57,039.92", () => expectClose(s.fedIncomeTax, 57_039.916, "fedIncomeTax"));
    test("owner_tax = $89,039.49", () => expectClose(s.ownerTax, 89_039.493, "ownerTax"));
    test("after_tax = $237,134.82", () => expectClose(s.afterTax, 237_134.822, "afterTax"));
    test("after_tax_plus_retirement = $286,634.82", () => expectClose(s.afterTaxPlusRetirement, 286_634.822, "afterTaxPlusRetirement"));
    test("k1_passthrough = $250,674.32", () => expectClose(s.k1Passthrough, 250_674.315, "k1Passthrough"));
    test("agi = $326,174.32", () => expectClose(s.agi, 326_174.315, "agi"));
    test("salt_paid = $24,349.58", () => expectClose(s.saltPaid, 24_349.577, "saltPaid"));
    test("qbi_allowed = $50,000.00", () => expectClose(s.qbiAllowed, 50_000.000, "qbiAllowed"));
  });

  // --- LLC assertions (10 checks) ---
  describe("LLC (BIRT-exempt / post-reform)", () => {
    test("pa_pit = $12,280.00", () => expectClose(l.paPit, 12_280.000, "paPit"));
    test("npt = $14,960.00", () => expectClose(l.npt, 14_960.000, "npt"));
    test("se_total = $35,115.20", () => expectClose(l.seTotal, 35_115.200, "seTotal"));
    test("fed_income_tax = $68,156.90", () => expectClose(l.fedIncomeTax, 68_156.895, "fedIncomeTax"));
    test("owner_tax = $130,512.10", () => expectClose(l.ownerTax, 130_512.095, "ownerTax"));
    test("after_tax = $197,487.91", () => expectClose(l.afterTax, 197_487.905, "afterTax"));
    test("after_tax_plus_retirement = $269,487.91", () => expectClose(l.afterTaxPlusRetirement, 269_487.905, "afterTaxPlusRetirement"));
    test("retirement = $72,000.00", () => expectClose(l.retirement, 72_000.000, "retirement"));
    test("agi = $311,204.70", () => expectClose(l.agi, 311_204.700, "agi"));
    test("qbi_allowed = $0.00", () => expectClose(l.qbiAllowed, 0.000, "qbiAllowed"));
  });

  // --- Compare tab ---
  describe("Compare", () => {
    test("S-Corp tax advantage ~$41,473", () => {
      const taxAdvantage = l.ownerTax - s.ownerTax;
      expectClose(taxAdvantage, 41_472.602, "taxAdvantage");
    });

    test("S-Corp net+ret advantage ~$17,147", () => {
      const netAdvantage = s.afterTaxPlusRetirement - l.afterTaxPlusRetirement;
      expectClose(netAdvantage, 17_146.917, "netAdvantage");
    });
  });
});

// ============================================================
// Multi-scenario validation (7 income levels)
// These verify the model doesn't break at different scales.
// ============================================================

describe("Multi-scenario consistency", () => {
  const scenarios: [number, number, number, string][] = [
    [50_000, 100_000, 40_000, "Micro freelancer ($50K/$100K)"],
    [100_000, 200_000, 70_000, "Solo consultant ($100K/$200K)"],
    [150_000, 400_000, 100_000, "Established freelancer ($150K/$400K)"],
    [250_000, 750_000, 150_000, "Growing business ($250K/$750K)"],
    [400_000, 1_000_000, 100_000, "V10 reference ($400K/$1M)"],
    [500_000, 2_000_000, 200_000, "Large operation ($500K/$2M)"],
    [1_000_000, 3_000_000, 300_000, "Million-dollar earner ($1M/$3M)"],
  ];

  for (const [income, revenue, w2, label] of scenarios) {
    describe(label, () => {
      const s = calcScorp(revenue, income, w2);
      const l = calcLlcReform(revenue, income);
      const a = calcLlcActual(revenue, income);

      test("S-Corp after_tax is positive", () => {
        expect(s.afterTax).toBeGreaterThan(0);
      });

      test("LLC Reform after_tax is positive", () => {
        expect(l.afterTax).toBeGreaterThan(0);
      });

      test("LLC Actual after_tax is positive", () => {
        expect(a.afterTax).toBeGreaterThan(0);
      });

      test("S-Corp owner_tax < income", () => {
        expect(s.ownerTax).toBeLessThan(income);
      });

      test("LLC Reform owner_tax < income", () => {
        expect(l.ownerTax).toBeLessThan(income);
      });

      test("LLC Actual owner_tax < income", () => {
        expect(a.ownerTax).toBeLessThan(income);
      });

      test("all three entity types produce finite results", () => {
        expect(Number.isFinite(s.afterTax)).toBe(true);
        expect(Number.isFinite(l.afterTax)).toBe(true);
        expect(Number.isFinite(a.afterTax)).toBe(true);
      });
    });
  }
});

// ============================================================
// Helper function unit tests
// ============================================================

describe("Helper functions", () => {
  test("federalIncomeTax at $0", () => {
    expect(federalIncomeTax(0)).toBe(0);
  });

  test("federalIncomeTax at $50,000", () => {
    // 12400 * 0.10 + (50000 - 12400) * 0.12 = 1240 + 4512 = 5752
    expectClose(federalIncomeTax(50_000), 5_752, "fedTax50k");
  });

  test("saltDeduction below threshold returns actual", () => {
    // AGI well below threshold, salt paid < cap
    const result = saltDeduction(10_000, 200_000);
    expect(result).toBe(10_000);
  });

  test("saltDeduction above threshold reduces cap", () => {
    // AGI $600K, well above $505K threshold
    const result = saltDeduction(50_000, 600_000);
    // cap = max(10000, 40400 - 0.3 * (600000 - 505000)) = max(10000, 40400 - 28500) = max(10000, 11900) = 11900
    expectClose(result, 11_900, "saltHighAgi");
  });

  test("qbiDeduction below threshold = 20% of base", () => {
    const result = qbiDeduction(100_000, 50_000, 0, 150_000);
    expectClose(result, 20_000, "qbiBelow");
  });
});
