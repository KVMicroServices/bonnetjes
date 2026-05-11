import { vi, beforeEach } from "vitest";

export interface MockS3Functions {
  generatePresignedUploadUrl: ReturnType<typeof vi.fn>;
  initiateMultipartUpload: ReturnType<typeof vi.fn>;
  getPresignedUrlForPart: ReturnType<typeof vi.fn>;
  completeMultipartUpload: ReturnType<typeof vi.fn>;
  getFileUrl: ReturnType<typeof vi.fn>;
  deleteFile: ReturnType<typeof vi.fn>;
  getFileAsBuffer: ReturnType<typeof vi.fn>;
}

export const mockS3Functions: MockS3Functions = {
  generatePresignedUploadUrl: vi.fn(),
  initiateMultipartUpload: vi.fn(),
  getPresignedUrlForPart: vi.fn(),
  completeMultipartUpload: vi.fn(),
  getFileUrl: vi.fn(),
  deleteFile: vi.fn(),
  getFileAsBuffer: vi.fn(),
};

/**
 * Sets up the S3 mock for the current test file.
 * Returns mock functions with sensible defaults:
 * - generatePresignedUploadUrl returns a fake upload URL and storage path
 * - getFileUrl returns a fake signed download URL
 * - getFileAsBuffer returns an empty buffer
 * - deleteFile resolves successfully
 */
export function setupS3Mock(): MockS3Functions {
  vi.mock("@/lib/s3", () => ({
    generatePresignedUploadUrl: mockS3Functions.generatePresignedUploadUrl,
    initiateMultipartUpload: mockS3Functions.initiateMultipartUpload,
    getPresignedUrlForPart: mockS3Functions.getPresignedUrlForPart,
    completeMultipartUpload: mockS3Functions.completeMultipartUpload,
    getFileUrl: mockS3Functions.getFileUrl,
    deleteFile: mockS3Functions.deleteFile,
    getFileAsBuffer: mockS3Functions.getFileAsBuffer,
  }));

  beforeEach(() => {
    vi.clearAllMocks();

    mockS3Functions.generatePresignedUploadUrl.mockResolvedValue({
      uploadUrl: "https://fake-s3.example.com/upload?signed=true",
      cloud_storage_path: "uploads/1234567890-test-file.jpg",
    });

    mockS3Functions.initiateMultipartUpload.mockResolvedValue({
      uploadId: "fake-upload-id",
      cloud_storage_path: "uploads/1234567890-test-file.jpg",
    });

    mockS3Functions.getPresignedUrlForPart.mockResolvedValue(
      "https://fake-s3.example.com/part?signed=true"
    );

    mockS3Functions.completeMultipartUpload.mockResolvedValue(undefined);

    mockS3Functions.getFileUrl.mockResolvedValue(
      "https://fake-s3.example.com/download?signed=true"
    );

    mockS3Functions.deleteFile.mockResolvedValue(undefined);

    mockS3Functions.getFileAsBuffer.mockResolvedValue(Buffer.from("fake-file-content"));
  });

  return mockS3Functions;
}
