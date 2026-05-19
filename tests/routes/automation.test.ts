import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  setupPrismaMock,
  createUserSession,
  createAdminSession,
} from "../helpers";

// ─── Mock Setup ────────────────────────────────────────────────────────────────

const mockPrisma = setupPrismaMock();

// Mock next-auth session
const mockGetServerSession = vi.fn();
vi.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

// Mock the automation executor
const mockExecuteWorkflow = vi.fn();
vi.mock("@/lib/automation/executor", () => ({
  executeWorkflow: (...args: unknown[]) => mockExecuteWorkflow(...args),
}));

// ─── Imports (after mocks) ─────────────────────────────────────────────────────

import {
  GET as getWorkflows,
  POST as createWorkflow,
} from "@/app/api/admin/automation/workflows/route";
import {
  GET as getWorkflowById,
  PATCH as patchWorkflow,
  DELETE as deleteWorkflow,
} from "@/app/api/admin/automation/workflows/[id]/route";
import { POST as executeWorkflowRoute } from "@/app/api/admin/automation/execute/route";

// ─── Test Fixtures ─────────────────────────────────────────────────────────────

const SAMPLE_WORKFLOW = {
  id: "workflow-001",
  name: "Login and respond",
  platform: "kv",
  description: "Logs in and responds to a review",
  steps: JSON.stringify([
    { id: "step-1", type: "navigate", url: "https://example.com", description: "Go to login" },
    { id: "step-2", type: "type", selector: "#email", value: "{{username}}", description: "Enter username" },
    { id: "step-3", type: "type", selector: "#password", value: "{{password}}", description: "Enter password" },
    { id: "step-4", type: "click", selector: "#submit", description: "Click login" },
  ]),
  isActive: true,
  createdAt: new Date("2024-01-10T10:00:00Z"),
  updatedAt: new Date("2024-01-15T10:00:00Z"),
};

const SAMPLE_WORKFLOW_INACTIVE = {
  ...SAMPLE_WORKFLOW,
  id: "workflow-002",
  name: "Disabled workflow",
  isActive: false,
};

// ─── Helper Functions ──────────────────────────────────────────────────────────

function createPostRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createPatchRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createDeleteRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method: "DELETE",
  });
}

// ─── Tests: GET /api/admin/automation/workflows ────────────────────────────────

describe("GET /api/admin/automation/workflows", () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await getWorkflows();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when user is not an admin", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    const response = await getWorkflows();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns all workflows for admin", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.automationWorkflow.findMany.mockResolvedValue([SAMPLE_WORKFLOW] as any);

    const response = await getWorkflows();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.workflows).toHaveLength(1);
    expect(body.workflows[0].id).toBe("workflow-001");
    expect(body.workflows[0].name).toBe("Login and respond");
  });

  it("returns workflows ordered by updatedAt descending", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.automationWorkflow.findMany.mockResolvedValue([]);

    await getWorkflows();

    expect(mockPrisma.automationWorkflow.findMany).toHaveBeenCalledWith({
      orderBy: { updatedAt: "desc" },
    });
  });
});

// ─── Tests: POST /api/admin/automation/workflows ───────────────────────────────

describe("POST /api/admin/automation/workflows", () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createPostRequest("/api/admin/automation/workflows", {
      name: "Test Workflow",
      platform: "kv",
      steps: [],
    });
    const response = await createWorkflow(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when user is not an admin", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    const request = createPostRequest("/api/admin/automation/workflows", {
      name: "Test Workflow",
      platform: "kv",
      steps: [],
    });
    const response = await createWorkflow(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 400 when required fields are missing", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    const request = createPostRequest("/api/admin/automation/workflows", {
      name: "Test Workflow",
    });
    const response = await createWorkflow(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Missing required fields");
  });

  it("creates a workflow with valid input", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    const inputSteps = [
      { id: "step-1", type: "navigate", url: "https://example.com", description: "Go to page" },
    ];

    const createdWorkflow = {
      id: "workflow-new",
      name: "New Workflow",
      platform: "kiyoh",
      description: "A new workflow",
      steps: JSON.stringify(inputSteps),
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockPrisma.automationWorkflow.create.mockResolvedValue(createdWorkflow as any);

    const request = createPostRequest("/api/admin/automation/workflows", {
      name: "New Workflow",
      platform: "kiyoh",
      description: "A new workflow",
      steps: inputSteps,
    });
    const response = await createWorkflow(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.workflow.id).toBe("workflow-new");
    expect(body.workflow.name).toBe("New Workflow");
    expect(body.workflow.platform).toBe("kiyoh");

    expect(mockPrisma.automationWorkflow.create).toHaveBeenCalledWith({
      data: {
        name: "New Workflow",
        platform: "kiyoh",
        description: "A new workflow",
        steps: JSON.stringify(inputSteps),
        isActive: true,
      },
    });
  });

  it("creates a workflow with null description when not provided", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    const inputSteps = [
      { id: "step-1", type: "click", selector: "#btn", description: "Click button" },
    ];

    mockPrisma.automationWorkflow.create.mockResolvedValue({
      id: "workflow-no-desc",
      name: "No Desc",
      platform: "kv",
      description: null,
      steps: JSON.stringify(inputSteps),
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    const request = createPostRequest("/api/admin/automation/workflows", {
      name: "No Desc",
      platform: "kv",
      steps: inputSteps,
    });
    const response = await createWorkflow(request);

    expect(response.status).toBe(200);

    expect(mockPrisma.automationWorkflow.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        description: null,
      }),
    });
  });
});

