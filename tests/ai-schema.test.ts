import { describe, expect, it } from "vitest";
import { toPacketSpec } from "@/lib/ai/schema";

describe("AI extraction → PacketSpec", () => {
  it("converts units deterministically and derives pixel sizes", () => {
    const spec = toPacketSpec(
      {
        title: "Visa application",
        documents: [
          {
            label: "Photo",
            kind: "photo",
            required: true,
            formats: ["jpeg"],
            maxSize: { value: 240, unit: "KB" },
            minSize: { value: 54, unit: "KB" },
            printSize: { width: 2, height: 2, unit: "in" },
            dpi: 300,
            evidence: ["2 x 2 inches", "  54 KB to 240 KB "],
          },
          { label: "CV", kind: "document", required: true, formats: ["pdf", "docx"], maxSize: { value: 2, unit: "MiB" }, evidence: [] },
          { label: "", kind: "document", required: true, formats: [], evidence: [] },
          { label: "Weird", kind: "spaceship", required: "yes", formats: [], evidence: [] },
        ],
        totalMaxSize: { value: 10, unit: "MB" },
        naming: { pattern: "{LASTNAME}_{Doc}.pdf", maxLength: 3 },
        warnings: [],
      },
      "claude-test",
    );
    expect(spec.source).toBe("ai");
    expect(spec.model).toBe("claude-test");
    const [photo, cv, weird] = spec.documents;
    expect(spec.documents).toHaveLength(3); // the empty label is dropped
    expect(photo.acceptedFormats).toEqual(["jpg"]);
    expect(photo.maxBytes).toBe(240_000);
    expect(photo.minBytes).toBe(55_296);
    expect(photo.physicalWidthMm).toBeCloseTo(50.8);
    expect(photo.exactWidth).toBe(600);
    expect(photo.exactHeight).toBe(600);
    expect(photo.evidence[1]).toBe("54 KB to 240 KB");
    expect(cv.passThroughFormats).toEqual(["docx"]);
    expect(cv.maxBytes).toBe(2_097_152);
    expect(weird.kind).toBe("document");
    expect(weird.required).toBe(true);
    expect(weird.acceptedFormats).toEqual(["pdf"]);
    expect(spec.totalMaxBytes).toBe(10_000_000);
    expect(spec.naming.pattern).toBe("{LASTNAME}_{Doc}");
    expect(spec.naming.maxLength).toBe(12);
  });

  it("reports when nothing was found", () => {
    const spec = toPacketSpec({ title: "Recipe", documents: [] }, "m");
    expect(spec.documents).toHaveLength(0);
    expect(spec.warnings[0]).toMatch(/No documents/);
  });
});
