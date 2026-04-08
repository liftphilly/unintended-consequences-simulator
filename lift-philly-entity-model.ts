/**
 * LIFT Philly Entity Comparison Model — V10
 * ==========================================
 * TypeScript implementation of the CPA-validated Excel model (v10).
 * Source: onePhilly_scorp_vs_llc_tax_model_v10.xlsx (Jigar Mehta, 2026-04-07)
 *
 * SINGLE SOURCE OF TRUTH: This module owns all tax math.
 * The HTML simulator and test harness both consume these functions.
 *
 * VALIDATED: S-Corp and LLC calculations match v10 spreadsheet cell-by-cell
 * at $1M/$600K/$100K. All assertions pass. Multi-scenario validation at 7
 * income levels confirms formulas across $50K–$1M profit range.
 *
 * Ported from: scripts/lift-philly-entity-model.py
 * Review doc: documents/v10-review-2026-04-07.md
 */

// ============================================================
// Assumptions (from V10 Assumptions tab)
// ============================================================

export interface Assumptions {
  // Federal
  standardDeduction: number;      // B9
  ssWageBase: number;             // B26
  employeeSsRate: number;         // B21
  employerSsRate: number;         // B24
  employeeMedicareRate: number;   // B22
  employerMedicareRate: number;   // B25
  additionalMedicareThreshold: number; // B27
  additionalMedicareRate: number; // B23

  // PA
  paPitRate: number;              // B10

  // Philadelphia
  wageTaxRate: number;            // B11
  nptRate: number;                // B12
  sitRate: number;                // B13 (SIT on S-Corp K-1)
  birtNiRate: number;             // B29
  birtGrRate: number;             // B28
  nptCreditPct: number;           // NPT credit against BIRT NI

  // SALT (OBBBA 2026)
  saltCap: number;                // B14
  saltThreshold: number;          // B15
  saltFloor: number;              // B16

  // QBI
  qbiRate: number;                // B17
  qbiThreshold: number;           // B34 (note: IRS shows $201,775)
  qbiPhaseRange: number;          // B35 - B34

  // SE tax
  seAdjust: number;               // B18
  seSsRate: number;               // B19 (combined employee+employer)
  seMedicareRate: number;         // B20 (combined employee+employer)
  seContributionRate: number;     // B32 (effective self-employed rate)

  // Retirement
  employee401kLimit: number;      // B30
  annualAdditionsLimit: number;   // B31

  // Other
  ubia: number;
  mortgageInterest: number;
  charitable: number;
  otherItemized: number;
  netCapGain: number;
  sstb: boolean;

  // Federal brackets (2026 single filer)
  brackets: readonly [number, number][];
}

export const DEFAULTS: Assumptions = {
  // Federal
  standardDeduction: 16_100,       // B9
  ssWageBase: 184_500,             // B26
  employeeSsRate: 0.062,           // B21
  employerSsRate: 0.062,           // B24
  employeeMedicareRate: 0.0145,    // B22
  employerMedicareRate: 0.0145,    // B25
  additionalMedicareThreshold: 200_000, // B27
  additionalMedicareRate: 0.009,   // B23

  // PA
  paPitRate: 0.0307,               // B10

  // Philadelphia
  wageTaxRate: 0.0374,             // B11
  nptRate: 0.0374,                 // B12
  sitRate: 0.0374,                 // B13
  birtNiRate: 0.0571,              // B29
  birtGrRate: 0.00141,             // B28
  nptCreditPct: 0.60,              // NPT credit against BIRT NI

  // SALT (OBBBA 2026)
  saltCap: 40_400,                 // B14
  saltThreshold: 505_000,          // B15
  saltFloor: 10_000,               // B16

  // QBI
  qbiRate: 0.20,                   // B17
  qbiThreshold: 201_750,           // B34
  qbiPhaseRange: 75_000,           // B35 - B34

  // SE tax
  seAdjust: 0.9235,                // B18
  seSsRate: 0.124,                 // B19
  seMedicareRate: 0.029,           // B20
  seContributionRate: 0.20,        // B32

  // Retirement
  employee401kLimit: 24_500,       // B30
  annualAdditionsLimit: 72_000,    // B31

  // Other
  ubia: 0,
  mortgageInterest: 0,
  charitable: 0,
  otherItemized: 0,
  netCapGain: 0,
  sstb: false,

  // Federal brackets (2026 single filer)
  brackets: [
    [12_400, 0.10],
    [50_400, 0.12],
    [105_700, 0.22],
    [201_775, 0.24],
    [256_225, 0.32],
    [640_600, 0.35],
    [Infinity, 0.37],
  ],
};

