import { describe, expect, it } from "vitest";
import { COLORADO_PILOT_PACKAGES } from "./coloradoPilot";
import { NEBRASKA_PILOT_PACKAGES } from "./nebraskaPilot";
import { validatePackageDefinition } from "../validateRecipes";

describe("Nebraska and Colorado pilot recipes", () => {
  it.each([
    ["NE", NEBRASKA_PILOT_PACKAGES, ["ne-resurfacing", "ne-reconstruction", "ne-path", "ne-sidewalk"]],
    ["CO", COLORADO_PILOT_PACKAGES, ["co-resurfacing", "co-reconstruction", "co-path", "co-sidewalk"]],
  ] as const)("defines four valid provisional %s packages", (_state, packages, ids) => {
    expect(packages.map((entry) => entry.packageId).sort()).toEqual([...ids].sort());
    for (const definition of packages) expect(validatePackageDefinition(definition)).toEqual([]);
  });

  it("keeps exact state-specific bindings and the historically sourced NDOT identities", () => {
    const nePath = NEBRASKA_PILOT_PACKAGES.find((entry) => entry.kind === "path")!;
    expect(nePath.components.find((entry) => entry.role === "pavement")?.binding?.agencyItemId).toBe("ne_ndot_3016.65");
    expect(nePath.components.find((entry) => entry.role === "base")?.binding?.agencyItemId).toBe("ne_ndot_8011.06");
    expect(NEBRASKA_PILOT_PACKAGES.flatMap((entry) => entry.components).filter((entry) => entry.binding).every((entry) => entry.binding?.state === "NE")).toBe(true);
    expect(COLORADO_PILOT_PACKAGES.flatMap((entry) => entry.components).filter((entry) => entry.binding).every((entry) => entry.binding?.state === "CO")).toBe(true);
  });

  it("keeps sidewalk scope to surface area and a visible required one-LS manual allowance", () => {
    for (const definition of [...NEBRASKA_PILOT_PACKAGES, ...COLORADO_PILOT_PACKAGES].filter((entry) => entry.kind === "sidewalk")) {
      expect(definition.components.map((entry) => entry.role)).toEqual(["pavement", "ramps_crossings"]);
      const ramps = definition.components.find((entry) => entry.role === "ramps_crossings")!;
      expect(ramps.required).toBe(true);
      expect(ramps.binding).toBeNull();
      expect(ramps.quantityRule).toEqual({ kind: "fixed", value: 1, unit: "LS" });
      expect(definition.components.some((entry) => entry.role === "base" || entry.role === "excavation")).toBe(false);
    }
  });

  it("keeps removal area and tack as required fixed-one manual scope", () => {
    for (const definition of [...NEBRASKA_PILOT_PACKAGES, ...COLORADO_PILOT_PACKAGES]) {
      if (definition.kind === "resurfacing") {
        const tack = definition.components.find((entry) => entry.role === "tack")!;
        expect(tack.required).toBe(true);
        expect(tack.binding).toBeNull();
        expect(tack.quantityRule).toEqual({ kind: "fixed", value: 1, unit: "LS" });
      }
      if (definition.kind === "reconstruction") {
        const removal = definition.components.find((entry) => entry.role === "removal")!;
        expect(removal.required).toBe(true);
        expect(removal.binding).toBeNull();
        expect(removal.quantityRule).toEqual({ kind: "area", length: "lengthMiles", width: "widthFt", unit: "SY" });
      }
    }
  });

  it("uses the frozen CO cubic-yard base quantity and exposes the milling depth assumption", () => {
    const coPath = COLORADO_PILOT_PACKAGES.find((entry) => entry.kind === "path")!;
    expect(coPath.components.find((entry) => entry.role === "base")?.quantityRule).toEqual({ kind: "volume", length: "lengthMiles", width: "widthFt", depth: "baseDepthIn", unit: "CY" });
    for (const definitions of [NEBRASKA_PILOT_PACKAGES, COLORADO_PILOT_PACKAGES]) {
      const resurfacing = definitions.find((entry) => entry.kind === "resurfacing")!;
      expect(resurfacing.parameters.find((entry) => entry.key === "millingDepthIn")?.defaultValue).toBe(2);
    }
  });

  it("rejects a binding whose unit or state drifts from its recipe", () => {
    const source = COLORADO_PILOT_PACKAGES.find((entry) => entry.kind === "path")!;
    const wrongUnit = structuredClone(source);
    wrongUnit.components[0].binding!.unit = "CY";
    expect(validatePackageDefinition(wrongUnit).some((entry) => entry.code === "unit_mismatch")).toBe(true);

    const wrongState = structuredClone(source);
    wrongState.components[0].binding!.state = "NE";
    expect(validatePackageDefinition(wrongState).some((entry) => entry.code === "state_mismatch")).toBe(true);
  });
});
