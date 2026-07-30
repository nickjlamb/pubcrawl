import { describe, it, expect } from "vitest";
import { studyToSummary } from "../src/lib/clinicaltrials.js";

// Trimmed ClinicalTrials.gov API v2 study payload.
const study = {
  protocolSection: {
    identificationModule: {
      nctId: "NCT03086486",
      briefTitle: "A Study of Pembrolizumab in Breast Cancer",
    },
    statusModule: {
      overallStatus: "RECRUITING",
      startDateStruct: { date: "2021-01-05" },
      completionDateStruct: { date: "2025-12-31" },
    },
    designModule: {
      studyType: "INTERVENTIONAL",
      phases: ["PHASE2", "PHASE3"],
      enrollmentInfo: { count: 420 },
    },
    conditionsModule: { conditions: ["Breast Cancer", "Triple Negative"] },
    armsInterventionsModule: {
      interventions: [
        { type: "DRUG", name: "Pembrolizumab" },
        { type: "DRUG", name: "Placebo" },
      ],
    },
    sponsorCollaboratorsModule: { leadSponsor: { name: "Acme Oncology" } },
  },
};

describe("studyToSummary", () => {
  it("maps identification, status and design fields", () => {
    const s = studyToSummary(study);
    expect(s.nct_id).toBe("NCT03086486");
    expect(s.title).toBe("A Study of Pembrolizumab in Breast Cancer");
    expect(s.status).toBe("RECRUITING");
    expect(s.study_type).toBe("INTERVENTIONAL");
    expect(s.enrollment).toBe(420);
    expect(s.sponsor).toBe("Acme Oncology");
  });

  it("joins multiple phases with a slash", () => {
    expect(studyToSummary(study).phase).toBe("PHASE2/PHASE3");
  });

  it("maps interventions and conditions", () => {
    const s = studyToSummary(study);
    expect(s.conditions).toEqual(["Breast Cancer", "Triple Negative"]);
    expect(s.interventions).toEqual([
      { type: "DRUG", name: "Pembrolizumab" },
      { type: "DRUG", name: "Placebo" },
    ]);
  });

  it("builds the canonical study URL from the NCT id", () => {
    expect(studyToSummary(study).url).toBe("https://clinicaltrials.gov/study/NCT03086486");
  });

  it("defaults phase to N/A when none is given", () => {
    const noPhase = {
      protocolSection: {
        ...study.protocolSection,
        designModule: { studyType: "OBSERVATIONAL" },
      },
    };
    expect(studyToSummary(noPhase).phase).toBe("N/A");
  });

  it("returns a fully-empty summary when protocolSection is missing", () => {
    const s = studyToSummary({});
    expect(s.nct_id).toBe("");
    expect(s.enrollment).toBeNull();
    expect(s.conditions).toEqual([]);
    expect(s.url).toBe("");
  });
});