// ─── Tests: GET /api/admin/automation/workflows/[id] ───────────────────────────

describe("GET /api/admin/automation/workflows/[id]", () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = new NextRequest(new URL("http://localhost:3000/api/admin/automation/workflows/workflow-001"));
    const response = await getWorkflowById(request, { params: { id: "workflow-001" } } as any);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when user is not an admin", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    const request = new NextRequest(new URL("http://localhost:3000/api/admin/automation/workflows/workflow-001"));
    const response = await getWorkflowById(request, { params: { id: "workflow-001" } } as any);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 404 when workflow does not exist", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.automationWorkflow.findUnique.mockResolvedValue(null);

    const request = new NextRequest(new URL("http://localhost:3000/api/admin/automation/workflows/nonexistent"));
    const response = await getWorkflowById(request, { params: { id: "nonexistent" } } as any);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("Not found");
  });

  it("returns workflow with parsed steps for admin", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.automationWorkflow.findUnique.mockResolvedValue(SAMPLE_WORKFLOW as any);

    const request = new NextRequest(new URL("http://localhost:3000/api/admin/automation/workflows/workflow-001"));
    const response = await getWorkflowById(request, { params: { id: "workflow-001" } } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.workflow.id).toBe("workflow-001");
    expect(body.workflow.steps).toBeInstanceOf(Array);
    expect(body.workflow.steps).toHaveLength(4);
    expect(body.workflow.steps[0].type).toBe("navigate");
  });
});

// ─── Tests: PATCH /api/admin/automation/workflows/[id] ─────────────────────────

describe("PATCH /api/admin/automation/workflows/[id]", () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createPatchRequest("/api/admin/automation/workflows/workflow-001", {
      name: "Updated Name",
    });
    const response = await patchWorkflow(request, { params: { id: "workflow-001" } } as any);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when user is not an admin", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    const request = createPatchRequest("/api/admin/automation/workflows/workflow-001", {
      name: "Updated Name",
    });
    const response = await patchWorkflow(request, { params: { id: "workflow-001" } } as any);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("updates workflow name", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    const updatedWorkflow = { ...SAMPLE_WORKFLOW, name: "Updated Name" };
    mockPrisma.automationWorkflow.update.mockResolvedValue(updatedWorkflow as any);

    const request = createPatchRequest("/api/admin/automation/workflows/workflow-001", {
      name: "Updated Name",
    });
    const response = await patchWorkflow(request, { params: { id: "workflow-001" } } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.workflow.name).toBe("Updated Name");

    expect(mockPrisma.automationWorkflow.update).toHaveBeenCalledWith({
      where: { id: "workflow-001" },
      data: { name: "Updated Name" },
    });
  });

  it("updates workflow steps as stringified JSON", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    const newSteps = [
      { id: "step-new", type: "navigate", url: "https://new.com", description: "New step" },
    ];

    const updatedWorkflow = { ...SAMPLE_WORKFLOW, steps: JSON.stringify(newSteps) };
    mockPrisma.automationWorkflow.update.mockResolvedValue(updatedWorkflow as any);

    const request = createPatchRequest("/api/admin/automation/workflows/workflow-001", {
      steps: newSteps,
    });
    const response = await patchWorkflow(request, { params: { id: "workflow-001" } } as any);

    expect(response.status).toBe(200);

    expect(mockPrisma.automationWorkflow.update).toHaveBeenCalledWith({
      where: { id: "workflow-001" },
      data: { steps: JSON.stringify(newSteps) },
    });
  });

  it("updates workflow isActive flag", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    const updatedWorkflow = { ...SAMPLE_WORKFLOW, isActive: false };
    mockPrisma.automationWorkflow.update.mockResolvedValue(updatedWorkflow as any);

    const request = createPatchRequest("/api/admin/automation/workflows/workflow-001", {
      isActive: false,
    });
    const response = await patchWorkflow(request, { params: { id: "workflow-001" } } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.workflow.isActive).toBe(false);

    expect(mockPrisma.automationWorkflow.update).toHaveBeenCalledWith({
      where: { id: "workflow-001" },
      data: { isActive: false },
    });
  });

  it("updates multiple fields at once", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    const updatedWorkflow = {
      ...SAMPLE_WORKFLOW,
      name: "Multi Update",
      description: "New description",
      platform: "kiyoh",
    };
    mockPrisma.automationWorkflow.update.mockResolvedValue(updatedWorkflow as any);

    const request = createPatchRequest("/api/admin/automation/workflows/workflow-001", {
      name: "Multi Update",
      description: "New description",
      platform: "kiyoh",
    });
    const response = await patchWorkflow(request, { params: { id: "workflow-001" } } as any);

    expect(response.status).toBe(200);

    expect(mockPrisma.automationWorkflow.update).toHaveBeenCalledWith({
      where: { id: "workflow-001" },
      data: {
        name: "Multi Update",
        description: "New description",
        platform: "kiyoh",
      },
    });
  });
});

