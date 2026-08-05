import { describe, expect, it } from "vitest";
import { renderExplorer } from "./renderExplorer";
import type { AgencyItemRecord, ItemTaxonomyMembershipRecord, SearchQuery, SpecSectionRecord, StateConfig } from "../data/schema";

const item = { agencyItemId: "ne:200", state: "NE", agencyId: "ne_ndot", agencyName: "NDOT", itemCode: "200", currentVersionId: "v1", itemStatus: "current", canonicalItemId: "", officialDescription: "Explicit section item", officialAbbreviatedDescription: "", officialUnit: "EA", specReferenceCode: "", agency: "NDOT" } satisfies AgencyItemRecord;
const section = { taxonomyId: "section:999", state: "NE", agencyId: "ne_ndot", taxonomyLevel: "section", taxonomyCode: "999", parentTaxonomyId: "division:9", taxonomyLabel: "Explicit section", matchPrefix: "", sourceYear: 2017, sourceUrl: "", sectionPrefix: "999", divisionPrefix: "9", divisionTitle: "Division 9", sectionTitle: "Explicit section" } satisfies SpecSectionRecord;
const query = { state: "NE", agencyId: "ne_ndot", agencyItemId: "", countyRegion: "", workType: "", estimateYear: 2026, sourceScope: "both", priceTypeScope: "awarded", itemCode: "", description: "", unit: "", quantity: null } satisfies SearchQuery;
const config = { code: "NE", name: "Nebraska", defaultAgencyId: "ne_ndot", defaultAgencyName: "NDOT", divisionLabel: "Division", sectionLabel: "Section", sectionPrefixLength: 3, capabilities: { districtFilter: false, engineerEstimate: false, bidderDetail: false, periodPriceHistory: true }, sourceTypeLabels: {}, files: { sources: "", lettings: "", contracts: "", contractProjects: "", contractItems: "", bids: "", agencyItems: "", agencyItemVersions: "", itemTaxonomy: "", itemTaxonomyMemberships: "memberships.csv", itemMappings: "", observations: "" } } satisfies StateConfig;

describe("renderExplorer", () => {
  it("uses an explicit membership instead of the item-code prefix", () => {
    const memberships = new Map<string, ItemTaxonomyMembershipRecord[]>([[item.agencyItemId, [{ membershipId: "m", state: "NE", agencyId: "ne_ndot", agencyItemId: item.agencyItemId, taxonomyId: section.taxonomyId, sourceId: "s", matchStatus: "catalog_exact", notes: "" }]]]);
    const html = renderExplorer({ ...query, agencyItemId: item.agencyItemId, itemCode: item.itemCode }, [item], [section], config, memberships);
    expect(html).toContain("Explicit section item");
    expect(html).toContain('value="999" selected');
  });
});
