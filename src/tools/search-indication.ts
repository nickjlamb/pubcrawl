import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchByIndication } from "../lib/dailymed.js";
import { searchEmc } from "../lib/emc.js";
import { DrugApprovalEntry, IndicationSearchResult } from "../types.js";

function normalizeDrugName(title: string): string {
  // Strip formulation info, manufacturer, dosage forms
  // E.g., "METFORMIN HYDROCHLORIDE tablet - TEVA PHARMACEUTICALS USA" → "metformin"
  let name = title.toLowerCase();

  // Remove everything after " - " (manufacturer)
  const dashIdx = name.indexOf(" - ");
  if (dashIdx > 0) name = name.substring(0, dashIdx);

  // Remove dosage form keywords
  const dosageForms = [
    "tablet", "capsule", "injection", "solution", "suspension", "cream",
    "ointment", "gel", "patch", "inhaler", "spray", "drops", "syrup",
    "powder", "suppository", "extended-release", "delayed-release",
    "oral", "topical", "intravenous", "subcutaneous", "intramuscular",
  ];
  for (const form of dosageForms) {
    name = name.replace(new RegExp(`\\b${form}s?\\b`, "g"), "");
  }

  // Remove salt forms
  const salts = ["hydrochloride", "sodium", "potassium", "mesylate", "fumarate", "succinate", "tartrate", "maleate", "besylate", "calcium"];
  for (const salt of salts) {
    name = name.replace(new RegExp(`\\b${salt}\\b`, "g"), "");
  }

  // Clean up
  return name.replace(/[,()]/g, "").replace(/\s+/g, " ").trim();
}

const schema = {
  condition: z.string().describe("Medical condition or indication to search for (e.g., 'type 2 diabetes', 'hypertension')"),
  maxResults: z.number().min(1).max(50).default(10).describe("Maximum number of drug results to return"),
};

export function registerSearchIndicationTool(server: McpServer): void {
  server.tool(
    "search_by_indication",
    "Find drugs approved for a medical condition in both US (DailyMed/FDA) and UK (eMC/MHRA) databases. Returns merged results showing which drugs are approved in each market.",
    schema,
    async (params) => {
      try {
        // Search both databases in parallel
        const [usResult, ukResult] = await Promise.allSettled([
          searchByIndication(params.condition, params.maxResults),
          searchEmc(params.condition),
        ]);

        const usResults = usResult.status === "fulfilled" ? usResult.value : [];
        const ukResults = ukResult.status === "fulfilled" ? ukResult.value : [];

        if (usResults.length === 0 && ukResults.length === 0) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: `No drugs found for "${params.condition}" in US or UK databases`,
              }, null, 2),
            }],
            isError: true,
          };
        }

        // Merge by normalized drug name
        const drugMap = new Map<string, DrugApprovalEntry>();

        for (const us of usResults) {
          const normalized = normalizeDrugName(us.title);
          if (!normalized) continue;

          const existing = drugMap.get(normalized);
          if (existing) {
            existing.us_approved = true;
            if (!existing.us_setid) existing.us_setid = us.setid;
          } else {
            drugMap.set(normalized, {
              name: normalized,
              us_approved: true,
              uk_approved: false,
              us_setid: us.setid,
            });
          }
        }

        for (const uk of ukResults) {
          const normalized = normalizeDrugName(uk.name);
          if (!normalized) continue;

          const existing = drugMap.get(normalized);
          if (existing) {
            existing.uk_approved = true;
            if (!existing.uk_product_id) existing.uk_product_id = uk.product_id;
          } else {
            drugMap.set(normalized, {
              name: normalized,
              us_approved: false,
              uk_approved: true,
              uk_product_id: uk.product_id,
            });
          }
        }

        const drugs = [...drugMap.values()]
          .sort((a, b) => {
            // Prefer drugs approved in both markets
            const aScore = (a.us_approved ? 1 : 0) + (a.uk_approved ? 1 : 0);
            const bScore = (b.us_approved ? 1 : 0) + (b.uk_approved ? 1 : 0);
            return bScore - aScore;
          })
          .slice(0, params.maxResults);

        const result: IndicationSearchResult = {
          condition: params.condition,
          drugs,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error searching by indication: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
