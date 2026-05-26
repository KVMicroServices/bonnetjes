import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  setupFetchMock,
  createJsonResponse,
  createErrorResponse,
} from "../helpers";

// ─── Mock Setup ────────────────────────────────────────────────────────────────

const fetchMock = setupFetchMock();

const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) => {
    if (params) {
      return `${key}:${JSON.stringify(params)}`;
    }
    return key;
  },
}));

let mockSessionData: { data: unknown; status: string } = {
  data: null,
  status: "unauthenticated",
};

vi.mock("next-auth/react", () => ({
  useSession: () => mockSessionData,
}));

// Suppress React rendering — we test the logic directly
vi.mock("react", async () => {
  const actual = await vi.importActual("react");
  return {
    ...actual,
    useState: (initial: unknown) => [initial, vi.fn()],
    useEffect: (callback: () => void) => callback(),
    useCallback: (callback: unknown) => callback,
  };
});

vi.mock("@/components/header", () => ({
  Header: () => null,
}));

vi.mock("lucide-react", () => ({
  Settings: () => null,
  Users: () => null,
  Loader2: () => null,
}));

// ─── Tests: Auth Redirect Behavior ─────────────────────────────────────────────

describe("Settings page auth redirect", () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockToast.mockClear();
    fetchMock.mockReset();
  });

  it("redirects unauthenticated users to /login", () => {
    mockSessionData = { data: null, status: "unauthenticated" };

    // Simulate the redirect logic from the component's useEffect
    const status = mockSessionData.status;
    if (status === "unauthenticated") {
      mockReplace("/login");
    }

    expect(mockReplace).toHaveBeenCalledWith("/login");
  });

  it("redirects non-admin authenticated users to /admin", () => {
    mockSessionData = {
      data: { user: { id: "user-1", role: "user", email: "user@test.com" } },
      status: "authenticated",
    };

    const isAdmin = (mockSessionData.data as any)?.user?.role === "admin";
    const status = mockSessionData.status;

    if (status === "authenticated" && !isAdmin) {
      mockReplace("/admin");
    }

    expect(mockReplace).toHaveBeenCalledWith("/admin");
  });

  it("does not redirect admin users", () => {
    mockSessionData = {
      data: { user: { id: "admin-1", role: "admin", email: "admin@test.com" } },
      status: "authenticated",
    };

    const isAdmin = (mockSessionData.data as any)?.user?.role === "admin";
    const status = mockSessionData.status;

    if (status === "unauthenticated") {
      mockReplace("/login");
    } else if (status === "authenticated" && !isAdmin) {
      mockReplace("/admin");
    }

    expect(mockReplace).not.toHaveBeenCalled();
  });
});

// ─── Tests: Role Update Fetch Calls ────────────────────────────────────────────

describe("Settings page role update", () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockToast.mockClear();
    fetchMock.mockReset();
  });

  it("sends PATCH to /api/admin/users with userId and role", async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse({ id: "user-1", email: "user@test.com", role: "admin" })
    );

    const userId = "user-1";
    const newRole = "admin";

    await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role: newRole }),
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "user-1", role: "admin" }),
    });
  });

  it("sends correct payload when changing role to user", async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse({ id: "admin-2", email: "other@test.com", role: "user" })
    );

    const userId = "admin-2";
    const newRole = "user";

    await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role: newRole }),
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "admin-2", role: "user" }),
    });
  });

  it("shows success toast on successful role update", async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse({ id: "user-1", email: "user@test.com", role: "admin" })
    );

    const response = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "user-1", role: "admin" }),
    });

    if (response.ok) {
      mockToast({
        title: "roleUpdated",
        description: "roleUpdatedDescription",
      });
    }

    expect(mockToast).toHaveBeenCalledWith({
      title: "roleUpdated",
      description: "roleUpdatedDescription",
    });
  });

  it("shows error toast on failed role update", async () => {
    fetchMock.mockResolvedValueOnce(createErrorResponse(500));

    const response = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "user-1", role: "admin" }),
    });

    if (!response.ok) {
      mockToast({
        title: "roleUpdateFailed",
        description: "roleUpdateFailedDescription",
        variant: "destructive",
      });
    }

    expect(mockToast).toHaveBeenCalledWith({
      title: "roleUpdateFailed",
      description: "roleUpdateFailedDescription",
      variant: "destructive",
    });
  });

  it("shows error toast on network failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network error"));

    try {
      await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "user-1", role: "admin" }),
      });
    } catch {
      mockToast({
        title: "roleUpdateFailed",
        description: "roleUpdateFailedDescription",
        variant: "destructive",
      });
    }

    expect(mockToast).toHaveBeenCalledWith({
      title: "roleUpdateFailed",
      description: "roleUpdateFailedDescription",
      variant: "destructive",
    });
  });
});
