import { describe, expect, it } from "vitest";
// @vitest-environment jsdom
import { bindItemPicker, renderExplorer } from "./renderExplorer";
import type { AgencyItemRecord, ItemTaxonomyMembershipRecord, SearchQuery, SpecSectionRecord, StateConfig } from "../data/schema";

const item = { agencyItemId: "ne:200", state: "NE", agencyId: "ne_ndot", agencyName: "NDOT", itemCode: "200", currentVersionId: "v1", itemStatus: "current", canonicalItemId: "", officialDescription: "Explicit section item", officialAbbreviatedDescription: "", officialUnit: "EA", specReferenceCode: "", agency: "NDOT" } satisfies AgencyItemRecord;
const section = { taxonomyId: "section:999", state: "NE", agencyId: "ne_ndot", taxonomyLevel: "section", taxonomyCode: "999", parentTaxonomyId: "division:9", taxonomyLabel: "Explicit section", matchPrefix: "", sourceYear: 2017, sourceUrl: "", sectionPrefix: "999", divisionPrefix: "9", divisionTitle: "Division 9", sectionTitle: "Explicit section" } satisfies SpecSectionRecord;
const query = { state: "NE", agencyId: "ne_ndot", agencyItemId: "", countyRegion: "", workType: "", estimateYear: 2026, sourceScope: "both", priceTypeScope: "awarded", itemCode: "", description: "", unit: "", quantity: null } satisfies SearchQuery;
const config = { code: "NE", name: "Nebraska", defaultAgencyId: "ne_ndot", defaultAgencyName: "NDOT", divisionLabel: "Division", sectionLabel: "Section", sectionPrefixLength: 3, capabilities: { districtFilter: false, engineerEstimate: false, bidderDetail: false, periodPriceHistory: true }, sourceTypeLabels: {}, itemCodeSeries: [{ value: "2", label: "2000–2999", prefixes: ["2"] }, { value: "7", label: "7000–7999", prefixes: ["7"] }], files: { sources: "", lettings: "", contracts: "", contractProjects: "", contractItems: "", bids: "", agencyItems: "", agencyItemVersions: "", itemTaxonomy: "", itemTaxonomyMemberships: "memberships.csv", itemMappings: "", observations: "" } } satisfies StateConfig;

describe("renderExplorer", () => {
  it("uses an explicit membership instead of the item-code prefix", () => {
    const memberships = new Map<string, ItemTaxonomyMembershipRecord[]>([[item.agencyItemId, [{ membershipId: "m", state: "NE", agencyId: "ne_ndot", agencyItemId: item.agencyItemId, taxonomyId: section.taxonomyId, sourceId: "s", matchStatus: "catalog_exact", notes: "" }]]]);
    const html = renderExplorer({ ...query, agencyItemId: item.agencyItemId, itemCode: item.itemCode }, [item], [section], config, memberships);
    expect(html).toContain("Explicit section item");
    expect(html).toContain('value="999" selected');
  });

  it("filters independently by configured item code series", () => {
    const sevenItem = { ...item, agencyItemId: "ne:7000", itemCode: "7000.01", officialDescription: "Seven series item" };
    const container = document.createElement("div");
    container.innerHTML = renderExplorer(query, [item, sevenItem], [section], config);
    const form = container.querySelector<HTMLFormElement>("#explorer-form");
    if (!form) throw new Error("Explorer form was not rendered");
    bindItemPicker(form, [item, sevenItem], [section], config);
    const seriesSelect = form.querySelector<HTMLSelectElement>("[data-item-code-series-select]");
    if (!seriesSelect) throw new Error("Item code series select was not rendered");
    seriesSelect.value = "7";
    seriesSelect.dispatchEvent(new Event("change"));
    expect(form.querySelector("[data-item-results]")?.textContent).toContain("Seven series item");
    expect(form.querySelector("[data-item-results]")?.textContent).not.toContain("Explicit section item");
  });

  it("keeps Division-dependent pickers disabled until a Division is selected", () => {
    const container = document.createElement("div");
    container.innerHTML = renderExplorer(query, [item], [section], config);
    expect(container.querySelector("[data-division-select]")).not.toBeNull();
    expect(container.querySelector<HTMLSelectElement>("[data-section-select]")?.disabled).toBe(true);
  });

  it("hides Nebraska annual-report catalog-provenance labels while retaining them by default elsewhere", () => {
    const historicalItem = { ...item, itemStatus: "historical" } satisfies AgencyItemRecord;
    const defaultHtml = renderExplorer({ ...query, description: "Explicit" }, [historicalItem], [section], config);
    const neHtml = renderExplorer(
      { ...query, description: "Explicit" },
      [historicalItem],
      [section],
      { ...config, showHistoricalItemStatus: false }
    );

    expect(defaultHtml).toContain("Historical");
    expect(neHtml).not.toContain("Historical");
    expect(neHtml).toContain("Explicit section item");
  });

  it("renders South Dakota as a flat Division / Bid Item Group picker", () => {
    const sdConfig = {
      ...config,
      code: "SD",
      name: "South Dakota",
      defaultAgencyId: "sd_sddot",
      defaultAgencyName: "SDDOT",
      sectionLabel: "Division / Bid Item Group",
      sectionPickerMode: "independent-flat",
      itemCodeSeries: undefined,
      files: { ...config.files, itemTaxonomyMemberships: undefined }
    } satisfies StateConfig;
    const trafficGroup = { ...section, state: "SD", agencyId: "sd_sddot", taxonomyId: "sd:004", taxonomyCode: "004", sectionPrefix: "004", divisionPrefix: "I", divisionTitle: "Division I", sectionTitle: "Traffic Diversions" } satisfies SpecSectionRecord;
    const pipeGroup = { ...section, state: "SD", agencyId: "sd_sddot", taxonomyId: "sd:450", taxonomyCode: "450", sectionPrefix: "450", divisionPrefix: "II", divisionTitle: "Division II", sectionTitle: "Pipe Culverts" } satisfies SpecSectionRecord;
    const trafficItem = { ...item, state: "SD", agencyId: "sd_sddot", agencyItemId: "sd:004", itemCode: "004E0010", officialDescription: "Traffic diversion" };
    const pipeItem = { ...item, state: "SD", agencyId: "sd_sddot", agencyItemId: "sd:450", itemCode: "450E0010", officialDescription: "Pipe culvert" };
    const container = document.createElement("div");
    container.innerHTML = renderExplorer(query, [trafficItem, pipeItem], [trafficGroup, pipeGroup], sdConfig);
    const form = container.querySelector<HTMLFormElement>("#explorer-form");
    if (!form) throw new Error("Explorer form was not rendered");
    bindItemPicker(form, [trafficItem, pipeItem], [trafficGroup, pipeGroup], sdConfig);

    const sectionSelect = form.querySelector<HTMLSelectElement>("[data-section-select]");
    if (!sectionSelect) throw new Error("Section select was not rendered");
    expect(form.querySelector("[data-division-select]")).toBeNull();
    expect(sectionSelect.disabled).toBe(false);
    expect(sectionSelect.innerHTML).toContain("I - 004 - Traffic Diversions");
    expect(sectionSelect.innerHTML).toContain("II - 450 - Pipe Culverts");
    expect(sectionSelect.innerHTML).not.toContain("optgroup");

    sectionSelect.value = "450";
    sectionSelect.dispatchEvent(new Event("change"));
    expect(form.querySelector("[data-item-results]")?.textContent).toContain("Pipe culvert");
    expect(form.querySelector("[data-item-results]")?.textContent).not.toContain("Traffic diversion");
  });
});
