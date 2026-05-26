import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createUserSession, createAdminSession } from "../helpers";

// ─── Mock Setup ────────────────────────────────────────────────────────────────

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

vi.mock("@/lib/services/email-template-override-service", () => ({
  getOverridesForEmailType: vi.fn(),
  getDefaultValues: vi.fn(),
  upsertOverride: vi.fn(),
  deleteOverride: vi.fn(),
  bulkUpsertOverrides: vi.fn(),
}));

vi.mock("@/lib/services/email-template-translator", () => ({
  translateEmailTemplateEntry: vi.fn(),
}));

vi.mock("@/lib/email/email-templates", () => ({
  renderDisableEmailHtml: vi.fn().mockReturnValue("<html>disable</html>"),
  renderDisableEmailSubject: vi.fn().mockReturnValue("Disable Subject"),
  renderVerifiedEmailHtml: vi.fn().mockReturnValue("<html>verified</html>"),
  renderVerifiedEmailSubject: vi.fn().mockReturnValue("Verified Subject"),
  renderFinalRejectionEmailHtml: vi.fn().mockReturnValue("<html>rejection</html>"),
  renderFinalRejectionEmailSubject: vi.fn().mockReturnValue("Rejection Subject"),
}));

// ─── Imports (after mocks) ─────────────────────────────────────────────────────

import { GET, PATCH } from "@/app/api/admin/email-templates/route";
import { POST as TRANSLATE_POST } from "@/app/api/admin/email-templates/translate/route";
import { POST as PREVIEW_POST } from "@/app/api/admin/email-templates/preview/route";
import {
  getOverridesForEmailType,
  getDefaultValues,
  upsertOverride,
  deleteOverride,
  bulkUpsertOverrides,
} from "@/lib/services/email-template-override-service";
import { translateEmailTemplateEntry } from "@/lib/services/email-template-translator";

// ─── Helper Functions ──────────────────────────────────────────────────────────

function createGetRequest(params: Record<string, string>): NextRequest {
  const url = new URL("/api/admin/email-templates", "http://localhost:3000");
  for (const key of Object.keys(params)) {
    url.searchParams.set(key, params[key]);
  }
  return new NextRequest(url, { method: "GET" });
}

