import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getSmtpSettings } from "@/lib/services/app-settings-service";

// ─── Types ───────────────────────────────────────────────────────────────────

export type NotificationType =
  | "receipt_requires_review"
  | "receipt_processed"
  | "review_disabled"
  | "dispute_outcome"
  | "role_changed"
  | "comment_mention";

export type NotificationChannel = "none" | "in_app" | "email";

export interface NotificationEntry {
  id: string;
  type: string;
  title: string;
  body: string;
  metadata: string | null;
  createdAt: Date;
}

export interface NotificationPreferenceEntry {
  type: NotificationType;
  channel: NotificationChannel;
}

export interface CreateNotificationParams {
  type: NotificationType;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_CHANNEL: NotificationChannel = "in_app";
const NOTIFICATIONS_PAGE_SIZE = 20;

export const NOTIFICATION_TYPES: ReadonlyArray<NotificationType> = [
  "receipt_requires_review",
  "receipt_processed",
  "review_disabled",
  "dispute_outcome",
  "role_changed",
  "comment_mention",
];

// ─── Notification Writer ─────────────────────────────────────────────────────

/**
 * Creates a global notification visible to all users.
 * Also sends email to users who have email preference for this type.
 * Fire-and-forget — errors are logged internally, never propagated.
 */
export function sendNotification(params: CreateNotificationParams): void {
  handleNotification(params).catch((error: unknown) => {
    logger.error(
      { type: params.type, error },
      "Failed to send notification"
    );
  });
}

async function handleNotification(params: CreateNotificationParams): Promise<void> {
  let serializedMetadata: string | null = null;
  if (params.metadata) {
    serializedMetadata = JSON.stringify(params.metadata);
  }

  await prisma.notification.create({
    data: {
      type: params.type,
      title: params.title,
      body: params.body,
      metadata: serializedMetadata,
    },
  });

  // Send emails to users who have email preference for this notification type
  await sendEmailsForNotification(params);
}

// ─── Email Delivery ──────────────────────────────────────────────────────────

async function sendEmailsForNotification(params: CreateNotificationParams): Promise<void> {
  const emailPreferences = await prisma.notificationPreference.findMany({
    where: { type: params.type, channel: "email" },
    select: { userId: true },
  });

  if (emailPreferences.length === 0) {
    return;
  }

  const userIds = emailPreferences.map((preference) => preference.userId);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { email: true, name: true },
  });

  for (const user of users) {
    sendSingleEmail(user.email, params.title, params.body).catch((error: unknown) => {
      logger.warn(
        { email: user.email, type: params.type, error },
        "Failed to send notification email to user"
      );
    });
  }
}

async function sendSingleEmail(
  recipientEmail: string,
  title: string,
  body: string
): Promise<void> {
  const smtp = await getSmtpSettings();

  if (!smtp.smtpHost || !smtp.smtpPort || !smtp.smtpUser || !smtp.smtpPass || !smtp.smtpFrom) {
    logger.warn("SMTP not configured, skipping notification email");
    return;
  }

  const { createTransport } = await import("nodemailer");

  const SECURE_SMTP_PORT = 465;
  const portNumber = Number(smtp.smtpPort);

  const transport = createTransport({
    host: smtp.smtpHost,
    port: portNumber,
    secure: portNumber === SECURE_SMTP_PORT,
    auth: { user: smtp.smtpUser, pass: smtp.smtpPass },
  });

  const htmlBody = buildNotificationEmailHtml(title, body);

  await transport.sendMail({
    from: smtp.smtpFrom,
    to: recipientEmail,
    subject: title,
    html: htmlBody,
  });

  logger.info(
    { recipientEmail },
    "Notification email sent"
  );
}

function buildNotificationEmailHtml(title: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 24px; color: #1f2937;">
  <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 32px;">
    <h2 style="margin: 0 0 16px; font-size: 18px; color: #111827;">${escapeHtml(title)}</h2>
    <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #4b5563;">${escapeHtml(body)}</p>
  </div>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Preference Management ───────────────────────────────────────────────────

export async function getUserPreferences(
  userId: string
): Promise<ReadonlyArray<NotificationPreferenceEntry>> {
  const preferences = await prisma.notificationPreference.findMany({
    where: { userId },
  });

  const preferenceMap = new Map<string, NotificationChannel>();
  for (const preference of preferences) {
    preferenceMap.set(preference.type, preference.channel as NotificationChannel);
  }

  const result: NotificationPreferenceEntry[] = [];
  for (const type of NOTIFICATION_TYPES) {
    const channel = preferenceMap.get(type);
    if (channel) {
      result.push({ type, channel });
    } else {
      result.push({ type, channel: DEFAULT_CHANNEL });
    }
  }

  return result;
}

export async function updateUserPreference(
  userId: string,
  type: NotificationType,
  channel: NotificationChannel
): Promise<void> {
  await prisma.notificationPreference.upsert({
    where: { userId_type: { userId, type } },
    update: { channel },
    create: { userId, type, channel },
  });
}

// ─── Notification Queries ────────────────────────────────────────────────────

/**
 * Gets recent notifications from the global feed.
 */
export async function getNotifications(
  options?: { limit?: number }
): Promise<ReadonlyArray<NotificationEntry>> {
  let limit = NOTIFICATIONS_PAGE_SIZE;
  if (options?.limit) {
    limit = options.limit;
  }

  const notifications = await prisma.notification.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return notifications;
}

/**
 * Gets the count of notifications newer than the user's lastNotificationReadAt.
 */
export async function getUnreadCount(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { lastNotificationReadAt: true },
  });

  const whereClause: { createdAt?: { gt: Date } } = {};
  if (user?.lastNotificationReadAt) {
    whereClause.createdAt = { gt: user.lastNotificationReadAt };
  }

  const count = await prisma.notification.count({
    where: whereClause,
  });

  return count;
}

/**
 * Marks all notifications as read by updating the user's lastNotificationReadAt to now.
 */
export async function markAllAsRead(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { lastNotificationReadAt: new Date() },
  });
}