// ============================================================
// Shared helpers
// ============================================================

/** Nested IF bracket calculation matching v10 scenario tabs. */
export function federalIncomeTax(taxableIncome: number, brackets: readonly [number, number][] = DEFAULTS.brackets): number {
  if (taxableIncome <= 0) return 0;
  let tax = 0;
  let prev = 0;
  for (const [ceiling, rate] of brackets) {
    if (taxableIncome <= prev) break;
    const bracketIncome = Math.min(taxableIncome, ceiling) - prev;
    tax += bracketIncome * rate;
    prev = ceiling;
  }
  return tax;
}

/** OBBBA dynamic SALT cap: MIN(actual_paid, MAX(floor, cap - 0.3 * excess)). */
export function saltDeduction(saltPaid: number, agi: number, a: Assumptions = DEFAULTS): number {
  const cap = Math.max(a.saltFloor, a.saltCap - 0.3 * Math.max(0, agi - a.saltThreshold));
  return Math.min(saltPaid, cap);
}

/**
 * Section 199A QBI deduction with phase-in and net cap gain cap.
 * Matches v10 formulas B55-B56 (SCorp) / B49-B50 (LLC).
 */
export function qbiDeduction(
  qbiBase: number,
  w2Wages: number,
  ubia: number,
  taxableIncome: number,
  netCapGain: number = 0,
  sstb: boolean = false,
  a: Assumptions = DEFAULTS,
): number {
  if (qbiBase <= 0) return 0;

  const twentyPct = qbiBase * 0.20;
  const threshold = a.qbiThreshold;
  const phaseCeiling = threshold + a.qbiPhaseRange;

  // Phase-in percentage
  const phasePct = Math.max(0, Math.min(1, (taxableIncome - threshold) / a.qbiPhaseRange));

  // Tentative QBI (B55 / B49)
  let tentative: number;
  if (taxableIncome <= threshold) {
    tentative = twentyPct;
  } else if (sstb) {
    if (taxableIncome >= phaseCeiling) {
      tentative = 0;
    } else {
      const adjQbi = qbiBase * (1 - phasePct);
      const adjTwenty = adjQbi * 0.20;
      const adjW2 = w2Wages * (1 - phasePct);
      const optA = adjW2 * 0.50;
      const optB = adjW2 * 0.25 + ubia * 0.025 * (1 - phasePct);
      const cap = Math.max(optA, optB);
      tentative = Math.max(0, Math.min(adjTwenty, cap));
    }
  } else {
    const wageUbiaCap = Math.max(0.5 * w2Wages, 0.25 * w2Wages + 0.025 * ubia);
    if (taxableIncome >= phaseCeiling) {
      tentative = Math.min(twentyPct, wageUbiaCap);
    } else {
      const reduction = Math.max(0, twentyPct - wageUbiaCap);
      tentative = Math.max(0, twentyPct - phasePct * reduction);
    }
  }

  // Net capital gain cap (B56 / B50)
  const allowed = Math.min(tentative, Math.max(0, 0.2 * (taxableIncome - netCapGain)));
  return allowed;
}

// ============================================================
// S-Corp (V10 SCorp tab)
// ============================================================

export interface SCorpResult {
  revenue: number;
  expenses: number;
  w2Wages: number;
  employee401k: number;
  employer401k: number;
  total401k: number;
  box1Wages: number;
  employerSs: number;
  employerMedicare: number;
  employerPayroll: number;
  preBirt: number;
  birtGr: number;
  birtNi: number;
  birtTotal: number;
  k1Passthrough: number;
  paTaxableWages: number;
  paTaxableScorp: number;
  paPit: number;
  wageTax: number;
  sit: number;
  npt: number;
  employeeSs: number;
  employeeMedicare: number;
  additionalMedicare: number;
  employeePayroll: number;
  agi: number;
  saltPaid: number;
  saltAllowed: number;
  itemizedTotal: number;
  deductionUsed: number;
  taxablePreQbi: number;
  qbiBase: number;
  qbiPhasePct: number;
  qbiTentative: number;
  qbiAllowed: number;
  fedTaxable: number;
  fedIncomeTax: number;
  ownerTax: number;
  afterTax: number;
  afterTaxPlusRetirement: number;
}

