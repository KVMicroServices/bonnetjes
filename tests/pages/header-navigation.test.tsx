import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";

// ─── Mock Setup ────────────────────────────────────────────────────────────────

let mockSession: { user?: { id: string; email: string; role: string } } | null = null;

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: mockSession }),
  signOut: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    const translations: Record<string, string> = {
      dashboard: "Dashboard",
      settings: "Settings",
      analytics: "Analytics",
      signOut: "Sign Out",
      signIn: "Sign In",
      getStarted: "Get Started",
    };
    return translations[key] || key;
  },
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => React.createElement("div", props, children),
  },
  AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
}));

vi.mock("@/components/language-selector", () => ({
  LanguageSelector: () => React.createElement("div", { "data-testid": "language-selector" }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: any) =>
    React.createElement("a", { href, ...props }, children),
}));

vi.mock("lucide-react", () => ({
  LogOut: () => React.createElement("span", null, "LogOutIcon"),
  LayoutDashboard: () => React.createElement("span", null, "DashboardIcon"),
  Menu: () => React.createElement("span", null, "MenuIcon"),
  X: () => React.createElement("span", null, "XIcon"),
  Settings: () => React.createElement("span", null, "SettingsIcon"),
  BarChart3: () => React.createElement("span", null, "BarChart3Icon"),
}));

// ─── Imports (after mocks) ─────────────────────────────────────────────────────

import { renderToStaticMarkup } from "react-dom/server";
import { Header } from "@/components/header";

// ─── Helper ────────────────────────────────────────────────────────────────────

function renderHeader(): string {
  return renderToStaticMarkup(React.createElement(Header));
}

// ─── Tests: Authenticated User Navigation ──────────────────────────────────────

describe("Header navigation for authenticated users", () => {
  beforeEach(() => {
    mockSession = {
      user: { id: "user-1", email: "user@test.com", role: "user" },
    };
  });

  it("renders Dashboard link", () => {
    const html = renderHeader();

    expect(html).toContain("Dashboard");
    expect(html).toContain('href="/admin"');
  });

  it("renders Settings link for admin users", () => {
    mockSession = {
      user: { id: "admin-1", email: "admin@test.com", role: "admin" },
    };
    const html = renderHeader();

    expect(html).toContain("Settings");
    expect(html).toContain('href="/admin/settings"');
  });

  it("renders Analytics link for admin users", () => {
    mockSession = {
      user: { id: "admin-1", email: "admin@test.com", role: "admin" },
    };
    const html = renderHeader();

    expect(html).toContain("Analytics");
    expect(html).toContain('href="/admin/analytics"');
  });

  it("does not render Analytics link for non-admin users", () => {
    const html = renderHeader();

    expect(html).not.toContain("Analytics");
    expect(html).not.toContain('href="/admin/analytics"');
  });

  it("does not render Settings link for non-admin users", () => {
    const html = renderHeader();

    expect(html).not.toContain("Settings");
    expect(html).not.toContain('href="/admin/settings"');
  });

  it("does not render Admin Panel link", () => {
    const html = renderHeader();

    expect(html).not.toContain("Admin Panel");
  });

  it("does not render Moderation link", () => {
    const html = renderHeader();

    expect(html).not.toContain("Moderation");
  });

  it("does not render Platforms link", () => {
    const html = renderHeader();

    expect(html).not.toContain("Platforms");
  });

  it("renders exactly Dashboard, Analytics, and Settings as navigation links for admin", () => {
    mockSession = {
      user: { id: "admin-1", email: "admin@test.com", role: "admin" },
    };
    const html = renderHeader();

    // Verify the expected links exist
    expect(html).toContain("Dashboard");
    expect(html).toContain("Analytics");
    expect(html).toContain("Settings");

    // Verify removed links do not exist
    expect(html).not.toContain("Admin Panel");
    expect(html).not.toContain("Moderation");
    expect(html).not.toContain("Platforms");
  });

  it("does not render Sign In or Get Started for authenticated users", () => {
    const html = renderHeader();

    expect(html).not.toContain("Sign In");
    expect(html).not.toContain("Get Started");
  });
});

// ─── Tests: Unauthenticated User Navigation ────────────────────────────────────

describe("Header navigation for unauthenticated users", () => {
  beforeEach(() => {
    mockSession = null;
  });

  it("renders Sign In link", () => {
    const html = renderHeader();

    expect(html).toContain("Sign In");
    expect(html).toContain('href="/login"');
  });

  it("renders Get Started link", () => {
    const html = renderHeader();

    expect(html).toContain("Get Started");
    expect(html).toContain('href="/signup"');
  });

  it("does not render Dashboard link for unauthenticated users", () => {
    const html = renderHeader();

    expect(html).not.toContain('href="/admin"');
  });

  it("does not render Settings link for unauthenticated users", () => {
    const html = renderHeader();

    expect(html).not.toContain('href="/admin/settings"');
  });

  it("renders exactly Sign In and Get Started as navigation links", () => {
    const html = renderHeader();

    expect(html).toContain("Sign In");
    expect(html).toContain("Get Started");
    expect(html).not.toContain("Dashboard");
    expect(html).not.toContain("Analytics");
    expect(html).not.toContain("Settings");
    expect(html).not.toContain("Admin Panel");
    expect(html).not.toContain("Moderation");
    expect(html).not.toContain("Platforms");
  });
});
