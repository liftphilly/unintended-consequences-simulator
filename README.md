# Unintended Consequences Simulator

**Would S-Corp owners really dissolve their corporations and reclassify as LLCs?** That's the biggest concern raised about Philadelphia's proposed LIFT Act ([Bill No. 251026](https://liftphilly.org/petition/#sign-section)). This simulator tests that claim.

**[Live Simulator](https://liftphilly.org/simulator/)**

## What it does

Compares the total tax burden (federal, state, and city) for S-Corp owners vs single-member LLCs across a wide range of income levels. Users can adjust gross revenue, operating expenses, and S-Corp W-2 salary to see a full side-by-side tax breakdown in real time.

**The finding:** At virtually every income level, S-Corp owners pay less tax than LLCs. The advantage comes from federal payroll tax savings that no city bill can change.

## Files

| File | Description |
|------|-------------|
| `index.html` | Self-contained simulator page (HTML/CSS/JS, no build step) |
| `lift-philly-entity-model.ts` | TypeScript tax engine — single source of truth for all calculations |
| `lift-philly-entity-model.test.ts` | 79 tests validating the model against the reference spreadsheet |
| `onePhilly_scorp_vs_llc_tax_model_v10.xlsx` | Reference Excel model (v10) for independent review |

## Tax engine

The TypeScript model calculates three scenarios:

- **S-Corp** — W-2 salary + K-1 distributions, employer payroll, QBI deduction, BIRT Net Income
- **LLC (Reform)** — Solo classification under the proposed LIFT Act (BIRT-exempt)
- **LLC (Current Law)** — Current BIRT treatment for unincorporated businesses

### Running the tests

```bash
bun test lift-philly-entity-model.test.ts
```

All 79 tests pass, confirming exact match with the reference spreadsheet.

## Disclaimer

This simulator is for educational purposes only and is not intended as legal or tax advice. Consult a qualified tax professional for your specific situation.

## License

MIT
