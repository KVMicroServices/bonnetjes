import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { z } from "zod";

// ─── Dependencies ────────────────────────────────────────────────────────────

export interface AuthServiceDependencies {
  database: PrismaClient;
}

// ─── Schemas ─────────────────────────────────────────────────────────────────

const signupSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  name: z.string().min(1, "Name is required"),
});

export type SignupInput = z.infer<typeof signupSchema>;

// ─── Result Types ────────────────────────────────────────────────────────────

export interface ValidatedUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
}

export interface RegisteredUser {
  id: string;
  email: string;
  name: string | null;
}

export type CredentialValidationResult =
  | { success: true; user: ValidatedUser }
  | { success: false; error: string };

export type RegistrationResult =
  | { success: true; user: RegisteredUser }
  | { success: false; error: string; validationError?: boolean };

export type TokenRefreshResult =
  | { success: true; accessToken: string }
  | { success: false; error: string };

// ─── Constants ───────────────────────────────────────────────────────────────

const TOKEN_EXPIRY_BUFFER_MILLISECONDS = 5 * 60 * 1000;
const BCRYPT_SALT_ROUNDS = 10;
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

// ─── Service Functions ───────────────────────────────────────────────────────

/** Validate user credentials against stored bcrypt hash. */
export async function validateCredentials(
  dependencies: AuthServiceDependencies,
  email: string,
  password: string
): Promise<CredentialValidationResult> {
  const user = await dependencies.database.user.findUnique({
    where: { email },
  });

  if (!user || !user.password) {
    return { success: false, error: "Invalid credentials" };
  }

  const isPasswordValid = await bcrypt.compare(password, user.password);

  if (!isPasswordValid) {
    return { success: false, error: "Invalid credentials" };
  }

  return {
    success: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
  };
}

/** Validate input, hash password, and create a new user. */
export async function registerUser(
  dependencies: AuthServiceDependencies,
  input: unknown
): Promise<RegistrationResult> {
  const parseResult = signupSchema.safeParse(input);

  if (!parseResult.success) {
    const firstError = parseResult.error.errors[0];
    const errorMessage = firstError ? firstError.message : "Validation error";
    return { success: false, error: errorMessage, validationError: true };
  }

  const validatedData = parseResult.data;

  const existingUser = await dependencies.database.user.findUnique({
    where: { email: validatedData.email },
  });

  if (existingUser) {
    return { success: false, error: "Email already registered" };
  }

  const hashedPassword = await bcrypt.hash(
    validatedData.password,
    BCRYPT_SALT_ROUNDS
  );

  const user = await dependencies.database.user.create({
    data: {
      email: validatedData.email,
      password: hashedPassword,
      name: validatedData.name,
      role: "user",
    },
  });

  return {
    success: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
  };
}

/** Refresh a Google OAuth access token and persist the new token to the database. */
export async function refreshGoogleToken(
  dependencies: AuthServiceDependencies,
  accountId: string
): Promise<TokenRefreshResult> {
  const account = await dependencies.database.account.findFirst({
    where: { id: accountId },
  });

  if (!account) {
    return { success: false, error: "Account not found" };
  }

  if (!account.refresh_token) {
    return { success: false, error: "No refresh token available" };
  }

  const isExpired = account.expires_at
    && (account.expires_at * 1000) < (Date.now() + TOKEN_EXPIRY_BUFFER_MILLISECONDS);

  if (!isExpired && account.access_token) {
    return { success: true, accessToken: account.access_token };
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return { success: false, error: "Google OAuth credentials not configured" };
  }

  const requestBody = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: account.refresh_token,
    grant_type: "refresh_token",
  });

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: requestBody,
  });

  if (!response.ok) {
    return { success: false, error: "Token refresh request failed" };
  }

  const tokens = await response.json();

  const newExpiresAt = Math.floor(Date.now() / 1000) + tokens.expires_in;

  await dependencies.database.account.update({
    where: { id: account.id },
    data: {
      access_token: tokens.access_token,
      expires_at: newExpiresAt,
    },
  });

  return { success: true, accessToken: tokens.access_token };
}
