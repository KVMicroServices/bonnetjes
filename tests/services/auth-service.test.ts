import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mockDeep, DeepMockProxy } from "vitest-mock-extended";
import { PrismaClient } from "@prisma/client";

vi.mock("bcryptjs", () => ({
  default: {
    compare: vi.fn(),
    hash: vi.fn(),
  },
}));

import bcrypt from "bcryptjs";
import {
  validateCredentials,
  registerUser,
  refreshGoogleToken,
} from "@/lib/services/auth-service";
import type { AuthServiceDependencies } from "@/lib/services/auth-service";

// ─── Mock Factories ────────────────────────────────────────────────────────────

function createMockDependencies(): {
  database: DeepMockProxy<PrismaClient>;
} {
  return {
    database: mockDeep<PrismaClient>(),
  };
}

// ─── Test Fixtures ─────────────────────────────────────────────────────────────

const EXISTING_USER = {
  id: "user-123",
  email: "user@example.com",
  name: "Test User",
  password: "$2a$10$hashedpassword",
  role: "user",
  emailVerified: null,
  image: null,
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-01T00:00:00Z"),
};

const OAUTH_USER = {
  ...EXISTING_USER,
  id: "oauth-user-456",
  email: "oauth@example.com",
  password: null,
};

const GOOGLE_ACCOUNT = {
  id: "account-001",
  userId: "user-123",
  type: "oauth",
  provider: "google",
  providerAccountId: "google-123",
  refresh_token: "refresh-token-abc",
  access_token: "current-access-token",
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: "Bearer",
  scope: "openid email",
  id_token: null,
  session_state: null,
};

// ─── Tests: validateCredentials ────────────────────────────────────────────────

describe("validateCredentials", () => {
  let dependencies: ReturnType<typeof createMockDependencies>;

  beforeEach(() => {
    dependencies = createMockDependencies();
    vi.mocked(bcrypt.compare).mockReset();
  });

  it("returns user when credentials are valid", async () => {
    dependencies.database.user.findUnique.mockResolvedValue(EXISTING_USER as any);
    vi.mocked(bcrypt.compare).mockResolvedValue(true as any);

    const result = await validateCredentials(dependencies, "user@example.com", "correct-password");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.user.id).toBe("user-123");
      expect(result.user.email).toBe("user@example.com");
      expect(result.user.name).toBe("Test User");
      expect(result.user.role).toBe("user");
    }
  });

  it("returns error when password is invalid", async () => {
    dependencies.database.user.findUnique.mockResolvedValue(EXISTING_USER as any);
    vi.mocked(bcrypt.compare).mockResolvedValue(false as any);

    const result = await validateCredentials(dependencies, "user@example.com", "wrong-password");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Invalid credentials");
    }
  });

  it("returns error when user is not found", async () => {
    dependencies.database.user.findUnique.mockResolvedValue(null);

    const result = await validateCredentials(dependencies, "nonexistent@example.com", "password");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Invalid credentials");
    }
  });

  it("returns error when user has no password (OAuth-only account)", async () => {
    dependencies.database.user.findUnique.mockResolvedValue(OAUTH_USER as any);

    const result = await validateCredentials(dependencies, "oauth@example.com", "password");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Invalid credentials");
    }
  });
});

// ─── Tests: registerUser ───────────────────────────────────────────────────────

