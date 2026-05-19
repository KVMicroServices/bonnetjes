export { mockPrisma, setupPrismaMock } from "./mock-prisma";
export type { MockPrismaClient } from "./mock-prisma";

export { mockS3Functions, setupS3Mock } from "./mock-s3";
export type { MockS3Functions } from "./mock-s3";

export {
  createUserSession,
  createAdminSession,
  createGoogleSession,
  createUnauthenticatedSession,
  mockGetServerSession,
} from "./mock-session";
export type { MockSession } from "./mock-session";

export {
  setupFetchMock,
  createJsonResponse,
  createTextResponse,
  createErrorResponse,
  createNetworkError,
} from "./mock-fetch";
export type { MockFetchResponse, MockFetchFunction } from "./mock-fetch";