function createPatchRequest(body: unknown): NextRequest {
  return new NextRequest(new URL("/api/admin/email-templates", "http://localhost:3000"), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createTranslateRequest(body: unknown): NextRequest {
  return new NextRequest(new URL("/api/admin/email-templates/translate", "http://localhost:3000"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createPreviewRequest(body: unknown): NextRequest {
  return new NextRequest(new URL("/api/admin/email-templates/preview", "http://localhost:3000"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ─── Tests: GET /api/admin/email-templates ─────────────────────────────────────

describe("GET /api/admin/email-templates", () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
    vi.mocked(getOverridesForEmailType).mockReset();
    vi.mocked(getDefaultValues).mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createGetRequest({ emailType: "disable", locale: "en" });
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 403 when user is not an admin", async () => {
    mockGetServerSession.mockResolvedValue(createUserSession());

    const request = createGetRequest({ emailType: "disable", locale: "en" });
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Admin access required");
  });

  it("returns 400 for invalid emailType", async () => {
    mockGetServerSession.mockResolvedValue(createAdminSession());

    const request = createGetRequest({ emailType: "invalid", locale: "en" });
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid query parameters");
  });

  it("returns 400 for invalid locale", async () => {
    mockGetServerSession.mockResolvedValue(createAdminSession());

    const request = createGetRequest({ emailType: "disable", locale: "xx" });
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid query parameters");
  });

  it("returns 400 when emailType is missing", async () => {
    mockGetServerSession.mockResolvedValue(createAdminSession());

    const request = createGetRequest({ locale: "en" });
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid query parameters");
  });

  it("returns merged defaults and overrides on success", async () => {
    mockGetServerSession.mockResolvedValue(createAdminSession());
    vi.mocked(getDefaultValues).mockReturnValue({
      subject: "Default subject",
      greeting: "Default greeting",
    });
    vi.mocked(getOverridesForEmailType).mockResolvedValue({
      subject: "Custom subject",
    });

    const request = createGetRequest({ emailType: "disable", locale: "en" });
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.emailType).toBe("disable");
    expect(body.locale).toBe("en");
    expect(body.values.subject).toBe("Custom subject");
    expect(body.values.greeting).toBe("Default greeting");
  });

  it("returns 500 when service throws an error", async () => {
    mockGetServerSession.mockResolvedValue(createAdminSession());
    vi.mocked(getDefaultValues).mockImplementation(() => {
      throw new Error("File read error");
    });

    const request = createGetRequest({ emailType: "disable", locale: "en" });
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Failed to fetch email template data");
  });
});

// ─── Tests: PATCH /api/admin/email-templates ───────────────────────────────────

describe("PATCH /api/admin/email-templates", () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
    vi.mocked(upsertOverride).mockReset();
    vi.mocked(deleteOverride).mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createPatchRequest({
      emailType: "disable",
      locale: "en",
      overrides: { subject: "New subject" },
    });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 403 when user is not an admin", async () => {
    mockGetServerSession.mockResolvedValue(createUserSession());

    const request = createPatchRequest({
      emailType: "disable",
      locale: "en",
      overrides: { subject: "New subject" },
    });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Admin access required");
  });

  it("returns 400 for invalid request body", async () => {
    mockGetServerSession.mockResolvedValue(createAdminSession());

    const request = createPatchRequest({
      emailType: "invalid",
      locale: "en",
      overrides: {},
    });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid request body");
  });

  it("returns 400 when overrides field is missing", async () => {
    mockGetServerSession.mockResolvedValue(createAdminSession());

    const request = createPatchRequest({
      emailType: "disable",
      locale: "en",
    });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid request body");
  });

  it("upserts non-empty values and deletes empty ones", async () => {
    mockGetServerSession.mockResolvedValue(createAdminSession());
    vi.mocked(upsertOverride).mockResolvedValue(undefined);
    vi.mocked(deleteOverride).mockResolvedValue(undefined);

    const request = createPatchRequest({
      emailType: "disable",
      locale: "en",
      overrides: {
        subject: "Updated subject",
        greeting: "",
      },
    });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(vi.mocked(upsertOverride)).toHaveBeenCalledWith("disable", "subject", "en", "Updated subject");
    expect(vi.mocked(deleteOverride)).toHaveBeenCalledWith("disable", "greeting", "en");
  });

  it("returns 500 when service throws an error", async () => {
    mockGetServerSession.mockResolvedValue(createAdminSession());
    vi.mocked(upsertOverride).mockRejectedValue(new Error("DB write failed"));

    const request = createPatchRequest({
      emailType: "verified",
      locale: "nl",
      overrides: { subject: "New" },
    });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Failed to save email template overrides");
  });
});

// ─── Tests: POST /api/admin/email-templates/translate ──────────────────────────

describe("POST /api/admin/email-templates/translate", () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
    vi.mocked(translateEmailTemplateEntry).mockReset();
    vi.mocked(bulkUpsertOverrides).mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createTranslateRequest({
      emailType: "disable",
      sourceLocale: "en",
      entries: [{ key: "subject", value: "Hello" }],
    });
    const response = await TRANSLATE_POST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 403 when user is not an admin", async () => {
    mockGetServerSession.mockResolvedValue(createUserSession());

    const request = createTranslateRequest({
      emailType: "disable",
      sourceLocale: "en",
      entries: [{ key: "subject", value: "Hello" }],
    });
    const response = await TRANSLATE_POST(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Admin access required");
  });

  it("returns 400 for invalid request body", async () => {
    mockGetServerSession.mockResolvedValue(createAdminSession());

    const request = createTranslateRequest({
      emailType: "invalid",
      sourceLocale: "en",
      entries: [],
    });
    const response = await TRANSLATE_POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid request body");
  });

  it("returns 400 when entries array is empty", async () => {
    mockGetServerSession.mockResolvedValue(createAdminSession());

    const request = createTranslateRequest({
      emailType: "disable",
      sourceLocale: "en",
      entries: [],
    });
    const response = await TRANSLATE_POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid request body");
  });

  it("translates entries and stores results via bulkUpsertOverrides", async () => {
    mockGetServerSession.mockResolvedValue(createAdminSession());
    vi.mocked(translateEmailTemplateEntry).mockResolvedValue({
      success: true,
      translations: {
        nl: "Hallo",
        de: "Hallo",
        fr: "Bonjour",
        es: "Hola",
        af: "Hallo",
        xh: "Molo",
        zu: "Sawubona",
      },
    });
    vi.mocked(bulkUpsertOverrides).mockResolvedValue(undefined);

    const request = createTranslateRequest({
      emailType: "disable",
      sourceLocale: "en",
      entries: [{ key: "subject", value: "Hello" }],
    });
    const response = await TRANSLATE_POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.translated).toBe(1);
    expect(body.failed).toEqual([]);
    expect(vi.mocked(bulkUpsertOverrides)).toHaveBeenCalled();
  });

  it("reports failed keys when translation fails", async () => {
    mockGetServerSession.mockResolvedValue(createAdminSession());
    vi.mocked(translateEmailTemplateEntry).mockResolvedValue({
      success: false,
      translations: {},
      error: "AI API error",
    });

    const request = createTranslateRequest({
      emailType: "disable",
      sourceLocale: "en",
      entries: [{ key: "subject", value: "Hello" }],
    });
    const response = await TRANSLATE_POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.translated).toBe(0);
    expect(body.failed).toEqual(["subject"]);
  });

  it("handles partial success with multiple entries", async () => {
    mockGetServerSession.mockResolvedValue(createAdminSession());
    vi.mocked(translateEmailTemplateEntry)
      .mockResolvedValueOnce({
        success: true,
        translations: {
          nl: "Onderwerp",
          de: "Betreff",
          fr: "Sujet",
          es: "Asunto",
          af: "Onderwerp",
          xh: "Isihloko",
          zu: "Isihloko",
        },
      })
      .mockResolvedValueOnce({
        success: false,
        translations: {},
        error: "Timeout",
      });
    vi.mocked(bulkUpsertOverrides).mockResolvedValue(undefined);

    const request = createTranslateRequest({
      emailType: "disable",
      sourceLocale: "en",
      entries: [
        { key: "subject", value: "Subject" },
        { key: "greeting", value: "Hello" },
      ],
    });
    const response = await TRANSLATE_POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.translated).toBe(1);
    expect(body.failed).toEqual(["greeting"]);
  });

  it("catches unexpected errors and adds key to failed list", async () => {
    mockGetServerSession.mockResolvedValue(createAdminSession());
    vi.mocked(translateEmailTemplateEntry).mockRejectedValue(new Error("Network error"));

    const request = createTranslateRequest({
      emailType: "disable",
      sourceLocale: "en",
      entries: [{ key: "subject", value: "Hello" }],
    });
    const response = await TRANSLATE_POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.translated).toBe(0);
    expect(body.failed).toEqual(["subject"]);
  });
});

