import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateUploadUrl } from "@/lib/services/upload-service";
import type { UploadServiceDependencies } from "@/lib/services/upload-service";

// ─── Mock Factories ────────────────────────────────────────────────────────────

function createMockDependencies(): UploadServiceDependencies {
  return {
    storage: {
      generatePresignedUploadUrl: vi.fn().mockResolvedValue({
        uploadUrl: "https://storage.example.com/presigned-upload",
        cloud_storage_path: "uploads/test-file.jpg",
      }),
    },
  };
}

// ─── Tests: New Format Support ─────────────────────────────────────────────────

describe("generateUploadUrl — HEIC/DOC/DOCX support", () => {
  let dependencies: UploadServiceDependencies;

  beforeEach(() => {
    dependencies = createMockDependencies();
  });

  it("succeeds for image/heic", async () => {
    const result = await generateUploadUrl(dependencies, "photo.heic", "image/heic", false);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.uploadUrl).toBe("https://storage.example.com/presigned-upload");
    }
  });

  it("succeeds for image/heif", async () => {
    const result = await generateUploadUrl(dependencies, "photo.heif", "image/heif", false);

    expect(result.success).toBe(true);
  });

  it("succeeds for application/msword (DOC)", async () => {
    const result = await generateUploadUrl(dependencies, "receipt.doc", "application/msword", false);

    expect(result.success).toBe(true);
  });

  it("succeeds for DOCX content type", async () => {
    const result = await generateUploadUrl(
      dependencies,
      "receipt.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      false
    );

    expect(result.success).toBe(true);
  });

  // ─── Octet-stream fallback (browsers misreporting HEIC) ─────────────────────

  it("accepts application/octet-stream when file extension is .heic", async () => {
    const result = await generateUploadUrl(
      dependencies,
      "IMG_1234.heic",
      "application/octet-stream",
      false
    );

    expect(result.success).toBe(true);
  });

  it("accepts application/octet-stream when file extension is .heif", async () => {
    const result = await generateUploadUrl(
      dependencies,
      "photo.heif",
      "application/octet-stream",
      false
    );

    expect(result.success).toBe(true);
  });

  it("accepts application/octet-stream when file extension is .doc", async () => {
    const result = await generateUploadUrl(
      dependencies,
      "receipt.doc",
      "application/octet-stream",
      false
    );

    expect(result.success).toBe(true);
  });

  it("accepts application/octet-stream when file extension is .docx", async () => {
    const result = await generateUploadUrl(
      dependencies,
      "receipt.docx",
      "application/octet-stream",
      false
    );

    expect(result.success).toBe(true);
  });

  it("rejects application/octet-stream when file extension is unknown", async () => {
    const result = await generateUploadUrl(
      dependencies,
      "file.xyz",
      "application/octet-stream",
      false
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("File type not allowed");
    }
  });

  it("resolves correct content type for HEIC when browser sends octet-stream", async () => {
    await generateUploadUrl(dependencies, "photo.heic", "application/octet-stream", false);

    expect(dependencies.storage.generatePresignedUploadUrl).toHaveBeenCalledWith(
      "photo.heic",
      "image/heic",
      false
    );
  });

  it("resolves correct content type for DOCX when browser sends octet-stream", async () => {
    await generateUploadUrl(dependencies, "receipt.docx", "application/octet-stream", false);

    expect(dependencies.storage.generatePresignedUploadUrl).toHaveBeenCalledWith(
      "receipt.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      false
    );
  });

  // ─── Still rejects truly unsupported types ──────────────────────────────────

  it("still rejects text/plain", async () => {
    const result = await generateUploadUrl(dependencies, "notes.txt", "text/plain", false);

    expect(result.success).toBe(false);
  });

  it("still rejects application/zip", async () => {
    const result = await generateUploadUrl(dependencies, "archive.zip", "application/zip", false);

    expect(result.success).toBe(false);
  });
});
