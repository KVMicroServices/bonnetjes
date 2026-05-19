import { vi, beforeEach, afterEach } from "vitest";

export interface MockFetchResponse {
  status?: number;
  ok?: boolean;
  headers?: Record<string, string>;
  body?: unknown;
  text?: string;
}

export type MockFetchFunction = ReturnType<typeof vi.fn>;

/**
 * Creates a mock Response object matching the Fetch API interface.
 */
function createMockResponse(config: MockFetchResponse): Response {
  const status = config.status ?? 200;
  const ok = config.ok ?? (status >= 200 && status < 300);
  const bodyContent = config.body !== undefined
    ? JSON.stringify(config.body)
    : (config.text ?? "");

  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    headers: new Headers(config.headers ?? {}),
    json: () => Promise.resolve(config.body),
    text: () => Promise.resolve(bodyContent),
    blob: () => Promise.resolve(new Blob([bodyContent])),
    arrayBuffer: () => Promise.resolve(new TextEncoder().encode(bodyContent).buffer),
    clone: function () { return this; },
    body: null,
    bodyUsed: false,
    redirected: false,
    type: "basic",
    url: "",
    formData: () => Promise.resolve(new FormData()),
    bytes: () => Promise.resolve(new Uint8Array()),
  } as unknown as Response;
}

/**
 * Sets up a global fetch mock for the current test file.
 * Returns the mock function so you can configure responses per test.
 *
 * Usage:
 *   const fetchMock = setupFetchMock();
 *   fetchMock.mockResolvedValueOnce(createJsonResponse({ data: "value" }));
 */
export function setupFetchMock(): MockFetchFunction {
  const mockFetch: MockFetchFunction = vi.fn();

  beforeEach(() => {
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  return mockFetch;
}

/**
 * Creates a successful JSON response for use with the fetch mock.
 */
export function createJsonResponse(body: unknown, status: number = 200): Response {
  return createMockResponse({
    status,
    body,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Creates a text response for use with the fetch mock.
 */
export function createTextResponse(text: string, status: number = 200): Response {
  return createMockResponse({
    status,
    text,
    headers: { "content-type": "text/plain" },
  });
}

/**
 * Creates an error response for use with the fetch mock.
 */
export function createErrorResponse(status: number, body?: unknown): Response {
  return createMockResponse({
    status,
    ok: false,
    body: body ?? { error: "Request failed" },
  });
}

/**
 * Creates a response that simulates a network failure.
 * Use with mockFetch.mockRejectedValueOnce(createNetworkError()).
 */
export function createNetworkError(message: string = "Network error"): Error {
  return new Error(message);
}
