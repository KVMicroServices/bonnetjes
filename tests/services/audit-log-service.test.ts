import { describe, it, expect, beforeEach, vi } from "vitest";
import { setupPrismaMock, MockPrismaClient } from "../helpers/mock-prisma";

// ─── Mock Setup ──────────────────────────────────────────────────────────────

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: mockLogger,
}));

const mockPrisma: MockPrismaClient = setupPrismaMock();

// ─── Import After Mocks ─────────────────────────────────────────────────────

import {
  recordAuditEvent,
  getAuditLogs,
} from "@/lib/services/audit-log-service";

// ─── Constants ───────────────────────────────────────────────────────────────

const SAMPLE_CATEGORY = "moderation";
const SAMPLE_ACTION = "receipt_approved";
const SAMPLE_ACTOR_ID = "user-abc-123";
const SAMPLE_METADATA = { receiptId: "receipt-001", action: "approved" };
const DEFAULT_PAGE_SIZE = 25;

// ─── Fixtures ────────────────────────────────────────────────────────────────

function createAuditLogEntry(overrides: Partial<{
  id: string;
  category: string;
  action: string;
  actorId: string | null;
  metadata: string | null;
  createdAt: Date;
}> = {}) {
  return {
    id: overrides.id || "entry-001",
    category: overrides.category || SAMPLE_CATEGORY,
    action: overrides.action || SAMPLE_ACTION,
    actorId: overrides.actorId !== undefined ? overrides.actorId : SAMPLE_ACTOR_ID,
    metadata: overrides.metadata !== undefined ? overrides.metadata : JSON.stringify(SAMPLE_METADATA),
    createdAt: overrides.createdAt || new Date("2024-06-01T12:00:00Z"),
  };
}

function createEntryList(count: number, categoryOverride?: string): Array<ReturnType<typeof createAuditLogEntry>> {
  const entries: Array<ReturnType<typeof createAuditLogEntry>> = [];
  for (let index = 0; index < count; index++) {
    const entry = createAuditLogEntry({
      id: `entry-${String(index).padStart(3, "0")}`,
      category: categoryOverride || SAMPLE_CATEGORY,
      createdAt: new Date(Date.now() - index * 60000),
    });
    entries.push(entry);
  }
  return entries;
}

// ─── Tests: Writer Error Isolation ───────────────────────────────────────────

describe("recordAuditEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls prisma.auditLog.create with correct data", () => {
    mockPrisma.auditLog.create.mockResolvedValue(createAuditLogEntry() as never);

    recordAuditEvent(SAMPLE_CATEGORY, SAMPLE_ACTION, SAMPLE_ACTOR_ID, SAMPLE_METADATA);

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        category: SAMPLE_CATEGORY,
        action: SAMPLE_ACTION,
        actorId: SAMPLE_ACTOR_ID,
        metadata: JSON.stringify(SAMPLE_METADATA),
      },
    });
  });

  it("returns void synchronously without awaiting the database call", () => {
    mockPrisma.auditLog.create.mockResolvedValue(createAuditLogEntry() as never);

    const result = recordAuditEvent(SAMPLE_CATEGORY, SAMPLE_ACTION);

    expect(result).toBeUndefined();
  });

  it("does not propagate database errors to the caller", async () => {
    const databaseError = new Error("Connection refused");
    mockPrisma.auditLog.create.mockRejectedValue(databaseError as never);

    expect(() => {
      recordAuditEvent(SAMPLE_CATEGORY, SAMPLE_ACTION);
    }).not.toThrow();

    await vi.waitFor(() => {
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  it("logs the error with category and action when the write fails", async () => {
    const databaseError = new Error("Timeout");
    mockPrisma.auditLog.create.mockRejectedValue(databaseError as never);

    recordAuditEvent(SAMPLE_CATEGORY, SAMPLE_ACTION);

    await vi.waitFor(() => {
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          category: SAMPLE_CATEGORY,
          action: SAMPLE_ACTION,
          error: databaseError,
        }),
        "Failed to record audit event"
      );
    });
  });

  it("passes null for actorId when not provided", () => {
    mockPrisma.auditLog.create.mockResolvedValue(createAuditLogEntry() as never);

    recordAuditEvent(SAMPLE_CATEGORY, SAMPLE_ACTION);

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        category: SAMPLE_CATEGORY,
        action: SAMPLE_ACTION,
        actorId: null,
        metadata: null,
      },
    });
  });

  it("serializes metadata to JSON string", () => {
    const complexMetadata = { receiptId: "r-123", verdict: "rejected", confidence: 0.95 };
    mockPrisma.auditLog.create.mockResolvedValue(createAuditLogEntry() as never);

    recordAuditEvent(SAMPLE_CATEGORY, SAMPLE_ACTION, SAMPLE_ACTOR_ID, complexMetadata);

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        category: SAMPLE_CATEGORY,
        action: SAMPLE_ACTION,
        actorId: SAMPLE_ACTOR_ID,
        metadata: JSON.stringify(complexMetadata),
      },
    });
  });
});

