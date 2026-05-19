import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { setupPrismaMock } from "../helpers";

// ─── Mock Setup ────────────────────────────────────────────────────────────────

const mockPrisma = setupPrismaMock();

// Mock bcrypt at module boundary
const mockBcryptCompare = vi.fn();
const mockBcryptHash = vi.fn();

vi.mock("bcryptjs", () => ({
  default: {
    compare: (...args: unknown[]) => mockBcryptCompare(...args),
    hash: (...args: unknown[]) => mockBcryptHash(...args),
  },
  compare: (...args: unknown[]) => mockBcryptCompare(...args),
  hash: (...args: unknown[]) => mockBcryptHash(...args),
}));

// ─── Imports (after mocks) ─────────────────────────────────────────────────────

import { POST as loginPost } from "@/app/api/auth/login/route";
import { POST as signupPost } from "@/app/api/signup/route";

// ─── Test Fixtures ─────────────────────────────────────────────────────────────

const EXISTING_USER = {
  id: "user-123",
  email: "existing@example.com",
  name: "Existing User",
  password: "$2a$10$hashedpasswordvalue",
  role: "user",
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-01T00:00:00Z"),
};

// ─── Helper Functions ──────────────────────────────────────────────────────────

function createJsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ─── Tests: POST /api/auth/login ───────────────────────────────────────────────

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    mockBcryptCompare.mockReset();
    mockBcryptHash.mockReset();
  });

  it("returns 400 when email is missing", async () => {
    const request = createJsonRequest("/api/auth/login", {
      password: "somepassword",
    });
    const response = await loginPost(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Email and password are required");
  });

  it("returns 400 when password is missing", async () => {
    const request = createJsonRequest("/api/auth/login", {
      email: "user@example.com",
    });
    const response = await loginPost(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Email and password are required");
  });

  it("returns 400 when both email and password are missing", async () => {
    const request = createJsonRequest("/api/auth/login", {});
    const response = await loginPost(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Email and password are required");
  });

  it("returns 401 when user does not exist", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const request = createJsonRequest("/api/auth/login", {
      email: "nonexistent@example.com",
      password: "anypassword",
    });
    const response = await loginPost(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Invalid credentials");
  });

  it("returns 401 when user exists but has no password (OAuth-only account)", async () => {
    const oauthOnlyUser = {
      ...EXISTING_USER,
      password: null,
    };
    mockPrisma.user.findUnique.mockResolvedValue(oauthOnlyUser as any);

    const request = createJsonRequest("/api/auth/login", {
      email: "existing@example.com",
      password: "anypassword",
    });
    const response = await loginPost(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Invalid credentials");
  });

  it("returns 401 when password does not match", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(EXISTING_USER as any);
    mockBcryptCompare.mockResolvedValue(false);

    const request = createJsonRequest("/api/auth/login", {
      email: "existing@example.com",
      password: "wrongpassword",
    });
    const response = await loginPost(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Invalid credentials");
  });

  it("returns user data when credentials are valid", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(EXISTING_USER as any);
    mockBcryptCompare.mockResolvedValue(true);

    const request = createJsonRequest("/api/auth/login", {
      email: "existing@example.com",
      password: "correctpassword",
    });
    const response = await loginPost(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe("user-123");
    expect(body.email).toBe("existing@example.com");
    expect(body.name).toBe("Existing User");
    expect(body.role).toBe("user");
  });

  it("does not return password hash in successful login response", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(EXISTING_USER as any);
    mockBcryptCompare.mockResolvedValue(true);

    const request = createJsonRequest("/api/auth/login", {
      email: "existing@example.com",
      password: "correctpassword",
    });
    const response = await loginPost(request);
    const body = await response.json();

    expect(body.password).toBeUndefined();
  });

  it("calls bcrypt.compare with the provided password and stored hash", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(EXISTING_USER as any);
    mockBcryptCompare.mockResolvedValue(true);

    const request = createJsonRequest("/api/auth/login", {
      email: "existing@example.com",
      password: "mypassword123",
    });
    await loginPost(request);

    expect(mockBcryptCompare).toHaveBeenCalledWith(
      "mypassword123",
      "$2a$10$hashedpasswordvalue"
    );
  });
});

