import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep, mockReset, DeepMockProxy } from "vitest-mock-extended";
import { PrismaClient } from "@prisma/client";

vi.mock("@/lib/automation/executor", () => ({
  executeWorkflow: vi.fn(),
}));

import {
  listWorkflows,
  getWorkflow,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  executeWorkflow,
} from "@/lib/services/automation-service";
import type {
  AutomationServiceDependencies,
  PlatformCredentials,
} from "@/lib/services/automation-service";
import { executeWorkflow as runWorkflow } from "@/lib/automation/executor";

// ─── Mock Factories ────────────────────────────────────────────────────────────

const MOCK_CREDENTIALS: PlatformCredentials = {
  kvUser: "kv-user",
  kvPass: "kv-pass",
  kiyohUser: "kiyoh-user",
  kiyohPass: "kiyoh-pass",
};

function createMockDependencies(): {
  database: DeepMockProxy<PrismaClient>;
  credentials: PlatformCredentials;
} {
  return {
    database: mockDeep<PrismaClient>(),
    credentials: MOCK_CREDENTIALS,
  };
}

// ─── Test Fixtures ─────────────────────────────────────────────────────────────

const SAMPLE_STEPS = [
  { id: "step-1", type: "navigate", url: "https://example.com", description: "Go to site" },
  { id: "step-2", type: "click", selector: "#login", description: "Click login" },
];

const SAMPLE_WORKFLOW = {
  id: "workflow-001",
  name: "Test Workflow",
  platform: "kv",
  description: "A test workflow",
  steps: JSON.stringify(SAMPLE_STEPS),
  isActive: true,
  createdAt: new Date("2024-01-10T10:00:00Z"),
  updatedAt: new Date("2024-01-15T10:00:00Z"),
};

const SECOND_WORKFLOW = {
  id: "workflow-002",
  name: "Second Workflow",
  platform: "kiyoh",
  description: null,
  steps: JSON.stringify(SAMPLE_STEPS),
  isActive: false,
  createdAt: new Date("2024-01-08T10:00:00Z"),
  updatedAt: new Date("2024-01-12T10:00:00Z"),
};

// ─── Tests: listWorkflows ──────────────────────────────────────────────────────

describe("listWorkflows", () => {
  let dependencies: ReturnType<typeof createMockDependencies>;

  beforeEach(() => {
    dependencies = createMockDependencies();
  });

  it("returns all workflows ordered by updatedAt desc", async () => {
    const workflows = [SAMPLE_WORKFLOW, SECOND_WORKFLOW];
    dependencies.database.automationWorkflow.findMany.mockResolvedValue(workflows as any);

    const result = await listWorkflows(dependencies);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.workflows).toHaveLength(2);
      expect(result.workflows[0].id).toBe("workflow-001");
    }
    expect(dependencies.database.automationWorkflow.findMany).toHaveBeenCalledWith({
      orderBy: { updatedAt: "desc" },
    });
  });
});

// ─── Tests: getWorkflow ────────────────────────────────────────────────────────

describe("getWorkflow", () => {
  let dependencies: ReturnType<typeof createMockDependencies>;

  beforeEach(() => {
    dependencies = createMockDependencies();
  });

  it("returns workflow with parsed steps when found", async () => {
    dependencies.database.automationWorkflow.findUnique.mockResolvedValue(SAMPLE_WORKFLOW as any);

    const result = await getWorkflow(dependencies, "workflow-001");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.workflow.id).toBe("workflow-001");
      expect(result.workflow.steps).toEqual(SAMPLE_STEPS);
      expect(result.workflow.name).toBe("Test Workflow");
    }
  });

  it("returns not found when workflow does not exist", async () => {
    dependencies.database.automationWorkflow.findUnique.mockResolvedValue(null);

    const result = await getWorkflow(dependencies, "nonexistent");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.notFound).toBe(true);
      expect(result.error).toBe("Not found");
    }
  });
});

// ─── Tests: createWorkflow ─────────────────────────────────────────────────────

describe("createWorkflow", () => {
  let dependencies: ReturnType<typeof createMockDependencies>;

  beforeEach(() => {
    dependencies = createMockDependencies();
  });

  it("creates workflow with valid input", async () => {
    dependencies.database.automationWorkflow.create.mockResolvedValue(SAMPLE_WORKFLOW as any);

    const result = await createWorkflow(dependencies, {
      name: "Test Workflow",
      platform: "kv",
      description: "A test workflow",
      steps: SAMPLE_STEPS as any,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.workflow.id).toBe("workflow-001");
    }
    expect(dependencies.database.automationWorkflow.create).toHaveBeenCalledWith({
      data: {
        name: "Test Workflow",
        platform: "kv",
        description: "A test workflow",
        steps: JSON.stringify(SAMPLE_STEPS),
        isActive: true,
      },
    });
  });

  it("returns validation error when required fields are missing", async () => {
    const result = await createWorkflow(dependencies, {
      name: "",
      platform: "kv",
      steps: SAMPLE_STEPS as any,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.validationError).toBe(true);
      expect(result.error).toBe("Missing required fields");
    }
  });
});

// ─── Tests: updateWorkflow ─────────────────────────────────────────────────────