// ─── Tests: DELETE /api/admin/automation/workflows/[id] ────────────────────────

describe("DELETE /api/admin/automation/workflows/[id]", () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createDeleteRequest("/api/admin/automation/workflows/workflow-001");
    const response = await deleteWorkflow(request, { params: { id: "workflow-001" } } as any);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when user is not an admin", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    const request = createDeleteRequest("/api/admin/automation/workflows/workflow-001");
    const response = await deleteWorkflow(request, { params: { id: "workflow-001" } } as any);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("deletes workflow and returns success", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.automationWorkflow.delete.mockResolvedValue(SAMPLE_WORKFLOW as any);

    const request = createDeleteRequest("/api/admin/automation/workflows/workflow-001");
    const response = await deleteWorkflow(request, { params: { id: "workflow-001" } } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);

    expect(mockPrisma.automationWorkflow.delete).toHaveBeenCalledWith({
      where: { id: "workflow-001" },
    });
  });
});

// ─── Tests: POST /api/admin/automation/execute ─────────────────────────────────

describe("POST /api/admin/automation/execute", () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
    mockExecuteWorkflow.mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createPostRequest("/api/admin/automation/execute", {
      workflowId: "workflow-001",
    });
    const response = await executeWorkflowRoute(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when user is not an admin", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    const request = createPostRequest("/api/admin/automation/execute", {
      workflowId: "workflow-001",
    });
    const response = await executeWorkflowRoute(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 400 when workflowId is missing", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    const request = createPostRequest("/api/admin/automation/execute", {});
    const response = await executeWorkflowRoute(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("workflowId is required");
  });

  it("returns 404 when workflow does not exist", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.automationWorkflow.findUnique.mockResolvedValue(null);

    const request = createPostRequest("/api/admin/automation/execute", {
      workflowId: "nonexistent",
    });
    const response = await executeWorkflowRoute(request);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("Workflow not found");
  });

  it("returns 400 when workflow is disabled", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.automationWorkflow.findUnique.mockResolvedValue(SAMPLE_WORKFLOW_INACTIVE as any);

    const request = createPostRequest("/api/admin/automation/execute", {
      workflowId: "workflow-002",
    });
    const response = await executeWorkflowRoute(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Workflow is disabled");
  });

  it("returns 500 when workflow steps are corrupted", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    const corruptedWorkflow = {
      ...SAMPLE_WORKFLOW,
      steps: "not valid json {{{",
    };
    mockPrisma.automationWorkflow.findUnique.mockResolvedValue(corruptedWorkflow as any);

    const request = createPostRequest("/api/admin/automation/execute", {
      workflowId: "workflow-001",
    });
    const response = await executeWorkflowRoute(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Workflow steps are corrupted");
  });

  it("executes workflow in dry-run mode", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.automationWorkflow.findUnique.mockResolvedValue(SAMPLE_WORKFLOW as any);

    const parsedSteps = JSON.parse(SAMPLE_WORKFLOW.steps);
    const dryRunResult = {
      success: true,
      steps: parsedSteps.map((step: any) => ({ step, status: "ok" })),
    };
    mockExecuteWorkflow.mockResolvedValue(dryRunResult);

    const request = createPostRequest("/api/admin/automation/execute", {
      workflowId: "workflow-001",
      dryRun: true,
    });
    const response = await executeWorkflowRoute(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.dryRun).toBe(true);
    expect(body.workflowName).toBe("Login and respond");
    expect(body.platform).toBe("kv");
    expect(body.stepsTotal).toBe(4);
    expect(body.stepsCompleted).toBe(4);
    expect(body.steps).toHaveLength(4);

    expect(mockExecuteWorkflow).toHaveBeenCalledWith(
      parsedSteps,
      expect.objectContaining({
        username: expect.any(String),
        password: expect.any(String),
      }),
      true,
    );
  });

  it("executes workflow in live mode", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.automationWorkflow.findUnique.mockResolvedValue(SAMPLE_WORKFLOW as any);

    const parsedSteps = JSON.parse(SAMPLE_WORKFLOW.steps);
    const liveResult = {
      success: true,
      steps: parsedSteps.map((step: any) => ({
        step,
        status: "ok",
        screenshot: "data:image/png;base64,fakedata",
      })),
    };
    mockExecuteWorkflow.mockResolvedValue(liveResult);

    const request = createPostRequest("/api/admin/automation/execute", {
      workflowId: "workflow-001",
      variables: { reviewId: "review-123" },
    });
    const response = await executeWorkflowRoute(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.dryRun).toBe(false);
    expect(body.workflowName).toBe("Login and respond");
    expect(body.stepsTotal).toBe(4);
    expect(body.stepsCompleted).toBe(4);
    expect(body.steps[0].screenshot).toBe("data:image/png;base64,fakedata");

    expect(mockExecuteWorkflow).toHaveBeenCalledWith(
      parsedSteps,
      expect.objectContaining({
        reviewId: "review-123",
        username: expect.any(String),
        password: expect.any(String),
      }),
      false,
    );
  });

  it("returns partial results when execution fails mid-workflow", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.automationWorkflow.findUnique.mockResolvedValue(SAMPLE_WORKFLOW as any);

    const parsedSteps = JSON.parse(SAMPLE_WORKFLOW.steps);
    const failedResult = {
      success: false,
      steps: [
        { step: parsedSteps[0], status: "ok", screenshot: "data:image/png;base64,ok" },
        { step: parsedSteps[1], status: "error", error: "Element not found" },
      ],
      error: "Execution stopped at step 2",
    };
    mockExecuteWorkflow.mockResolvedValue(failedResult);

    const request = createPostRequest("/api/admin/automation/execute", {
      workflowId: "workflow-001",
    });
    const response = await executeWorkflowRoute(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.stepsCompleted).toBe(1);
    expect(body.stepsTotal).toBe(4);
    expect(body.steps).toHaveLength(2);
    expect(body.steps[0].status).toBe("ok");
    expect(body.steps[1].status).toBe("error");
    expect(body.steps[1].error).toBe("Element not found");
    expect(body.error).toBe("Execution stopped at step 2");
  });

  it("injects KV credentials for kv platform workflows", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.automationWorkflow.findUnique.mockResolvedValue(SAMPLE_WORKFLOW as any);
    mockExecuteWorkflow.mockResolvedValue({ success: true, steps: [] });

    const request = createPostRequest("/api/admin/automation/execute", {
      workflowId: "workflow-001",
      dryRun: true,
    });
    await executeWorkflowRoute(request);

    const calledVariables = mockExecuteWorkflow.mock.calls[0][1];
    expect(calledVariables).toHaveProperty("username");
    expect(calledVariables).toHaveProperty("password");
  });

  it("injects Kiyoh credentials for kiyoh platform workflows", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    const kiyohWorkflow = { ...SAMPLE_WORKFLOW, platform: "kiyoh" };
    mockPrisma.automationWorkflow.findUnique.mockResolvedValue(kiyohWorkflow as any);
    mockExecuteWorkflow.mockResolvedValue({ success: true, steps: [] });

    const request = createPostRequest("/api/admin/automation/execute", {
      workflowId: "workflow-001",
      dryRun: true,
    });
    await executeWorkflowRoute(request);

    const calledVariables = mockExecuteWorkflow.mock.calls[0][1];
    expect(calledVariables).toHaveProperty("username");
    expect(calledVariables).toHaveProperty("password");
  });
});
