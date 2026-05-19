import { describe, it, expect, vi } from "vitest";

// ─── Mock Setup ────────────────────────────────────────────────────────────────

const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => mockRedirect(...args),
}));

// ─── Imports (after mocks) ─────────────────────────────────────────────────────

import DashboardPage from "@/app/dashboard/page";

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("Dashboard page redirect", () => {
  it("calls redirect with /admin", () => {
    DashboardPage();

    expect(mockRedirect).toHaveBeenCalledWith("/admin");
  });

  it("calls redirect exactly once", () => {
    mockRedirect.mockClear();

    DashboardPage();

    expect(mockRedirect).toHaveBeenCalledTimes(1);
  });
});