// ─── Tests: Query Pagination ─────────────────────────────────────────────────

describe("getAuditLogs - pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns entries, nextCursor, and hasMore in the result", async () => {
    const entries = createEntryList(3);
    mockPrisma.auditLog.findMany.mockResolvedValue(entries as never);

    const result = await getAuditLogs({});

    expect(result).toHaveProperty("entries");
    expect(result).toHaveProperty("nextCursor");
    expect(result).toHaveProperty("hasMore");
  });

  it("uses default page size of 25", async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([] as never);

    await getAuditLogs({});

    const expectedFetchCount: number = DEFAULT_PAGE_SIZE + 1;
    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: expectedFetchCount,
      })
    );
  });

  it("sets hasMore to true and nextCursor to last entry id when more entries exist", async () => {
    const entriesPlusOne = createEntryList(DEFAULT_PAGE_SIZE + 1);
    mockPrisma.auditLog.findMany.mockResolvedValue(entriesPlusOne as never);

    const result = await getAuditLogs({});

    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe(`entry-${String(DEFAULT_PAGE_SIZE - 1).padStart(3, "0")}`);
    expect(result.entries).toHaveLength(DEFAULT_PAGE_SIZE);
  });

  it("sets hasMore to false and nextCursor to null when no more entries exist", async () => {
    const entries = createEntryList(10);
    mockPrisma.auditLog.findMany.mockResolvedValue(entries as never);

    const result = await getAuditLogs({});

    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
    expect(result.entries).toHaveLength(10);
  });

  it("uses cursor with skip 1 when cursor is provided", async () => {
    const cursorValue = "entry-cursor-abc";
    mockPrisma.auditLog.findMany.mockResolvedValue([] as never);

    await getAuditLogs({ cursor: cursorValue });

    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: cursorValue },
        skip: 1,
      })
    );
  });

  it("does not include cursor or skip when no cursor is provided", async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([] as never);

    await getAuditLogs({});

    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.not.objectContaining({
        cursor: expect.anything(),
        skip: expect.anything(),
      })
    );
  });

  it("orders results by createdAt descending", async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([] as never);

    await getAuditLogs({});

    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: "desc" },
      })
    );
  });
});

// ─── Tests: Category Filtering ───────────────────────────────────────────────

describe("getAuditLogs - category filtering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filters by category when category is provided", async () => {
    const filterCategory = "ai_judgement";
    mockPrisma.auditLog.findMany.mockResolvedValue([] as never);

    await getAuditLogs({ category: filterCategory });

    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { category: filterCategory },
      })
    );
  });

  it("does not include category in where clause when no category is provided", async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([] as never);

    await getAuditLogs({});

    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
      })
    );
  });

  it("returns only entries matching the requested category", async () => {
    const moderationEntries = createEntryList(5, "moderation");
    mockPrisma.auditLog.findMany.mockResolvedValue(moderationEntries as never);

    const result = await getAuditLogs({ category: "moderation" });

    expect(result.entries).toHaveLength(5);
    for (const entry of result.entries) {
      expect(entry.category).toBe("moderation");
    }
  });

  it("returns all entries when no category filter is applied", async () => {
    const mixedEntries = [
      createAuditLogEntry({ id: "entry-a", category: "moderation" }),
      createAuditLogEntry({ id: "entry-b", category: "ai_judgement" }),
      createAuditLogEntry({ id: "entry-c", category: "system" }),
    ];
    mockPrisma.auditLog.findMany.mockResolvedValue(mixedEntries as never);

    const result = await getAuditLogs({});

    expect(result.entries).toHaveLength(3);
  });
});