/** V10 SCorp tab, cell by cell. */
export function calcScorp(revenue: number, income: number, w2Wages: number, a: Assumptions = DEFAULTS): SCorpResult {
  const expenses = revenue - income;

  // Retirement (B7-B8)
  const employee401k = Math.min(a.employee401kLimit, w2Wages);
  const employer401k = Math.min(0.25 * w2Wages, a.annualAdditionsLimit - employee401k);
  const total401k = employee401k + employer401k;

  // Box 1 (B20)
  const box1 = w2Wages - employee401k;

  // Employer payroll (B21-B23)
  const erSs = Math.min(w2Wages, a.ssWageBase) * a.employerSsRate;
  const erMed = w2Wages * a.employerMedicareRate;
  const erPayroll = erSs + erMed;

  // Pre-BIRT net income (B24)
  const preBirt = income - w2Wages - erPayroll - employer401k;

  // BIRT (B25-B28)
  const birtGr = revenue * a.birtGrRate;
  const birtNi = Math.max(0, preBirt) * a.birtNiRate; // MAX(0,...) per v10
  const birtTotal = birtGr + birtNi;
  const k1 = preBirt - birtTotal;

  // PA PIT (B31-B33) — only deduct BIRT GR, not BIRT NI
  const paWages = w2Wages;
  const paScorp = preBirt - birtGr; // B32 = B24 - B25 (excludes BIRT NI)
  const paPit = Math.max(0, paWages + paScorp) * a.paPitRate;

  // Philadelphia taxes (B34-B36)
  const wageTax = w2Wages * a.wageTaxRate;
  const sit = k1 * a.sitRate;
  const npt = 0; // S-Corp NPT is always 0

  // Employee payroll (B37-B40)
  const eeSs = Math.min(w2Wages, a.ssWageBase) * a.employeeSsRate;
  const eeMed = w2Wages * a.employeeMedicareRate;
  const addlMed = Math.max(0, w2Wages - a.additionalMedicareThreshold) * a.additionalMedicareRate;
  const eePayroll = eeSs + eeMed + addlMed;

  // Federal AGI (B43-B46)
  const agi = box1 + k1;

  // SALT deduction (B47-B51) — includes SIT
  const saltPaid = paPit + wageTax + sit;
  const saltUsed = saltDeduction(saltPaid, agi, a);
  const itemized = saltUsed + a.otherItemized;
  const deduction = Math.max(itemized, a.standardDeduction);

  // QBI (B52-B57)
  const taxablePreQbi = Math.max(0, agi - deduction);
  const qbiBase = Math.max(0, k1);
  const qbiPhase = Math.max(0, Math.min(1, (taxablePreQbi - a.qbiThreshold) / a.qbiPhaseRange));

  const qbiVal = qbiDeduction(qbiBase, w2Wages, a.ubia, taxablePreQbi, a.netCapGain, a.sstb, a);

  // Extract tentative for reporting (before net cap gain cap)
  let qbiTent: number;
  if (taxablePreQbi <= a.qbiThreshold) {
    qbiTent = qbiBase * 0.20;
  } else if (taxablePreQbi >= a.qbiThreshold + a.qbiPhaseRange) {
    qbiTent = Math.min(qbiBase * 0.20, Math.max(0.5 * w2Wages, 0.25 * w2Wages + 0.025 * a.ubia));
  } else {
    const wageCap = Math.max(0.5 * w2Wages, 0.25 * w2Wages + 0.025 * a.ubia);
    const reduction = Math.max(0, qbiBase * 0.20 - wageCap);
    qbiTent = Math.max(0, qbiBase * 0.20 - qbiPhase * reduction);
  }

  const fedTaxable = Math.max(0, taxablePreQbi - qbiVal);
  const fedTax = federalIncomeTax(fedTaxable);

  // Summary (B71-B80)
  const ownerTax = paPit + wageTax + sit + eePayroll + fedTax;
  const afterTax = agi - ownerTax;
  const afterTaxRet = afterTax + total401k;

  return {
    revenue, expenses, w2Wages,
    employee401k, employer401k, total401k,
    box1Wages: box1,
    employerSs: erSs, employerMedicare: erMed, employerPayroll: erPayroll,
    preBirt, birtGr, birtNi, birtTotal,
    k1Passthrough: k1,
    paTaxableWages: paWages, paTaxableScorp: paScorp,
    paPit, wageTax, sit, npt,
    employeeSs: eeSs, employeeMedicare: eeMed,
    additionalMedicare: addlMed, employeePayroll: eePayroll,
    agi, saltPaid, saltAllowed: saltUsed,
    itemizedTotal: itemized, deductionUsed: deduction,
    taxablePreQbi, qbiBase,
    qbiPhasePct: qbiPhase, qbiTentative: qbiTent, qbiAllowed: qbiVal,
    fedTaxable, fedIncomeTax: fedTax,
    ownerTax, afterTax,
    afterTaxPlusRetirement: afterTaxRet,
  };
}

