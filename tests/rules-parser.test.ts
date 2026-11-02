import { describe, expect, it } from "vitest";
import { extractConstraints, extractNamingPattern, lastQualifier, parseRequirementsText } from "@/lib/engine/rules-parser";
import { SAMPLES } from "@/lib/samples";

const sample = (id: string) => SAMPLES.find((s) => s.id === id)!.text;
const byLabel = (spec: ReturnType<typeof parseRequirementsText>, re: RegExp) => spec.documents.find((d) => re.test(d.label))!;

describe("qualifiers", () => {
  it("prefers the closest qualifier", () => {
    expect(lastQualifier("no more than ")).toBe("max");
    expect(lastQualifier("no less than ")).toBe("min");
    expect(lastQualifier("must not exceed ")).toBe("max");
    expect(lastQualifier("at least ")).toBe("min");
    expect(lastQualifier("files ")).toBeNull();
  });
});

describe("extractConstraints", () => {
  it("reads size ranges with a shared unit", () => {
    const ex = extractConstraints("Scanned signature: JPG or PNG, 10–50 KB, black and white.");
    expect(ex.minBytes).toBe(10240);
    expect(ex.maxBytes).toBe(50000);
    expect(ex.formats).toEqual(["jpg", "png"]);
    expect(ex.colorMode).toBe("grayscale");
  });

  it("reads pixel box ranges and square ratio", () => {
    const ex = extractConstraints("JPG only, square, between 600 x 600 and 1200 x 1200 pixels, maximum 240 KB.");
    expect(ex.minWidth).toBe(600);
    expect(ex.maxHeight).toBe(1200);
    expect(ex.maxBytes).toBe(240000);
    expect(ex.aspectRatio).toBe(1);
  });

  it("treats a bare pixel box as exact", () => {
    const ex = extractConstraints("Dimensions: 600 x 600 pixels (square)");
    expect(ex.exactWidth).toBe(600);
    expect(ex.exactHeight).toBe(600);
  });

  it("reads print sizes and DPI", () => {
    const ex = extractConstraints("Photo 35 x 45 mm at 300 dpi");
    expect(ex.physicalWidthMm).toBe(35);
    expect(ex.physicalHeightMm).toBe(45);
    expect(ex.dpi).toBe(300);
  });

  it("separates totals from per-file limits", () => {
    const ex = extractConstraints("Each file max 2 MB, total 10 MB.");
    expect(ex.maxBytes).toBe(2_000_000);
    expect(ex.totalMaxBytes).toBe(10_000_000);
  });

  it("reads French limits", () => {
    const ex = extractConstraints("au format PDF uniquement, 5 Mo maximum par fichier");
    expect(ex.formats).toEqual(["pdf"]);
    expect(ex.maxBytes).toBe(5_000_000);
  });

  it("reads page limits", () => {
    expect(extractConstraints("PDF, maximum 2 pages, under 2 MB.").maxPages).toBe(2);
    expect(extractConstraints("Single PDF, up to 4 MB, maximum 10 pages").maxPages).toBe(10);
    expect(extractConstraints("One-page summary").maxPages).toBe(1);
  });

  it("does not read durations as sizes", () => {
    const ex = extractConstraints("Justificatif de domicile de moins de 3 mois");
    expect(ex.maxBytes).toBeUndefined();
    expect(ex.notes.length).toBe(1);
  });
});

describe("naming patterns", () => {
  it("converts placeholders to tokens", () => {
    expect(extractNamingPattern("Name each file LASTNAME_Firstname_Document (no spaces).")).toBe("{LASTNAME}_{Firstname}_{Doc}");
    expect(extractNamingPattern("Please name files as Surname-FirstName-DocumentType.pdf")).toBe("{Lastname}-{Firstname}-{Doc}");
  });
});

