import { PrismaClient } from "@prisma/client";
import {
  executeWorkflow as runWorkflow,
  WorkflowStep,
} from "@/lib/automation/executor";

// ─── Dependencies ────────────────────────────────────────────────────────────

export interface AutomationServiceDependencies {
  database: PrismaClient;
  credentials: PlatformCredentials;
}

export interface PlatformCredentials {
  kvUser: string;
  kvPass: string;
  kiyohUser: string;
  kiyohPass: string;
}

// ─── Input Types ─────────────────────────────────────────────────────────────

export interface CreateWorkflowInput {
  name: string;
  platform: string;
  description?: string | null;
  steps: ReadonlyArray<WorkflowStep>;
}

export interface UpdateWorkflowInput {
  name?: string;
  platform?: string;
  description?: string | null;
  steps?: ReadonlyArray<WorkflowStep>;
  isActive?: boolean;
}

// ─── Result Types ────────────────────────────────────────────────────────────

export interface WorkflowRecord {
  id: string;
  name: string;
  platform: string;
  description: string | null;
  steps: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkflowWithParsedSteps {
  id: string;
  name: string;
  platform: string;
  description: string | null;
  steps: ReadonlyArray<WorkflowStep>;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExecutionStepResult {
  description: string;
  type: string;
  status: string;
  error?: string;
  screenshot?: string;
}

export interface ExecutionResponse {
  success: boolean;
  dryRun: boolean;
  workflowName: string;
  platform: string;
  stepsTotal: number;
  stepsCompleted: number;
  steps: ReadonlyArray<ExecutionStepResult>;
  error?: string;
}

export type ListWorkflowsResult =
  | { success: true; workflows: ReadonlyArray<WorkflowRecord> }
  | { success: false; error: string };

export type GetWorkflowResult =
  | { success: true; workflow: WorkflowWithParsedSteps }
  | { success: false; error: string; notFound?: boolean };

export type CreateWorkflowResult =
  | { success: true; workflow: WorkflowRecord }
  | { success: false; error: string; validationError?: boolean };

export type UpdateWorkflowResult =
  | { success: true; workflow: WorkflowRecord }
  | { success: false; error: string; notFound?: boolean };

export type DeleteWorkflowResult =
  | { success: true }
  | { success: false; error: string; notFound?: boolean };

export type ExecuteWorkflowResult =
  | { success: true; response: ExecutionResponse }
  | { success: false; error: string; notFound?: boolean; statusCode?: number };

// ─── Service Functions ───────────────────────────────────────────────────────

/** List all automation workflows ordered by most recently updated. */
export async function listWorkflows(
  dependencies: AutomationServiceDependencies
): Promise<ListWorkflowsResult> {
  const workflows = await dependencies.database.automationWorkflow.findMany({
    orderBy: { updatedAt: "desc" },
  });

  return { success: true, workflows };
}

/** Get a single workflow by ID with its steps parsed from JSON. */
export async function getWorkflow(
  dependencies: AutomationServiceDependencies,
  workflowId: string
): Promise<GetWorkflowResult> {
  const workflow = await dependencies.database.automationWorkflow.findUnique({
    where: { id: workflowId },
  });

  if (!workflow) {
    return { success: false, error: "Not found", notFound: true };
  }

  const parsedSteps: WorkflowStep[] = JSON.parse(workflow.steps);

  const workflowWithSteps: WorkflowWithParsedSteps = {
    id: workflow.id,
    name: workflow.name,
    platform: workflow.platform,
    description: workflow.description,
    steps: parsedSteps,
    isActive: workflow.isActive,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
  };

  return { success: true, workflow: workflowWithSteps };
}

/** Validate input and create a new workflow. */
export async function createWorkflow(
  dependencies: AutomationServiceDependencies,
  input: CreateWorkflowInput
): Promise<CreateWorkflowResult> {
  if (!input.name || !input.platform || !input.steps) {
    return {
      success: false,
      error: "Missing required fields",
      validationError: true,
    };
  }

  const workflow = await dependencies.database.automationWorkflow.create({
    data: {
      name: input.name,
      platform: input.platform,
      description: input.description || null,
      steps: JSON.stringify(input.steps),
      isActive: true,
    },
  });

  return { success: true, workflow };
}

/** Partially update an existing workflow. */
export async function updateWorkflow(
  dependencies: AutomationServiceDependencies,
  workflowId: string,
  input: UpdateWorkflowInput
): Promise<UpdateWorkflowResult> {
  const existing = await dependencies.database.automationWorkflow.findUnique({
    where: { id: workflowId },
  });

  if (!existing) {
    return { success: false, error: "Not found", notFound: true };
  }

  const updateData: Record<string, unknown> = {};

  if (input.name !== undefined) {
    updateData.name = input.name;
  }
  if (input.description !== undefined) {
    updateData.description = input.description;
  }
  if (input.platform !== undefined) {
    updateData.platform = input.platform;
  }
  if (input.steps !== undefined) {
    updateData.steps = JSON.stringify(input.steps);
  }
  if (input.isActive !== undefined) {
    updateData.isActive = input.isActive;
  }

  const workflow = await dependencies.database.automationWorkflow.update({
    where: { id: workflowId },
    data: updateData,
  });

  return { success: true, workflow };
}

/** Delete a workflow by ID. */
export async function deleteWorkflow(
  dependencies: AutomationServiceDependencies,
  workflowId: string
): Promise<DeleteWorkflowResult> {
  const existing = await dependencies.database.automationWorkflow.findUnique({
    where: { id: workflowId },
  });

  if (!existing) {
    return { success: false, error: "Not found", notFound: true };
  }

  await dependencies.database.automationWorkflow.delete({
    where: { id: workflowId },
  });

  return { success: true };
}

/** Load a workflow, inject platform credentials, and execute via the executor. */
export async function executeWorkflow(
  dependencies: AutomationServiceDependencies,
  workflowId: string,
  variables: Record<string, string>,
  dryRun: boolean
): Promise<ExecuteWorkflowResult> {
  if (!workflowId) {
    return {
      success: false,
      error: "workflowId is required",
      statusCode: 400,
    };
  }

  const workflow = await dependencies.database.automationWorkflow.findUnique({
    where: { id: workflowId },
  });

  if (!workflow) {
    return { success: false, error: "Workflow not found", notFound: true };
  }

  if (!workflow.isActive) {
    return {
      success: false,
      error: "Workflow is disabled",
      statusCode: 400,
    };
  }

  let steps: WorkflowStep[];
  try {
    steps = JSON.parse(workflow.steps);
  } catch {
    return {
      success: false,
      error: "Workflow steps are corrupted",
      statusCode: 500,
    };
  }

  // Inject platform credentials based on workflow platform
  const enrichedVariables: Record<string, string> = { ...variables };

  if (workflow.platform === "kv") {
    enrichedVariables.username = dependencies.credentials.kvUser;
    enrichedVariables.password = dependencies.credentials.kvPass;
  } else {
    enrichedVariables.username = dependencies.credentials.kiyohUser;
    enrichedVariables.password = dependencies.credentials.kiyohPass;
  }

  const result = await runWorkflow(steps, enrichedVariables, dryRun);

  const completedSteps = result.steps.filter(
    (stepResult) => stepResult.status === "ok"
  );

  const mappedSteps: ExecutionStepResult[] = result.steps.map((stepResult) => ({
    description: stepResult.step.description,
    type: stepResult.step.type,
    status: stepResult.status,
    error: stepResult.error,
    screenshot: stepResult.screenshot,
  }));

  const response: ExecutionResponse = {
    success: result.success,
    dryRun,
    workflowName: workflow.name,
    platform: workflow.platform,
    stepsTotal: steps.length,
    stepsCompleted: completedSteps.length,
    steps: mappedSteps,
    error: result.error,
  };

  return { success: true, response };
}