// ─── Tests: POST /api/admin/email-templates/preview ────────────────────────────

describe("POST /api/admin/email-templates/preview", () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
    vi.mocked(getDefaultValues).mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createPreviewRequest({
      emailType: "disable",
      overrides: { subject: "Test" },
    });
    const response = await PREVIEW_POST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 403 when user is not an admin", async () => {
    mockGetServerSession.mockResolvedValue(createUserSession());

    const request = createPreviewRequest({
      emailType: "disable",
      overrides: { subject: "Test" },
    });
    const response = await PREVIEW_POST(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Admin access required");
  });

  it("returns 400 for invalid request body", async () => {
    mockGetServerSession.mockResolvedValue(createAdminSession());

    const request = createPreviewRequest({
      emailType: "invalid",
      overrides: {},
    });
    const response = await PREVIEW_POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid request body");
  });

  it("returns 400 when overrides field is missing", async () => {
    mockGetServerSession.mockResolvedValue(createAdminSession());

    const request = createPreviewRequest({
      emailType: "disable",
    });
    const response = await PREVIEW_POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid request body");
  });

  it("renders preview for disable email type", async () => {
    mockGetServerSession.mockResolvedValue(createAdminSession());
    vi.mocked(getDefaultValues).mockReturnValue({
      subject: "Default subject",
      greeting: "Default greeting",
    });

    const request = createPreviewRequest({
      emailType: "disable",
      overrides: { subject: "Custom subject" },
    });
    const response = await PREVIEW_POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.subject).toBe("Disable Subject");
    expect(body.html).toBe("<html>disable</html>");
  });

  it("renders preview for verified email type", async () => {
    mockGetServerSession.mockResolvedValue(createAdminSession());
    vi.mocked(getDefaultValues).mockReturnValue({
      subject: "Default subject",
      greeting: "Default greeting",
    });

    const request = createPreviewRequest({
      emailType: "verified",
      overrides: { subject: "Custom subject" },
    });
    const response = await PREVIEW_POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.subject).toBe("Verified Subject");
    expect(body.html).toBe("<html>verified</html>");
  });

  it("renders preview for disputeVerified email type", async () => {
    mockGetServerSession.mockResolvedValue(createAdminSession());
    vi.mocked(getDefaultValues).mockReturnValue({
      subject: "Default subject",
      greeting: "Default greeting",
    });

    const request = createPreviewRequest({
      emailType: "disputeVerified",
      overrides: { subject: "Custom subject" },
    });
    const response = await PREVIEW_POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.subject).toBe("Verified Subject");
    expect(body.html).toBe("<html>verified</html>");
  });

  it("renders preview for finalRejection email type", async () => {
    mockGetServerSession.mockResolvedValue(createAdminSession());
    vi.mocked(getDefaultValues).mockReturnValue({
      subject: "Default subject",
      greeting: "Default greeting",
    });

    const request = createPreviewRequest({
      emailType: "finalRejection",
      overrides: { subject: "Custom subject" },
    });
    const response = await PREVIEW_POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.subject).toBe("Rejection Subject");
    expect(body.html).toBe("<html>rejection</html>");
  });

  it("returns 500 when rendering throws an error", async () => {
    mockGetServerSession.mockResolvedValue(createAdminSession());
    vi.mocked(getDefaultValues).mockImplementation(() => {
      throw new Error("Render error");
    });

    const request = createPreviewRequest({
      emailType: "disable",
      overrides: { subject: "Test" },
    });
    const response = await PREVIEW_POST(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Failed to render email preview");
  });
});
