import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  setupPrismaMock,
  createUserSession,
  createAdminSession,
} from "../helpers";

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

// ─── Imports (after mocks) ─────────────────────────────────────────────────────

import { GET, PATCH } from "@/app/api/admin/settings/route";

// ─── Helper Functions ──────────────────────────────────────────────────────────

function createPatchRequest(body: unknown): NextRequest {
  return new NextRequest(new URL("/api/admin/settings", "http://localhost:3000"), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createInvalidJsonRequest(): NextRequest {
  return new NextRequest(new URL("/api/admin/settings", "http://localhost:3000"), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: "not valid json{{{",
  });
}

// ─── Tests: GET /api/admin/settings ────────────────────────────────────────────

describe("GET /api/admin/settings", () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
    delete process.env.RECEIPT_AUTO_VERIFY_ENABLED;
    delete process.env.RECEIPT_AUTO_DISABLE_ENABLED;
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 403 when user is not an admin", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Admin access required");
  });

  it("returns both toggles as false by default", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);
    mockPrisma.appSetting.findUnique.mockResolvedValue(null);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      autoVerifyEnabled: false,
      autoDisableEnabled: false,
    });
  });

  it("returns toggle values from database", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.appSetting.findUnique
      .mockResolvedValueOnce({
        key: "receipt_auto_verify_enabled",
        value: "true",
        updatedAt: new Date(),
      })
      .mockResolvedValueOnce({
        key: "receipt_auto_disable_enabled",
        value: "true",
        updatedAt: new Date(),
      });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      autoVerifyEnabled: true,
      autoDisableEnabled: true,
    });
  });
});

// ─── Tests: PATCH /api/admin/settings ──────────────────────────────────────────

describe("PATCH /api/admin/settings", () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
    delete process.env.RECEIPT_AUTO_VERIFY_ENABLED;
    delete process.env.RECEIPT_AUTO_DISABLE_ENABLED;
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createPatchRequest({ autoDisableEnabled: true });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 403 when user is not an admin", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    const request = createPatchRequest({ autoDisableEnabled: true });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Admin access required");
  });

  it("returns 400 for invalid JSON body", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    const request = createInvalidJsonRequest();
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid JSON body");
  });

  it("returns 400 when autoDisableEnabled is not a boolean", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    const request = createPatchRequest({ autoDisableEnabled: "yes" });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("autoDisableEnabled must be a boolean");
  });

  it("returns 400 when autoVerifyEnabled is not a boolean", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    const request = createPatchRequest({ autoVerifyEnabled: 1 });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("autoVerifyEnabled must be a boolean");
  });

  it("enables auto-disable and persists to database", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.appSetting.upsert.mockResolvedValue({
      key: "receipt_auto_disable_enabled",
      value: "true",
      updatedAt: new Date(),
    });

    // After upsert, getFeatureToggles reads back
    mockPrisma.appSetting.findUnique
      .mockResolvedValueOnce({
        key: "receipt_auto_verify_enabled",
        value: "false",
        updatedAt: new Date(),
      })
      .mockResolvedValueOnce({
        key: "receipt_auto_disable_enabled",
        value: "true",
        updatedAt: new Date(),
      });

    const request = createPatchRequest({ autoDisableEnabled: true });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.autoDisableEnabled).toBe(true);
    expect(body.autoVerifyEnabled).toBe(false);

    expect(mockPrisma.appSetting.upsert).toHaveBeenCalledWith({
      where: { key: "receipt_auto_disable_enabled" },
      update: { value: "true" },
      create: { key: "receipt_auto_disable_enabled", value: "true" },
    });
  });

  it("disables auto-disable and persists to database", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.appSetting.upsert.mockResolvedValue({
      key: "receipt_auto_disable_enabled",
      value: "false",
      updatedAt: new Date(),
    });

    mockPrisma.appSetting.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        key: "receipt_auto_disable_enabled",
        value: "false",
        updatedAt: new Date(),
      });

    const request = createPatchRequest({ autoDisableEnabled: false });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.autoDisableEnabled).toBe(false);

    expect(mockPrisma.appSetting.upsert).toHaveBeenCalledWith({
      where: { key: "receipt_auto_disable_enabled" },
      update: { value: "false" },
      create: { key: "receipt_auto_disable_enabled", value: "false" },
    });
  });

  it("enables auto-verify and persists to database", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.appSetting.upsert.mockResolvedValue({
      key: "receipt_auto_verify_enabled",
      value: "true",
      updatedAt: new Date(),
    });

    mockPrisma.appSetting.findUnique
      .mockResolvedValueOnce({
        key: "receipt_auto_verify_enabled",
        value: "true",
        updatedAt: new Date(),
      })
      .mockResolvedValueOnce(null);

    const request = createPatchRequest({ autoVerifyEnabled: true });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.autoVerifyEnabled).toBe(true);
    expect(body.autoDisableEnabled).toBe(false);
  });

  it("updates both toggles in a single request", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.appSetting.upsert.mockResolvedValue({
      key: "any",
      value: "true",
      updatedAt: new Date(),
    });

    mockPrisma.appSetting.findUnique
      .mockResolvedValueOnce({
        key: "receipt_auto_verify_enabled",
        value: "true",
        updatedAt: new Date(),
      })
      .mockResolvedValueOnce({
        key: "receipt_auto_disable_enabled",
        value: "true",
        updatedAt: new Date(),
      });

    const request = createPatchRequest({
      autoVerifyEnabled: true,
      autoDisableEnabled: true,
    });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.autoVerifyEnabled).toBe(true);
    expect(body.autoDisableEnabled).toBe(true);

    expect(mockPrisma.appSetting.upsert).toHaveBeenCalledTimes(2);
  });

  it("ignores unknown fields in the request body", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.appSetting.findUnique.mockResolvedValue(null);

    const request = createPatchRequest({ unknownField: "value" });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockPrisma.appSetting.upsert).not.toHaveBeenCalled();
    expect(body.autoVerifyEnabled).toBe(false);
    expect(body.autoDisableEnabled).toBe(false);
  });
});
