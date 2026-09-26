import { describe, it, expect } from "vitest";
import { mergeIndicationResults } from "../src/tools/search-indication.js";

const fda = [
  { generic_name: "Semaglutide", brand_name: "OZEMPIC", manufacturer: "Novo Nordisk", set_id: "set-1" },
  { generic_name: "Tirzepatide", brand_name: "MOUNJARO", manufacturer: "Eli Lilly", set_id: "" },
  { generic_name: "Onlyinus", brand_name: "USBRAND", manufacturer: "Acme", set_id: "set-3" },
];

describe("mergeIndicationResults", () => {
  it("marks a drug UK-approved only when the eMC returned a product for it", () => {
    const emc = new Map([
      ["Semaglutide", [{ product_id: "9748", name: "Ozempic", company: "Novo Nordisk" }]],
      ["Tirzepatide", []], // looked up, nothing found
    ]);
    const out = mergeIndicationResults(fda, emc);
    expect(out.map((d) => [d.name, d.uk_approved])).toEqual([
      ["semaglutide", true],
      ["tirzepatide", false],
      ["onlyinus", false],
    ]);
  });

  it("carries the first eMC product id and the openFDA set id, omitting empties", () => {
    const emc = new Map([["Semaglutide", [{ product_id: "9748", name: "Ozempic", company: "" }]]]);
    const [sema, tirz] = mergeIndicationResults(fda, emc);
    expect(sema.uk_product_id).toBe("9748");
    expect(sema.us_setid).toBe("set-1");
    expect(tirz.us_setid).toBeUndefined();
    expect(tirz.uk_product_id).toBeUndefined();
  });

  it("always reports US approval, since every input came from FDA labelling", () => {
    expect(mergeIndicationResults(fda, new Map()).every((d) => d.us_approved)).toBe(true);
  });
});
