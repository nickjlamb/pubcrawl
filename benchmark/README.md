# PubCrawl fidelity benchmark

Deterministic checks that the labelling and trials tools return what the
sources say — no LLM judge, no scoring model. Run against the *built* server
(`dist/`), so it tests the code being released.

## Why

PubCrawl's pitch is verifiability: every result is a thin wrapper over an
official source and nothing is invented. The OpenGATE retrieval gate already
holds that line for PubMed and Europe PMC records. This benchmark extends it to
the two tool families the literature gate doesn't touch — **drug labelling**
(including `compare_labels`, the tool no other MCP server offers) and
**clinical trials**.

## What is measured

| Suite | Check | Metric |
|---|---|---|
| labels | Both labels retrieved, and the mapped section present on each side | section coverage |
| labels | Hand-verified phrases present where the label says them (`must_contain`) | anchor recall |
| labels | …and absent where the other market's label does *not* say them (`must_not_contain`) — the divergence is real and surfaced, not smoothed over | divergences held |
| labels | Every returned sentence is a verbatim substring of the raw source, refetched independently (openFDA JSON by set id; the eMC SmPC page) | verbatim rate ("0 invented") |
| labels | Status semantics: a missing side is reported as `unavailable` with a note, and an unknown drug returns one explanatory error | status cases |
| trials | NCT id, title, phase, sponsor, conditions, interventions, primary outcome and linked PMIDs come back matching the registry record | anchor pass rate |

## Case status: draft vs verified

Every case carries `"status"`. **draft** means the anchor was written from the
label as understood (for the first four drugs, from *One molecule, two labels*,
checked live on 25 August 2026) but has **not** been re-checked against the live
label by a person. **verified** means someone opened the label at the source
URL the tool returned and confirmed the anchor, recording `verified_by` and
`verified_on`.

The rule that keeps this honest: **a case becomes verified by checking it, never
by editing the anchor until it passes.** If a verified case starts failing, the
label changed or the parser regressed — both are worth knowing, and the gate
should go red.

In `--ci` mode only verified cases can fail the run; draft results print as
`warn`. Set `"frozen": true` on the set once every case is verified, and stop
editing anchors after that (add new cases instead).

## Running

```bash
npm run build
npm run bench                 # labels + trials, verbatim check on
npm run bench -- --labels     # one suite
npm run bench -- --only ozempic-indications
npm run bench -- --save       # writes results/<date>.json and results/latest.json
npm run bench -- --ci         # exit 1 if any verified case fails
npm run bench -- --no-verbatim
```

Online by design: it calls openFDA, the eMC and ClinicalTrials.gov live, so it
runs on release and weekly (see `.github/workflows/opengate.yml`), not on every
push. Expect ~1 s per UK label (eMC rate limit).

## What the first runs found (14 Sep 2026)

Three runs before any anchor was verified. Trials: 5/5 after correcting one
anchor to what the registry actually says. Labels, run 3: 17/24 cases passed,
section coverage 19/21, verbatim 255/255 sentences (100%), 0 sides needed the
retry. Three anchors were mine and wrong and were corrected to the label's
wording (US Ozempic contraindications say "MTC" and "MEN 2"; the UK ibuprofen
SmPC says "last trimester"; the UK amoxicillin SmPC writes "betalactam" as one
word). The other seven warnings were the engine, not the labels:

- **Truncation.** `@pharmatools/drug-data` cuts every section at 1,400
  characters. 13 of the 40 sections returned in run 3 were cut, making 5
  anchors in 4 cases unverifiable (Keytruda's TMB-H indication, tamoxifen's DCIS,
  atorvastatin's UK 4.4 myopathy text all sit past the cap). PubCrawl now flags
  these `truncated`; raising the cap is an engine change.
- **Resolution.** openFDA best-match takes the five most recently updated
  labels, so `ibuprofen` and `omeprazole` — and their brands Motrin and
  Prilosec — land on OTC labels with no contraindications section (→
  "unavailable"), and `dapagliflozin` on a generic manufacturer's label. The
  eMC best-match picked a Boots paediatric suspension for ibuprofen and
  Alogliptin/Metformin for metformin. Cases now pin products with `us_drug` /
  `uk_drug` (Farxiga/Forxiga resolved correctly once pinned); the two OTC cases
  stay in the set as a standing finding.
- **Flakiness.** Apixaban, amoxicillin, valproate and Keytruda had a UK label in
  run 1 and none in run 2. The engine has no pacing or retry against the eMC and
  returns null for throttling and absence alike. The runner now waits 1.5 s
  between drugs and retries an unavailable side once after 4 s; in run 3 every
  previously flaky side came back on the first attempt and no retry recovered
  anything, which points at request rate rather than the eMC being down.

Verbatim held at 100% in every run (255/255 sentences in run 3,
whitespace-insensitive) — what the tool returns is the source's text; the
problems are what it doesn't return.

## Adding a case

Pick a drug licensed in both markets. Ask `compare_labels` for the topic, open
the two source URLs it returns, and choose short phrases that are unambiguous
in one label and genuinely absent from the other. Include convergence cases
too (both sides agree) so the set can catch false divergence. Prefer product
names (`Ozempic`, `Keytruda`) where a generic resolves to several products.
