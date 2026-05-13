export async function register() {
  // Only start the sync loop on the server side (not during build or edge runtime)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startSyncLoop } = await import("@/lib/receipt-sync");
    startSyncLoop();
  }
}