// ============================================================
// LLC Individual — BIRT-exempt (V10 LLC_Individual tab)
// Models post-reform scenario where LLCs are exempt from BIRT.
// ============================================================

export interface LLCResult {
  revenue: number;
  expenses: number;
  profit: number;
  seIncome: number;
  seSs: number;
  seMedicare: number;
  additionalMedicare: number;
  seTotal: number;
  halfSe: number;
  paPit: number;
  npt: number;
  earnedIncome: number;
  employee401k: number;
  retirement: number;
  agi: number;
  saltPaid: number;
  saltAllowed: number;
  itemizedTotal: number;
  deductionUsed: number;
  taxablePreQbi: number;
  qbiBase: number;
  qbiPhasePct: number;
  qbiTentative: number;
  qbiAllowed: number;
  fedTaxable: number;
  fedIncomeTax: number;
  ownerTax: number;
  afterTax: number;
  afterTaxPlusRetirement: number;
}

/** V10 LLC_Individual tab, cell by cell. BIRT-exempt post-reform model. */
export function calcLlcReform(revenue: number, income: number, a: Assumptions = DEFAULTS): LLCResult {
  const expenses = revenue - income;
  const profit = income; // Schedule C profit (no BIRT)

  // SE tax (B23-B28)
  const seIncome = Math.max(0, profit) * a.seAdjust;
  const seSs = Math.min(seIncome, a.ssWageBase) * a.seSsRate;
  const seMed = seIncome * a.seMedicareRate;
  const addlMed = Math.max(0, seIncome - a.additionalMedicareThreshold) * a.additionalMedicareRate;
  const seTotal = seSs + seMed + addlMed;
  const halfSe = (seSs + seMed) / 2; // Does NOT include additional Medicare

  // State/city taxes (B31-B32)
  const paPit = Math.max(0, profit) * a.paPitRate;
  const npt = Math.max(0, profit) * a.nptRate;

  // Earned income and retirement (B37, B7-B8)
  const earned = profit - halfSe;
  const ee401k = Math.min(a.employee401kLimit, Math.max(0, earned));
  const retirement = Math.min(a.annualAdditionsLimit, ee401k + a.seContributionRate * earned);

  // Federal AGI (B40)
  const agi = earned - retirement;

  // SALT deduction (B41-B45) — NPT goes into SALT
  const saltPaid = paPit + npt;
  const saltUsed = saltDeduction(saltPaid, agi, a);
  const itemized = saltUsed + a.otherItemized;
  const deduction = Math.max(itemized, a.standardDeduction);

  // QBI (B46-B51)
  const taxablePreQbi = Math.max(0, agi - deduction);
  const qbiBase = Math.max(0, profit - halfSe - retirement);
  const qbiPhase = Math.max(0, Math.min(1, (taxablePreQbi - a.qbiThreshold) / a.qbiPhaseRange));

  const qbiVal = qbiDeduction(qbiBase, 0, a.ubia, taxablePreQbi, a.netCapGain, a.sstb, a);

  // Tentative for reporting
  let qbiTent: number;
  if (taxablePreQbi <= a.qbiThreshold) {
    qbiTent = qbiBase * 0.20;
  } else if (taxablePreQbi >= a.qbiThreshold + a.qbiPhaseRange) {
    qbiTent = 0; // W2=0, UBIA=0 -> cap=0
  } else {
    qbiTent = Math.max(0, qbiBase * 0.20 - qbiPhase * qbiBase * 0.20);
  }

  const fedTaxable = Math.max(0, taxablePreQbi - qbiVal);
  const fedTax = federalIncomeTax(fedTaxable);

  // Summary (B66-B73)
  const ownerTax = paPit + npt + seTotal + fedTax;
  const afterTax = profit - retirement - ownerTax;
  const afterTaxRet = afterTax + retirement;

  return {
    revenue, expenses, profit,
    seIncome, seSs, seMedicare: seMed,
    additionalMedicare: addlMed, seTotal, halfSe,
    paPit, npt,
    earnedIncome: earned, employee401k: ee401k, retirement,
    agi, saltPaid, saltAllowed: saltUsed,
    itemizedTotal: itemized, deductionUsed: deduction,
    taxablePreQbi, qbiBase,
    qbiPhasePct: qbiPhase, qbiTentative: qbiTent, qbiAllowed: qbiVal,
    fedTaxable, fedIncomeTax: fedTax,
    ownerTax, afterTax,
    afterTaxPlusRetirement: afterTaxRet,
  };
}

