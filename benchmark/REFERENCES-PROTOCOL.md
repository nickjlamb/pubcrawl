# `check_references` benchmark: protocol

**Status:** pre-registration. Written 24 November 2026, before any benchmark run.
Nothing in this file is a result. Results go in `benchmark/results/` and in a
separate write-up, and no figure is published before the run that produces it.

## Purpose

`check_references` reports each reference in a PMC paper as `resolved`,
`wrong_identifier`, `not_found` or `not_checked`. It shipped with no accuracy
claim. This benchmark measures three things:

1. How often it flags a reference in papers written before AI writing tools existed.
2. Whether it catches a bad reference that carries an identifier.
3. How much real-world fabrication it can see at all (phase 2).

It is deterministic, as the rest of `benchmark/` is: no model judges anything.
Every judgement that needs a person is made by a named person and recorded.

## What is under test

The code on `main` at the commit recorded with each run (`git rev-parse HEAD`
is saved in the results file). Matching thresholds at pre-registration:
`TITLE_MATCH_THRESHOLD = 0.7`, `TEXT_COVERAGE_THRESHOLD = 0.8`
(`src/lib/references.ts`).

## Set 1: control papers (false alarms and coverage)

**Population.** Papers in the PMC Open Access subset published 2015 to 2021
inclusive. ChatGPT was released in November 2022, so these reference lists were
written without large language models.

**Sampling.** Seed `20261124`. Draw PMCIDs uniformly at random, with that seed,
from PMC4000000 to PMC9000000. Fetch each. Keep a paper if all of these hold:

- publication year (print or electronic, whichever is earlier) is 2015 to 2021
- article type is `research-article` or `review-article`
- the XML has a reference list with at least 10 references

Continue until 100 papers are kept. Every skipped PMCID is logged with its
reason. The sampling script is committed and its output (the 100 PMCIDs, in draw
order) is committed before any paper is checked.

**Split.** The first 30 kept papers are the development set. The next 70 are the
held-out set. The two are never pooled into one figure.

**Adjudication of flags.** Every reference the tool reports as `not_found` or
`wrong_identifier` is checked by hand and given one label:

| Label | Meaning |
|---|---|
| A | The cited work exists; the identifier as printed in the paper is wrong or unregistered. The tool was right about the identifier. |
| B | The cited work exists and the identifier as printed is correct. The tool was wrong. |
| C | The cited work could not be found anywhere after a 10-minute search (PubMed, Crossref, Google Scholar, the journal's own site, WorldCat). |
| D | Cannot be determined (ambiguous citation, source unreachable). |

The adjudicator records the label, the evidence (a URL or "none found") and the
date. A label is set by looking, never by changing code until the flag goes away.

**Audit of `resolved`.** 100 references reported as `resolved` are drawn at
random (same seed) from the held-out set and checked by hand: is the record the
identifier points to the work that was cited? This estimates the wrong-match rate.

## Set 2: injected faults (detection)

Real references with known corruptions, so the right answer is known by
construction.

**Source references.** Journal references reported as `resolved` in the control
set, drawn at random with seed `20261124`: 40 from the development papers,
200 from the held-out papers.

**Invented titles.** A fixed list in `benchmark/cases/references-invented-titles.json`,
committed before the run. Each title is written to be plausible for a biomedical
journal and is checked at writing time: no PubMed or Crossref result for it
scores 0.7 or higher on `titleSimilarity`. The check date is recorded per title.
Titles are drafted by Claude and reviewed by Nick Lamb. No model is called at
run time.

**Fault types.** Equal numbers of each (10 each in development, 50 each held out).
Authors, year and journal are kept from the source reference, which mirrors how
fabricated references combine real fragments.

| Type | Corruption | Expected status |
|---|---|---|
| 1 | Invented title; DOI replaced with an unregistered DOI on a real prefix | `not_found` |
| 2 | Invented title; DOI replaced with the real DOI of a different paper | `not_found` |
| 3 | Invented title; PMID replaced with the real PMID of a different paper; no DOI | `not_found` |
| 4 | Real title kept; DOI replaced with the real DOI of a different paper; no PMID | `wrong_identifier` |

**Known blind spot, stated and not scored.** An invented reference with no PMID
and no DOI is `not_checked` by design in this version. That is not counted as a
detection. Set 3 measures how common that case is in practice.

## Set 3: documented fabricated references (phase 2, not yet scheduled)

PMC papers in which specific references have been publicly documented as
non-existent (a retraction or correction notice that names them, or a published
audit that lists them). Target 10 to 15 papers. Each documented reference is
re-verified by hand before it is used. This set is added by a dated amendment
to this file before it is run.

## Procedure

1. Commit this protocol.
2. Commit the sampling script, then its output.
3. Run the development set (control papers and development injected faults).
   Thresholds or matching rules may be changed at this stage only, and each
   change is recorded under "Deviations" with its reason.
4. Freeze: commit, tag, and record the commit hash here.
5. Run the held-out set once. Run it a second time on a different day for the
   lookup-failure and repeatability figures only; the first run is the result.
6. Adjudicate flags and audit `resolved` references on the held-out set.
7. Report.

## Metrics

All proportions are reported with their numerator, denominator and a Wilson 95%
confidence interval. References cluster within papers, so each control metric
is also given per paper (share of papers with at least one flag).

| Metric | Set | Definition |
|---|---|---|
| Coverage | control | references reported `resolved`, `wrong_identifier` or `not_found`, over all references |
| Not-checked breakdown | control | `not_checked` by reason |
| Flag rate | control | `not_found` + `wrong_identifier`, per 1,000 references |
| Identifier precision | control | flagged references labelled A or C, over flagged references labelled A, B or C |
| Non-existence precision | control | `not_found` references labelled C, over `not_found` references labelled A, B or C |
| Tool error rate | control | flagged references labelled B, over all checked references |
| Wrong-match rate | control | audited `resolved` references that point to a different work, over 100 |
| Detection rate | injected | faults returned with the expected status, per fault type and overall |
| Lookup-failure rate | both | `not_checked` with reason `lookup_failed` or `lookup_limit`, over all references, per run |
| Repeatability | held-out | references whose status differs between the two runs |

## Reporting rules

- Every pre-registered metric is reported, favourable or not.
- Development and held-out figures are never combined.
- `not_found` is never described as "fabricated". Non-existence precision is the
  number that says how often it means that, and it is expected to be well below
  identifier precision.
- Every figure is stated with its n.
- The public claim is limited to what was measured: PMC papers, references that
  carry a PMID or DOI.

## After the run

About 20 hand-verified references with known expected statuses, taken from the
adjudicated set, are added as `benchmark/cases/references.json` and run in the
weekly gate as a regression check, under the existing draft/verified rule.

## Open decisions

- **Adjudicator.** Default: Nick Lamb alone. Option: a second person labels a
  random 30% of flags independently, and agreement (Cohen's kappa) is reported.
- **Phase 2 source.** Documented cases collected by hand, or a published list
  if one becomes available.

## Deviations

None yet. Any departure from this protocol is listed here with its date and reason.