describe("updateWorkflow", () => {
  let dependencies: ReturnType<typeof createMockDependencies>;

  beforeEach(() => {
    dependencies = createMockDependencies();
  });

  it("updates workflow when it exists", async () => {
    dependencies.database.automationWorkflow.findUnique.mockResolvedValue(SAMPLE_WORKFLOW as any);
    const updatedWorkflow = { ...SAMPLE_WORKFLOW, name: "Updated Name" };
    dependencies.database.automationWorkflow.update.mockResolvedValue(updatedWorkflow as any);

    const result = await updateWorkflow(dependencies, "workflow-001", {
      name: "Updated Name",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.workflow.name).toBe("Updated Name");
    }
    expect(dependencies.database.automationWorkflow.update).toHaveBeenCalledWith({
      where: { id: "workflow-001" },
      data: { name: "Updated Name" },
    });
  });

  it("returns not found when workflow does not exist", async () => {
    dependencies.database.automationWorkflow.findUnique.mockResolvedValue(null);

    const result = await updateWorkflow(dependencies, "nonexistent", {
      name: "Updated",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.notFound).toBe(true);
      expect(result.error).toBe("Not found");
    }
  });
});

// ─── Tests: deleteWorkflow ─────────────────────────────────────────────────────

describe("deleteWorkflow", () => {
  let dependencies: ReturnType<typeof createMockDependencies>;

  beforeEach(() => {
    dependencies = createMockDependencies();
  });

  it("deletes workflow when it exists", async () => {
    dependencies.database.automationWorkflow.findUnique.mockResolvedValue(SAMPLE_WORKFLOW as any);
    dependencies.database.automationWorkflow.delete.mockResolvedValue(SAMPLE_WORKFLOW as any);

    const result = await deleteWorkflow(dependencies, "workflow-001");

    expect(result.success).toBe(true);
    expect(dependencies.database.automationWorkflow.delete).toHaveBeenCalledWith({
      where: { id: "workflow-001" },
    });
  });

  it("returns not found when workflow does not exist", async () => {
    dependencies.database.automationWorkflow.findUnique.mockResolvedValue(null);

    const result = await deleteWorkflow(dependencies, "nonexistent");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.notFound).toBe(true);
      expect(result.error).toBe("Not found");
    }
  });
});

// ─── Tests: executeWorkflow ────────────────────────────────────────────────────

describe("executeWorkflow", () => {
  let dependencies: ReturnType<typeof createMockDependencies>;
  const mockedRunWorkflow = vi.mocked(runWorkflow);

  beforeEach(() => {
    dependencies = createMockDependencies();
    vi.clearAllMocks();
  });

  it("executes workflow with credential injection for kv platform", async () => {
    dependencies.database.automationWorkflow.findUnique.mockResolvedValue(SAMPLE_WORKFLOW as any);
    mockedRunWorkflow.mockResolvedValue({
      success: true,
      steps: SAMPLE_STEPS.map((step) => ({ step: step as any, status: "ok" })),
    });

    const result = await executeWorkflow(dependencies, "workflow-001", { reviewId: "123" }, false);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.response.workflowName).toBe("Test Workflow");
      expect(result.response.platform).toBe("kv");
      expect(result.response.stepsTotal).toBe(2);
      expect(result.response.stepsCompleted).toBe(2);
    }

    expect(mockedRunWorkflow).toHaveBeenCalledWith(
      SAMPLE_STEPS,
      expect.objectContaining({
        reviewId: "123",
        username: "kv-user",
        password: "kv-pass",
      }),
      false,
    );
  });

  it("injects kiyoh credentials for kiyoh platform", async () => {
    const kiyohWorkflow = { ...SAMPLE_WORKFLOW, platform: "kiyoh" };
    dependencies.database.automationWorkflow.findUnique.mockResolvedValue(kiyohWorkflow as any);
    mockedRunWorkflow.mockResolvedValue({
      success: true,
      steps: SAMPLE_STEPS.map((step) => ({ step: step as any, status: "ok" })),
    });

    await executeWorkflow(dependencies, "workflow-001", {}, true);

    expect(mockedRunWorkflow).toHaveBeenCalledWith(
      SAMPLE_STEPS,
      expect.objectContaining({
        username: "kiyoh-user",
        password: "kiyoh-pass",
      }),
      true,
    );
  });

  it("returns not found when workflow does not exist", async () => {
    dependencies.database.automationWorkflow.findUnique.mockResolvedValue(null);

    const result = await executeWorkflow(dependencies, "workflow-001", {}, false);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.notFound).toBe(true);
      expect(result.error).toBe("Workflow not found");
    }
  });

  it("returns error when workflow is disabled", async () => {
    const disabledWorkflow = { ...SAMPLE_WORKFLOW, isActive: false };
    dependencies.database.automationWorkflow.findUnique.mockResolvedValue(disabledWorkflow as any);

    const result = await executeWorkflow(dependencies, "workflow-001", {}, false);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Workflow is disabled");
      expect(result.statusCode).toBe(400);
    }
  });

  it("returns error when workflow steps are corrupted", async () => {
    const corruptedWorkflow = { ...SAMPLE_WORKFLOW, steps: "not-valid-json{{{" };
    dependencies.database.automationWorkflow.findUnique.mockResolvedValue(corruptedWorkflow as any);

    const result = await executeWorkflow(dependencies, "workflow-001", {}, false);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Workflow steps are corrupted");
      expect(result.statusCode).toBe(500);
    }
  });
});
