/**
 * Client-side logger for browser environments.
 * Wraps console methods behind a structured interface consistent with the server logger.
 * In production, this could be extended to send logs to a remote service.
 */

const LOG_LEVEL = process.env.NEXT_PUBLIC_LOG_LEVEL || "info";

const LEVELS: Readonly<Record<string, number>> = {
  error: 50,
  warn: 40,
  info: 30,
  debug: 20,
};

function shouldLog(level: string): boolean {
  const currentLevel = LEVELS[LOG_LEVEL] || LEVELS.info;
  const targetLevel = LEVELS[level] || LEVELS.info;
  return targetLevel >= currentLevel;
}

export const clientLogger = {
  error(context: Record<string, unknown>, message: string): void {
    if (shouldLog("error")) {
      // eslint-disable-next-line no-console
      console.error(message, context);
    }
  },

  warn(context: Record<string, unknown>, message: string): void {
    if (shouldLog("warn")) {
      // eslint-disable-next-line no-console
      console.warn(message, context);
    }
  },

  info(context: Record<string, unknown>, message: string): void {
    if (shouldLog("info")) {
      // eslint-disable-next-line no-console
      console.info(message, context);
    }
  },

  debug(context: Record<string, unknown>, message: string): void {
    if (shouldLog("debug")) {
      // eslint-disable-next-line no-console
      console.debug(message, context);
    }
  },
};
