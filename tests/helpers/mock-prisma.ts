import { PrismaClient } from "@prisma/client";
import { mockDeep, mockReset, DeepMockProxy } from "vitest-mock-extended";
import { beforeEach, vi } from "vitest";

export type MockPrismaClient = DeepMockProxy<PrismaClient>;

export const mockPrisma: MockPrismaClient = mockDeep<PrismaClient>();

/**
 * Sets up the Prisma mock for the current test file.
 * Call this in a beforeEach or at the top of your test file.
 * Automatically resets all mock state between tests.
 */
export function setupPrismaMock(): MockPrismaClient {
  vi.mock("@/lib/db", () => ({
    prisma: mockPrisma,
  }));

  beforeEach(() => {
    mockReset(mockPrisma);
  });

  return mockPrisma;
}