describe("registerUser", () => {
  let dependencies: ReturnType<typeof createMockDependencies>;

  beforeEach(() => {
    dependencies = createMockDependencies();
    vi.mocked(bcrypt.hash).mockReset();
    vi.mocked(bcrypt.hash).mockResolvedValue("$2a$10$newhashedpassword" as any);
  });

  it("registers a new user successfully", async () => {
    dependencies.database.user.findUnique.mockResolvedValue(null);
    dependencies.database.user.create.mockResolvedValue({
      id: "new-user-789",
      email: "new@example.com",
      name: "New User",
      password: "$2a$10$newhashedpassword",
      role: "user",
    } as any);

    const result = await registerUser(dependencies, {
      email: "new@example.com",
      password: "securepassword",
      name: "New User",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.user.id).toBe("new-user-789");
      expect(result.user.email).toBe("new@example.com");
      expect(result.user.name).toBe("New User");
    }
    expect(bcrypt.hash).toHaveBeenCalledWith("securepassword", 10);
    expect(dependencies.database.user.create).toHaveBeenCalledWith({
      data: {
        email: "new@example.com",
        password: "$2a$10$newhashedpassword",
        name: "New User",
        role: "user",
      },
    });
  });

  it("returns error when email is already registered", async () => {
    dependencies.database.user.findUnique.mockResolvedValue(EXISTING_USER as any);

    const result = await registerUser(dependencies, {
      email: "user@example.com",
      password: "securepassword",
      name: "Duplicate User",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Email already registered");
    }
  });

  it("returns validation error for invalid email", async () => {
    const result = await registerUser(dependencies, {
      email: "not-an-email",
      password: "securepassword",
      name: "Test User",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Invalid email address");
      expect(result.validationError).toBe(true);
    }
  });

  it("returns validation error for short password", async () => {
    const result = await registerUser(dependencies, {
      email: "valid@example.com",
      password: "short",
      name: "Test User",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Password must be at least 6 characters");
      expect(result.validationError).toBe(true);
    }
  });

  it("returns validation error for missing name", async () => {
    const result = await registerUser(dependencies, {
      email: "valid@example.com",
      password: "securepassword",
      name: "",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Name is required");
      expect(result.validationError).toBe(true);
    }
  });
});

// ─── Tests: refreshGoogleToken ─────────────────────────────────────────────────

describe("refreshGoogleToken", () => {
  let dependencies: ReturnType<typeof createMockDependencies>;
  const originalEnv = process.env;

  beforeEach(() => {
    dependencies = createMockDependencies();
    process.env = {
      ...originalEnv,
      GOOGLE_CLIENT_ID: "test-client-id",
      GOOGLE_CLIENT_SECRET: "test-client-secret",
    };
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it("returns existing token when not expired", async () => {
    const validAccount = {
      ...GOOGLE_ACCOUNT,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    };
    dependencies.database.account.findFirst.mockResolvedValue(validAccount as any);

    const result = await refreshGoogleToken(dependencies, "account-001");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.accessToken).toBe("current-access-token");
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refreshes token when expired", async () => {
    const expiredAccount = {
      ...GOOGLE_ACCOUNT,
      expires_at: Math.floor(Date.now() / 1000) - 600,
    };
    dependencies.database.account.findFirst.mockResolvedValue(expiredAccount as any);
    dependencies.database.account.update.mockResolvedValue({} as any);

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "new-access-token",
        expires_in: 3600,
      }),
    } as Response);

    const result = await refreshGoogleToken(dependencies, "account-001");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.accessToken).toBe("new-access-token");
    }
    expect(fetch).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/token",
      expect.objectContaining({ method: "POST" })
    );
    expect(dependencies.database.account.update).toHaveBeenCalledWith({
      where: { id: "account-001" },
      data: expect.objectContaining({
        access_token: "new-access-token",
      }),
    });
  });

  it("returns error when account is not found", async () => {
    dependencies.database.account.findFirst.mockResolvedValue(null);

    const result = await refreshGoogleToken(dependencies, "nonexistent-account");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Account not found");
    }
  });

  it("returns error when no refresh token is available", async () => {
    const accountWithoutRefreshToken = {
      ...GOOGLE_ACCOUNT,
      refresh_token: null,
    };
    dependencies.database.account.findFirst.mockResolvedValue(accountWithoutRefreshToken as any);

    const result = await refreshGoogleToken(dependencies, "account-001");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("No refresh token available");
    }
  });

  it("returns error when Google OAuth env vars are missing", async () => {
    const expiredAccount = {
      ...GOOGLE_ACCOUNT,
      expires_at: Math.floor(Date.now() / 1000) - 600,
    };
    dependencies.database.account.findFirst.mockResolvedValue(expiredAccount as any);
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;

    const result = await refreshGoogleToken(dependencies, "account-001");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Google OAuth credentials not configured");
    }
  });

  it("returns error when token refresh API call fails", async () => {
    const expiredAccount = {
      ...GOOGLE_ACCOUNT,
      expires_at: Math.floor(Date.now() / 1000) - 600,
    };
    dependencies.database.account.findFirst.mockResolvedValue(expiredAccount as any);

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "invalid_grant" }),
    } as Response);

    const result = await refreshGoogleToken(dependencies, "account-001");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Token refresh request failed");
    }
  });
});