// ─── Tests: POST /api/signup ───────────────────────────────────────────────────

describe("POST /api/signup", () => {
  beforeEach(() => {
    mockBcryptCompare.mockReset();
    mockBcryptHash.mockReset();
  });

  it("returns 400 when email is missing", async () => {
    const request = createJsonRequest("/api/signup", {
      password: "validpassword123",
      name: "New User",
    });
    const response = await signupPost(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it("returns 400 when email is invalid format", async () => {
    const request = createJsonRequest("/api/signup", {
      email: "not-an-email",
      password: "validpassword123",
      name: "New User",
    });
    const response = await signupPost(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid email address");
  });

  it("returns 400 when password is too short", async () => {
    const request = createJsonRequest("/api/signup", {
      email: "new@example.com",
      password: "short",
      name: "New User",
    });
    const response = await signupPost(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Password must be at least 6 characters");
  });

  it("returns 400 when name is missing", async () => {
    const request = createJsonRequest("/api/signup", {
      email: "new@example.com",
      password: "validpassword123",
    });
    const response = await signupPost(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it("returns 400 when email is already registered", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(EXISTING_USER as any);

    const request = createJsonRequest("/api/signup", {
      email: "existing@example.com",
      password: "validpassword123",
      name: "Duplicate User",
    });
    const response = await signupPost(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Email already registered");
  });

  it("creates user with hashed password and returns 201", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockBcryptHash.mockResolvedValue("$2a$10$newhashedpassword");

    const createdUser = {
      id: "new-user-id",
      email: "new@example.com",
      name: "New User",
      role: "user",
    };
    mockPrisma.user.create.mockResolvedValue(createdUser as any);

    const request = createJsonRequest("/api/signup", {
      email: "new@example.com",
      password: "validpassword123",
      name: "New User",
    });
    const response = await signupPost(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.id).toBe("new-user-id");
    expect(body.email).toBe("new@example.com");
    expect(body.name).toBe("New User");
  });

  it("does not return password hash in signup response", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockBcryptHash.mockResolvedValue("$2a$10$newhashedpassword");

    const createdUser = {
      id: "new-user-id",
      email: "new@example.com",
      name: "New User",
      role: "user",
      password: "$2a$10$newhashedpassword",
    };
    mockPrisma.user.create.mockResolvedValue(createdUser as any);

    const request = createJsonRequest("/api/signup", {
      email: "new@example.com",
      password: "validpassword123",
      name: "New User",
    });
    const response = await signupPost(request);
    const body = await response.json();

    expect(body.password).toBeUndefined();
  });

  it("hashes password with bcrypt salt rounds of 10", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockBcryptHash.mockResolvedValue("$2a$10$newhashedpassword");

    const createdUser = {
      id: "new-user-id",
      email: "new@example.com",
      name: "New User",
      role: "user",
    };
    mockPrisma.user.create.mockResolvedValue(createdUser as any);

    const request = createJsonRequest("/api/signup", {
      email: "new@example.com",
      password: "mySecurePassword",
      name: "New User",
    });
    await signupPost(request);

    expect(mockBcryptHash).toHaveBeenCalledWith("mySecurePassword", 10);
  });

  it("creates user with role set to user", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockBcryptHash.mockResolvedValue("$2a$10$hashedvalue");

    const createdUser = {
      id: "new-user-id",
      email: "new@example.com",
      name: "New User",
      role: "user",
    };
    mockPrisma.user.create.mockResolvedValue(createdUser as any);

    const request = createJsonRequest("/api/signup", {
      email: "new@example.com",
      password: "validpassword123",
      name: "New User",
    });
    await signupPost(request);

    expect(mockPrisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: "new@example.com",
        password: "$2a$10$hashedvalue",
        name: "New User",
        role: "user",
      }),
    });
  });
});
