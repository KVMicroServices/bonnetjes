import { logger } from "@/lib/logger";
import { loadSyncConfiguration } from "./config";
import { executeTick as executeTickInternal } from "./sync-engine";
import type { SyncConfiguration, SyncInstrumentationHook, SyncTickResult } from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────

const JITTER_PERCENTAGE = 0.1;
const MILLISECONDS_PER_SECOND = 1000;

// ─── Singleton State ──────────────────────────────────────────────────────────

let activeIntervalHandle: ReturnType<typeof setTimeout> | null = null;
let isLoopRunning = false;
let currentInstrumentationHook: SyncInstrumentationHook | undefined;

// ─── Public API ───────────────────────────────────────────────────────────────

export function startSyncLoop(instrumentationHook?: SyncInstrumentationHook): boolean {
  if (isLoopRunning) {
    logger.warn("Sync loop is already running, ignoring duplicate start request");
    return false;
  }

  const configuration = loadSyncConfiguration();
  if (!configuration) {
    logger.warn("Sync loop not started due to missing configuration");
    return false;
  }

  currentInstrumentationHook = instrumentationHook;
  isLoopRunning = true;

  logger.info(
    {
      pollIntervalSeconds: configuration.pollIntervalSeconds,
      tenantCount: configuration.kvPublicationApiTokens.length,
    },
    "Starting receipt sync loop"
  );

  scheduleNextTick(configuration);
  return true;
}

export function stopSyncLoop(): void {
  if (!isLoopRunning) {
    return;
  }

  if (activeIntervalHandle) {
    clearTimeout(activeIntervalHandle);
    activeIntervalHandle = null;
  }

  isLoopRunning = false;
  currentInstrumentationHook = undefined;

  logger.info("Receipt sync loop stopped");
}

export async function executeTick(): Promise<ReadonlyArray<SyncTickResult>> {
  const configuration = loadSyncConfiguration();
  if (!configuration) {
    logger.warn("Cannot execute tick: missing configuration");
    return [];
  }

  return executeTickInternal(configuration, currentInstrumentationHook);
}

export function isSyncLoopRunning(): boolean {
  return isLoopRunning;
}

// ─── Internal Scheduling ──────────────────────────────────────────────────────

function scheduleNextTick(configuration: SyncConfiguration): void {
  if (!isLoopRunning) {
    return;
  }

  const baseIntervalMilliseconds = configuration.pollIntervalSeconds * MILLISECONDS_PER_SECOND;
  const jitterMilliseconds = computeJitter(configuration.pollIntervalSeconds);
  const totalDelayMilliseconds = baseIntervalMilliseconds + jitterMilliseconds;

  activeIntervalHandle = setTimeout(async () => {
    if (!isLoopRunning) {
      return;
    }

    try {
      // Re-read configuration on each tick to pick up runtime changes
      const freshConfiguration = loadSyncConfiguration();
      if (!freshConfiguration) {
        logger.warn("Skipping tick due to missing configuration");
        scheduleNextTick(configuration);
        return;
      }

      await executeTickInternal(freshConfiguration, currentInstrumentationHook);
      scheduleNextTick(freshConfiguration);
    } catch (error: unknown) {
      logger.error({ error }, "Unhandled error during sync tick");
      scheduleNextTick(configuration);
    }
  }, totalDelayMilliseconds);
}

// ─── Jitter Computation ───────────────────────────────────────────────────────

export function computeJitter(pollIntervalSeconds: number): number {
  const maxJitterMilliseconds = pollIntervalSeconds * MILLISECONDS_PER_SECOND * JITTER_PERCENTAGE;
  const jitterMilliseconds = Math.random() * maxJitterMilliseconds;
  return Math.floor(jitterMilliseconds);
}
