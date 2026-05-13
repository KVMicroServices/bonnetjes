import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateUploadUrl,
} from "@/lib/services/upload-service";
import type {
  StorageClient,
  UploadServiceDependencies,
} from "@/lib/services/upload-service";

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

// ─── Tests: generateUploadUrl — allowed types ──────────────────────────────────

describe("generateUploadUrl", () => {
  let dependencies: UploadServiceDependencies;

  beforeEach(() => {
    dependencies = createMockDependencies();
  });

  it("succeeds for image/jpeg", async () => {
    const result = await generateUploadUrl(dependencies, "photo.jpg", "image/jpeg", false);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.uploadUrl).toBe("https://storage.example.com/presigned-upload");
      expect(result.data.cloudStoragePath).toBe("uploads/test-file.jpg");
    }
  });

  it("succeeds for image/png", async () => {
    const result = await generateUploadUrl(dependencies, "photo.png", "image/png", false);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.uploadUrl).toBe("https://storage.example.com/presigned-upload");
    }
  });

  it("succeeds for image/gif", async () => {
    const result = await generateUploadUrl(dependencies, "animation.gif", "image/gif", true);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.uploadUrl).toBe("https://storage.example.com/presigned-upload");
    }
  });

  it("succeeds for image/webp", async () => {
    const result = await generateUploadUrl(dependencies, "image.webp", "image/webp", false);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.uploadUrl).toBe("https://storage.example.com/presigned-upload");
    }
  });

  it("succeeds for application/pdf", async () => {
    const result = await generateUploadUrl(dependencies, "receipt.pdf", "application/pdf", false);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.uploadUrl).toBe("https://storage.example.com/presigned-upload");
    }
  });

  // ─── Disallowed types ──────────────────────────────────────────────────────────

  it("rejects text/plain", async () => {
    const result = await generateUploadUrl(dependencies, "notes.txt", "text/plain", false);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("File type not allowed");
    }
  });

  it("rejects application/json", async () => {
    const result = await generateUploadUrl(dependencies, "data.json", "application/json", false);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("File type not allowed");
    }
  });

  it("rejects text/html", async () => {
    const result = await generateUploadUrl(dependencies, "page.html", "text/html", false);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("File type not allowed");
    }
  });

  it("does not call storage client for disallowed types", async () => {
    await generateUploadUrl(dependencies, "file.txt", "text/plain", false);

    expect(dependencies.storage.generatePresignedUploadUrl).not.toHaveBeenCalled();
  });

  // ─── Correct parameters passed to storage ──────────────────────────────────────

  it("passes fileName, contentType, and isPublic to storage client", async () => {
    await generateUploadUrl(dependencies, "receipt.jpg", "image/jpeg", true);

    expect(dependencies.storage.generatePresignedUploadUrl).toHaveBeenCalledWith(
      "receipt.jpg",
      "image/jpeg",
      true
    );
  });

  it("passes isPublic=false to storage client when not public", async () => {
    await generateUploadUrl(dependencies, "private.png", "image/png", false);

    expect(dependencies.storage.generatePresignedUploadUrl).toHaveBeenCalledWith(
      "private.png",
      "image/png",
      false
    );
  });
});