// ============================================================
// LLC Actual — Current law (BIRT NI + GR + NPT)
// For comparison: what LLCs pay TODAY before any reform.
// ============================================================

export interface LLCActualResult {
  revenue: number;
  expenses: number;
  profit: number;
  birtGr: number;
  birtNi: number;
  birtTotal: number;
  nptBeforeCredit: number;
  nptCredit: number;
  netNpt: number;
  seIncome: number;
  seSs: number;
  seMedicare: number;
  additionalMedicare: number;
  seTotal: number;
  halfSe: number;
  paPit: number;
  earnedIncome: number;
  employee401k: number;
  retirement: number;
  agi: number;
  saltPaid: number;
  saltAllowed: number;
  itemizedTotal: number;
  deductionUsed: number;
  taxablePreQbi: number;
  qbiBase: number;
  qbiAllowed: number;
  fedTaxable: number;
  fedIncomeTax: number;
  ownerTax: number;
  afterTax: number;
  afterTaxPlusRetirement: number;
}

/** LLC under current law: full BIRT NI + GR + NPT with credit. */
export function calcLlcActual(revenue: number, income: number, a: Assumptions = DEFAULTS): LLCActualResult {
  const expenses = revenue - income;
  const profit = income;

  // BIRT (business-level)
  const birtGr = revenue * a.birtGrRate;
  const birtNi = Math.max(0, profit) * a.birtNiRate;
  const birtTotal = birtGr + birtNi;

  // NPT with credit against BIRT NI
  const nptBefore = profit * a.nptRate;
  const nptCredit = Math.min(a.nptCreditPct * birtNi, nptBefore);
  const netNpt = nptBefore - nptCredit;

  // SE tax — BIRT and NPT reduce SE base (they're business taxes paid)
  const seBase = Math.max(0, profit - birtNi - birtGr - netNpt) * a.seAdjust;
  const seSs = Math.min(seBase, a.ssWageBase) * a.seSsRate;
  const seMed = seBase * a.seMedicareRate;
  const addlMed = Math.max(0, seBase - a.additionalMedicareThreshold) * a.additionalMedicareRate;
  const seTotal = seSs + seMed + addlMed;
  const halfSe = (seSs + seMed) / 2;

  // PA PIT — on full profit (BIRT is city tax, not deductible from PA PIT per v10 logic)
  const paPit = Math.max(0, profit) * a.paPitRate;

  // Earned income and retirement
  const earned = profit - halfSe - birtNi - birtGr - netNpt;
  const ee401k = Math.min(a.employee401kLimit, Math.max(0, earned));
  const retirement = Math.min(a.annualAdditionsLimit, ee401k + a.seContributionRate * Math.max(0, earned));

  // AGI — BIRT and NPT are business taxes, treated as SALT for federal
  const agi = earned - retirement;

  // SALT — includes PA PIT + NPT + BIRT (all state/local taxes)
  const saltPaid = paPit + netNpt + birtNi + birtGr;
  const saltUsed = saltDeduction(saltPaid, agi, a);
  const itemized = saltUsed + a.otherItemized;
  const deduction = Math.max(itemized, a.standardDeduction);

  // QBI
  const taxablePreQbi = Math.max(0, agi - deduction);
  const qbiBase = Math.max(0, profit - halfSe - retirement - birtNi - birtGr - netNpt);
  const qbiVal = qbiDeduction(qbiBase, 0, a.ubia, taxablePreQbi, a.netCapGain, a.sstb, a);

  const fedTaxable = Math.max(0, taxablePreQbi - qbiVal);
  const fedTax = federalIncomeTax(fedTaxable);

  // Summary
  const ownerTax = paPit + netNpt + birtNi + birtGr + seTotal + fedTax;
  const afterTax = profit - retirement - ownerTax;
  const afterTaxRet = afterTax + retirement;

  return {
    revenue, expenses, profit,
    birtGr, birtNi, birtTotal,
    nptBeforeCredit: nptBefore, nptCredit, netNpt,
    seIncome: seBase, seSs, seMedicare: seMed,
    additionalMedicare: addlMed, seTotal, halfSe,
    paPit,
    earnedIncome: earned, employee401k: ee401k, retirement,
    agi, saltPaid, saltAllowed: saltUsed,
    itemizedTotal: itemized, deductionUsed: deduction,
    taxablePreQbi, qbiBase, qbiAllowed: qbiVal,
    fedTaxable, fedIncomeTax: fedTax,
    ownerTax, afterTax,
    afterTaxPlusRetirement: afterTaxRet,
  };
}
