import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

// ─── Types ───────────────────────────────────────────────────────────────────

export type AuditCategory =
  | "ai_judgement"
  | "secondary_analysis"
  | "moderation"
  | "comment"
  | "user_management"
  | "settings"
  | "system";

export interface AuditLogEntry {
  id: string;
  category: string;
  action: string;
  actorId: string | null;
  metadata: string | null;
  createdAt: Date;
}

export interface AuditQueryResult {
  entries: ReadonlyArray<AuditLogEntry>;
  nextCursor: string | null;
  hasMore: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 25;

// ─── Writer (fire-and-forget) ────────────────────────────────────────────────

/**
 * Records an audit event without blocking the caller.
 * Errors are caught internally and logged — never propagated.
 */
export function recordAuditEvent(
  category: AuditCategory,
  action: string,
  actorId?: string,
  metadata?: Record<string, unknown>
): void {
  let serializedMetadata: string | null = null;
  if (metadata) {
    serializedMetadata = JSON.stringify(metadata);
  }

  let resolvedActorId: string | null = null;
  if (actorId) {
    resolvedActorId = actorId;
  }

  prisma.auditLog
    .create({
      data: {
        category,
        action,
        actorId: resolvedActorId,
        metadata: serializedMetadata,
      },
    })
    .catch((error: unknown) => {
      logger.error(
        { category, action, error },
        "Failed to record audit event"
      );
    });
}

// ─── Query ───────────────────────────────────────────────────────────────────

/**
 * Fetches audit log entries for a specific receipt by searching the metadata JSON.
 * Matches entries where receiptId OR originalReceiptId equals the given ID.
 * Orders by createdAt ascending (oldest first) for timeline display.
 */
export async function getAuditLogsForReceipt(receiptId: string): Promise<ReadonlyArray<AuditLogEntry>> {
  const entries = await prisma.auditLog.findMany({
    where: {
      metadata: {
        contains: receiptId,
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const filtered: AuditLogEntry[] = [];
  for (const entry of entries) {
    if (!entry.metadata) {
      continue;
    }
    try {
      const parsed = JSON.parse(entry.metadata) as Record<string, unknown>;
      if (parsed.receiptId === receiptId || parsed.originalReceiptId === receiptId) {
        filtered.push(entry);
      }
    } catch {
      continue;
    }
  }

  return filtered;
}

/**
 * Fetches audit log entries with cursor-based pagination.
 * Orders by createdAt descending (newest first).
 */
export async function getAuditLogs(options: {
  category?: AuditCategory;
  cursor?: string;
  limit?: number;
}): Promise<AuditQueryResult> {
  let limit: number = DEFAULT_PAGE_SIZE;
  if (options.limit) {
    limit = options.limit;
  }

  const fetchCount: number = limit + 1;

  const whereClause: { category?: AuditCategory } = {};
  if (options.category) {
    whereClause.category = options.category;
  }

  let entries: AuditLogEntry[];

  if (options.cursor) {
    entries = await prisma.auditLog.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
      take: fetchCount,
      cursor: { id: options.cursor },
      skip: 1,
    });
  } else {
    entries = await prisma.auditLog.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
      take: fetchCount,
    });
  }

  const hasMore: boolean = entries.length > limit;

  if (hasMore) {
    entries.pop();
  }

  let nextCursor: string | null = null;
  const lastEntry = entries[entries.length - 1];
  if (hasMore && lastEntry) {
    nextCursor = lastEntry.id;
  }

  return {
    entries,
    nextCursor,
    hasMore,
  };
}
