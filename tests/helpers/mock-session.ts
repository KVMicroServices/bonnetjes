import { vi } from "vitest";

export interface MockSession {
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    accessToken?: string;
    provider?: string;
  };
  expires: string;
}

const DEFAULT_USER_ID = "user-123";
const DEFAULT_ADMIN_ID = "admin-456";
const DEFAULT_EXPIRY = "2099-12-31T23:59:59.999Z";

/**
 * Creates a mock session for a regular authenticated user.
 */
export function createUserSession(overrides?: Partial<MockSession["user"]>): MockSession {
  return {
    user: {
      id: DEFAULT_USER_ID,
      email: "user@example.com",
      name: "Test User",
      role: "user",
      ...overrides,
    },
    expires: DEFAULT_EXPIRY,
  };
}

/**
 * Creates a mock session for an admin user.
 */
export function createAdminSession(overrides?: Partial<MockSession["user"]>): MockSession {
  return {
    user: {
      id: DEFAULT_ADMIN_ID,
      email: "admin@example.com",
      name: "Admin User",
      role: "admin",
      ...overrides,
    },
    expires: DEFAULT_EXPIRY,
  };
}

/**
 * Creates a mock session for a Google OAuth user with Drive access token.
 */
export function createGoogleSession(overrides?: Partial<MockSession["user"]>): MockSession {
  return {
    user: {
      id: DEFAULT_USER_ID,
      email: "user@example.com",
      name: "Google User",
      role: "user",
      accessToken: "fake-google-access-token",
      provider: "google",
      ...overrides,
    },
    expires: DEFAULT_EXPIRY,
  };
}

/**
 * Returns null to simulate an unauthenticated request.
 */
export function createUnauthenticatedSession(): null {
  return null;
}

/**
 * Mocks `getServerSession` from next-auth to return the provided session.
 * Call this with the desired session before each test.
 */
export function mockGetServerSession(session: MockSession | null): void {
  vi.mock("next-auth/next", () => ({
    getServerSession: vi.fn().mockResolvedValue(session),
  }));
}
