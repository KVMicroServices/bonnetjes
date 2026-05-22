import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { setupPrismaMock, createUserSession, createAdminSession } from "../helpers";

// ─── Mock Setup ────────────────────────────────────────────────────────────────

const mockPrisma = setupPrismaMock();

const mockGetServerSession = vi.fn();
vi.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/services/failure-reason-service", () => ({
  getAllFailureReasons: vi.fn(),
  createFailureReason: vi.fn(),
  updateFailureReasonDescription: vi.fn(),
  deleteFailureReason: vi.fn(),
  toggleFailureReasonEnabled: vi.fn(),
  ensureBuiltInReasonsSeeded: vi.fn(),
}));

vi.mock("@/lib/services/failure-reason-translator", () => ({
  generateDescriptionFromCode: vi.fn(),
}));

// ─── Imports (after mocks) ─────────────────────────────────────────────────────

import { GET, POST, PATCH, DELETE } from "@/app/api/admin/failure-reasons/route";
import { POST as GENERATE_POST } from "@/app/api/admin/failure-reasons/generate/route";
import {
  getAllFailureReasons,
  createFailureReason,
  updateFailureReasonDescription,
  deleteFailureReason,
  toggleFailureReasonEnabled,
} from "@/lib/services/failure-reason-service";
import { generateDescriptionFromCode } from "@/lib/services/failure-reason-translator";

// ─── Helper Functions ──────────────────────────────────────────────────────────

function createPostRequest(body: unknown): NextRequest {
  return new NextRequest(new URL("/api/admin/failure-reasons", "http://localhost:3000"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createPatchRequest(body: unknown): NextRequest {
  return new NextRequest(new URL("/api/admin/failure-reasons", "http://localhost:3000"), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createDeleteRequest(body: unknown): NextRequest {
  return new NextRequest(new URL("/api/admin/failure-reasons", "http://localhost:3000"), {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createGenerateRequest(body: unknown): NextRequest {
  return new NextRequest(new URL("/api/admin/failure-reasons/generate", "http://localhost:3000"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ─── Tests: GET /api/admin/failure-reasons ─────────────────────────────────────

describe("GET /api/admin/failure-reasons", () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 403 when user is not an admin", async () => {
    mockGetServerSession.mockResolvedValue(createUserSession());

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Admin access required");
  });

  it("returns all failure reasons for admin users", async () => {
    mockGetServerSession.mockResolvedValue(createAdminSession());

    const mockReasons = [
      { code: "NOT_A_RECEIPT", description: "Not a receipt", isBuiltIn: true, enabled: true },
      { code: "CUSTOM_ONE", description: "Custom reason", isBuiltIn: false, enabled: true },
    ];
    vi.mocked(getAllFailureReasons).mockResolvedValue(mockReasons as any);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(mockReasons);
  });
});

// ─── Tests: POST /api/admin/failure-reasons ────────────────────────────────────

describe("POST /api/admin/failure-reasons", () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createPostRequest({ code: "TEST_CODE", description: "Test" });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 403 when user is not an admin", async () => {
    mockGetServerSession.mockResolvedValue(createUserSession());

    const request = createPostRequest({ code: "TEST_CODE", description: "Test" });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Admin access required");
  });

  it("returns 400 when code is missing", async () => {
    mockGetServerSession.mockResolvedValue(createAdminSession());

    const request = createPostRequest({ description: "Test" });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("code is required");
  });

  it("returns 400 when description is missing", async () => {
    mockGetServerSession.mockResolvedValue(createAdminSession());

    const request = createPostRequest({ code: "TEST_CODE" });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("description is required");
  });

  it("returns 201 with created reason on success", async () => {
    mockGetServerSession.mockResolvedValue(createAdminSession());

    const createdReason = {
      code: "NEW_REASON",
      description: "A new reason",
      isBuiltIn: false,
      enabled: true,
    };
    vi.mocked(createFailureReason).mockResolvedValue(createdReason as any);

    const request = createPostRequest({ code: "NEW_REASON", description: "A new reason" });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.code).toBe("NEW_REASON");
    expect(vi.mocked(createFailureReason)).toHaveBeenCalledWith("NEW_REASON", "A new reason");
  });

  it("returns 400 when service throws a validation error", async () => {
    mockGetServerSession.mockResolvedValue(createAdminSession());

    vi.mocked(createFailureReason).mockRejectedValue(new Error("Code is already taken"));

    const request = createPostRequest({ code: "EXISTING", description: "Test" });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Code is already taken");
  });
});

// ─── Tests: PATCH /api/admin/failure-reasons ───────────────────────────────────

describe("PATCH /api/admin/failure-reasons", () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createPatchRequest({ code: "TEST_CODE", description: "Updated" });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 403 when user is not an admin", async () => {
    mockGetServerSession.mockResolvedValue(createUserSession());

    const request = createPatchRequest({ code: "TEST_CODE", description: "Updated" });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Admin access required");
  });

  it("returns 400 when code is missing", async () => {
    mockGetServerSession.mockResolvedValue(createAdminSession());

    const request = createPatchRequest({ description: "Updated" });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("code is required");
  });

  it("updates description successfully", async () => {
    mockGetServerSession.mockResolvedValue(createAdminSession());

    const updatedReason = {
      code: "TEST_CODE",
      description: "Updated description",
      isBuiltIn: false,
      enabled: true,
    };
    vi.mocked(updateFailureReasonDescription).mockResolvedValue(updatedReason as any);

    const request = createPatchRequest({ code: "TEST_CODE", description: "Updated description" });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.description).toBe("Updated description");
  });

  it("toggles enabled status via boolean field", async () => {
    mockGetServerSession.mockResolvedValue(createAdminSession());

    const updatedReason = {
      code: "TEST_CODE",
      description: "Test",
      isBuiltIn: false,
      enabled: false,
    };
    (toggleFailureReasonEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(updatedReason);

    const request = createPatchRequest({ code: "TEST_CODE", enabled: false });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.enabled).toBe(false);
  });
});

