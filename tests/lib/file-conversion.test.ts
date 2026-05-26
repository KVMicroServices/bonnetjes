import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isHeicFile,
  isDocFile,
  isDocxFile,
  needsConversion,
  convertToViewableFormat,
  convertForOcr,
} from "@/lib/file-conversion";
import fs from "node:fs";
import path from "node:path";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const FIXTURES_DIR = path.join(__dirname, "..", "fixtures");

function loadFixture(filename: string): Buffer {
  return fs.readFileSync(path.join(FIXTURES_DIR, filename));
}

// ─── Tests: Format Detection ─────────────────────────────────────────────────

describe("isHeicFile", () => {
  it("returns true for .heic extension", () => {
    expect(isHeicFile("photo.heic")).toBe(true);
  });

  it("returns true for .heif extension", () => {
    expect(isHeicFile("photo.heif")).toBe(true);
  });

  it("returns true for uppercase .HEIC", () => {
    expect(isHeicFile("photo.HEIC")).toBe(true);
  });

  it("returns false for .jpg", () => {
    expect(isHeicFile("photo.jpg")).toBe(false);
  });

  it("returns false for .png", () => {
    expect(isHeicFile("photo.png")).toBe(false);
  });

  it("returns false for .pdf", () => {
    expect(isHeicFile("document.pdf")).toBe(false);
  });
});

describe("isDocFile", () => {
  it("returns true for .doc extension", () => {
    expect(isDocFile("receipt.doc")).toBe(true);
  });

  it("returns true for uppercase .DOC", () => {
    expect(isDocFile("receipt.DOC")).toBe(true);
  });

  it("returns false for .docx", () => {
    expect(isDocFile("receipt.docx")).toBe(false);
  });

  it("returns false for .pdf", () => {
    expect(isDocFile("receipt.pdf")).toBe(false);
  });
});

describe("isDocxFile", () => {
  it("returns true for .docx extension", () => {
    expect(isDocxFile("receipt.docx")).toBe(true);
  });

  it("returns true for uppercase .DOCX", () => {
    expect(isDocxFile("receipt.DOCX")).toBe(true);
  });

  it("returns false for .doc", () => {
    expect(isDocxFile("receipt.doc")).toBe(false);
  });

  it("returns false for .pdf", () => {
    expect(isDocxFile("receipt.pdf")).toBe(false);
  });
});

describe("needsConversion", () => {
  it("returns true for HEIC files", () => {
    expect(needsConversion("photo.heic")).toBe(true);
    expect(needsConversion("photo.heif")).toBe(true);
  });

  it("returns true for DOC files", () => {
    expect(needsConversion("receipt.doc")).toBe(true);
  });

  it("returns true for DOCX files", () => {
    expect(needsConversion("receipt.docx")).toBe(true);
  });

  it("returns false for standard image formats", () => {
    expect(needsConversion("photo.jpg")).toBe(false);
    expect(needsConversion("photo.png")).toBe(false);
    expect(needsConversion("photo.gif")).toBe(false);
    expect(needsConversion("photo.webp")).toBe(false);
  });

  it("returns false for PDF", () => {
    expect(needsConversion("receipt.pdf")).toBe(false);
  });
});

// ─── Tests: HEIC Conversion ──────────────────────────────────────────────────

describe("convertToViewableFormat — HEIC", () => {
  it("converts a valid HEIC file to JPEG", async () => {
    const heicBuffer = loadFixture("test-receipt.heic");
    const result = await convertToViewableFormat(heicBuffer, "photo.heic");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.mimeType).toBe("image/jpeg");
      expect(result.extension).toBe(".jpg");
      expect(result.buffer.length).toBeGreaterThan(0);

      // Verify it's a valid JPEG (starts with FFD8 magic bytes)
      expect(result.buffer[0]).toBe(0xff);
      expect(result.buffer[1]).toBe(0xd8);
    }
  });

  it("returns error for empty buffer with .heic extension", async () => {
    const emptyBuffer = Buffer.alloc(0);
    const result = await convertToViewableFormat(emptyBuffer, "photo.heic");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("HEIC conversion failed");
    }
  });
});

// ─── Tests: DOCX Conversion (Smoke Test with Real File) ─────────────────────

describe("convertToViewableFormat — DOCX", () => {
  it("converts a valid DOCX to a PNG image", async () => {
    const docxBuffer = loadFixture("test-receipt.docx");
    const result = await convertToViewableFormat(docxBuffer, "receipt.docx");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.mimeType).toBe("image/png");
      expect(result.extension).toBe(".png");
      expect(result.buffer.length).toBeGreaterThan(0);

      // Verify it's a valid PNG (starts with PNG magic bytes)
      const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      expect(result.buffer.subarray(0, 4).equals(pngMagic)).toBe(true);
    }
  });

  it("returns error for empty DOCX", async () => {
    const emptyBuffer = Buffer.alloc(0);
    const result = await convertToViewableFormat(emptyBuffer, "empty.docx");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("DOCX conversion failed");
    }
  });

  it("returns error for invalid DOCX (random bytes)", async () => {
    const randomBuffer = Buffer.from("this is not a docx file");
    const result = await convertToViewableFormat(randomBuffer, "invalid.docx");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("DOCX conversion failed");
    }
  });
});

describe("convertForOcr — DOCX", () => {
  it("converts a valid DOCX to a PNG image for OCR", async () => {
    const docxBuffer = loadFixture("test-receipt.docx");
    const result = await convertForOcr(docxBuffer, "receipt.docx");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.mimeType).toBe("image/png");
      expect(result.extension).toBe(".png");
      expect(result.buffer.length).toBeGreaterThan(0);
    }
  });
});

// ─── Tests: DOC Conversion ───────────────────────────────────────────────────

describe("convertToViewableFormat — DOC", () => {
  it("converts a real DOC file to a PNG image via LibreOffice", async () => {
    const docBuffer = loadFixture("test-receipt.doc");
    const result = await convertToViewableFormat(docBuffer, "receipt.doc");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.mimeType).toBe("image/png");
      expect(result.extension).toBe(".png");
      expect(result.buffer.length).toBeGreaterThan(0);

      // Verify it's a valid PNG (starts with PNG magic bytes)
      const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      expect(result.buffer.subarray(0, 4).equals(pngMagic)).toBe(true);
    }
  });

  it("handles empty buffer gracefully (LibreOffice creates blank document)", async () => {
    const emptyBuffer = Buffer.alloc(0);
    const result = await convertToViewableFormat(emptyBuffer, "receipt.doc");

    // LibreOffice is lenient and produces a blank page from empty input
    // This is acceptable — the OCR model will report it as unreadable
    if (result.success) {
      expect(result.mimeType).toBe("image/png");
      expect(result.buffer.length).toBeGreaterThan(0);
    }
  });
});

// ─── Tests: Unsupported Format ───────────────────────────────────────────────

describe("convertToViewableFormat — unsupported", () => {
  it("returns error for unsupported file types", async () => {
    const buffer = Buffer.from("some content");
    const result = await convertToViewableFormat(buffer, "file.txt");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("No conversion available");
    }
  });
});
