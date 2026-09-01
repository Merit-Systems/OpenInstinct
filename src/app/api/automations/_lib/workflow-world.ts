import { createWorld, setWorld } from "workflow/runtime";

let applicationWorldPromise: Promise<void> | undefined;

export async function ensureApplicationWorkflowWorld() {
  applicationWorldPromise ??= initializeApplicationWorld();
  try {
    await applicationWorldPromise;
  } catch (error) {
    applicationWorldPromise = undefined;
    throw error;
  }
}

async function initializeApplicationWorld() {
  const world = await createWorld();
  setWorld(world);
}