// ─── Tests: DELETE /api/admin/failure-reasons ───────────────────────────────────

describe("DELETE /api/admin/failure-reasons", () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createDeleteRequest({ code: "CUSTOM_REASON" });
    const response = await DELETE(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 403 when user is not an admin", async () => {
    mockGetServerSession.mockResolvedValue(createUserSession());

    const request = createDeleteRequest({ code: "CUSTOM_REASON" });
    const response = await DELETE(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Admin access required");
  });

  it("returns 400 when code is missing", async () => {
    mockGetServerSession.mockResolvedValue(createAdminSession());

    const request = createDeleteRequest({});
    const response = await DELETE(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("code is required");
  });

  it("returns success when custom reason is deleted", async () => {
    mockGetServerSession.mockResolvedValue(createAdminSession());

    vi.mocked(deleteFailureReason).mockResolvedValue(undefined);

    const request = createDeleteRequest({ code: "CUSTOM_REASON" });
    const response = await DELETE(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("returns 400 when attempting to delete a built-in reason", async () => {
    mockGetServerSession.mockResolvedValue(createAdminSession());

    vi.mocked(deleteFailureReason).mockRejectedValue(
      new Error("Built-in reasons cannot be deleted")
    );

    const request = createDeleteRequest({ code: "NOT_A_RECEIPT" });
    const response = await DELETE(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Built-in reasons cannot be deleted");
  });
});

// ─── Tests: POST /api/admin/failure-reasons/generate ───────────────────────────

describe("POST /api/admin/failure-reasons/generate", () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createGenerateRequest({ code: "WRONG_STORE" });
    const response = await GENERATE_POST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 403 when user is not an admin", async () => {
    mockGetServerSession.mockResolvedValue(createUserSession());

    const request = createGenerateRequest({ code: "WRONG_STORE" });
    const response = await GENERATE_POST(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Admin access required");
  });

  it("returns 400 when code is missing", async () => {
    mockGetServerSession.mockResolvedValue(createAdminSession());

    const request = createGenerateRequest({});
    const response = await GENERATE_POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("code is required");
  });

  it("returns generated description on success", async () => {
    mockGetServerSession.mockResolvedValue(createAdminSession());

    vi.mocked(generateDescriptionFromCode).mockResolvedValue(
      "The receipt is from a different store"
    );

    const request = createGenerateRequest({ code: "WRONG_STORE" });
    const response = await GENERATE_POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.description).toBe("The receipt is from a different store");
  });

  it("returns 500 when generation fails", async () => {
    mockGetServerSession.mockResolvedValue(createAdminSession());

    vi.mocked(generateDescriptionFromCode).mockRejectedValue(
      new Error("AI API error: 500")
    );

    const request = createGenerateRequest({ code: "WRONG_STORE" });
    const response = await GENERATE_POST(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("AI API error: 500");
  });
});