describe("parseRequirementsText", () => {
  it("parses the university sample", () => {
    const spec = parseRequirementsText(sample("university"));
    expect(spec.title).toMatch(/Northbridge/);
    expect(spec.documents).toHaveLength(6);

    const photo = byLabel(spec, /photo/i);
    expect(photo.kind).toBe("photo");
    expect(photo.acceptedFormats).toEqual(["jpg"]);
    expect(photo.maxBytes).toBe(240_000);
    expect(photo.minWidth).toBe(600);
    expect(photo.maxWidth).toBe(1200);
    expect(photo.aspectRatio).toBe(1);
    expect(photo.background).toBe("white");

    const signature = byLabel(spec, /signature/i);
    expect(signature.minBytes).toBe(10_240);
    expect(signature.maxBytes).toBe(50_000);
    expect(signature.colorMode).toBe("grayscale");

    const cv = byLabel(spec, /CV/);
    expect(cv.acceptedFormats).toEqual(["pdf"]);
    expect(cv.maxPages).toBe(2);
    expect(cv.maxBytes).toBe(2_000_000);

    const transcripts = byLabel(spec, /transcripts/i);
    expect(transcripts.combine).toBe("merge");
    expect(transcripts.maxBytes).toBe(5_000_000);

    const passport = byLabel(spec, /copy of passport/i);
    expect(passport.kind).toBe("id-document");
    expect(passport.acceptedFormats).toEqual(["pdf", "jpg"]);
    expect(passport.colorMode).toBe("color");

    expect(spec.totalMaxBytes).toBe(15_000_000);
    expect(spec.naming.pattern).toBe("{LASTNAME}_{Firstname}_{Doc}");
    expect(spec.naming.allowSpaces).toBe(false);
  });

  it("parses the French rental sample with global rules", () => {
    const spec = parseRequirementsText(sample("rental"));
    expect(spec.title).toMatch(/Dossier de location/);
    expect(spec.documents).toHaveLength(5);
    for (const d of spec.documents) {
      expect(d.acceptedFormats).toEqual(["pdf"]);
      expect(d.maxBytes).toBe(5_000_000);
    }
    expect(byLabel(spec, /identit/i).combine).toBe("merge");
    const address = byLabel(spec, /domicile/i);
    expect(address.label).toBe("Justificatif de domicile");
    expect(address.notes[0]).toMatch(/moins de 3 mois/);
    expect(byLabel(spec, /bulletins/i).combine).toBe("merge");
    expect(spec.totalMaxBytes).toBe(20_000_000);
  });

  it("parses the job sample with pass-through formats and optional items", () => {
    const spec = parseRequirementsText(sample("job"));
    const cv = byLabel(spec, /^CV$/);
    expect(cv.acceptedFormats).toEqual(["pdf"]);
    expect(cv.passThroughFormats).toEqual(["docx"]);
    expect(cv.maxBytes).toBe(5_000_000);
    const portfolio = byLabel(spec, /portfolio/i);
    expect(portfolio.required).toBe(false);
    expect(portfolio.maxBytes).toBe(10_000_000);
    const picture = byLabel(spec, /picture/i);
    expect(picture.required).toBe(false);
    expect(picture.minWidth).toBe(400);
    expect(picture.aspectRatio).toBe(1);
  });

  it("parses the visa sample with heading blocks", () => {
    const spec = parseRequirementsText(sample("visa"));
    const photo = byLabel(spec, /photograph/i);
    expect(photo.exactWidth).toBe(600);
    expect(photo.minBytes).toBe(55_296);
    expect(photo.maxBytes).toBe(240_000);
    expect(photo.background).toBe("light");
    const passport = byLabel(spec, /passport/i);
    expect(passport.dpi).toBe(300);
    expect(passport.maxBytes).toBe(1_000_000);
    const funds = byLabel(spec, /funds|bank/i);
    expect(funds.maxPages).toBe(10);
    expect(funds.combine).toBe("merge");
    expect(funds.maxBytes).toBe(4_000_000);
  });
});
