import { withDurableExecution } from '@aws/durable-execution-sdk-js';

const STEP_NAME = 'from-const';

export const handler = withDurableExecution(async (event: any, context: any) => {
  context.step('string-literal', async () => {});
  context.step(`template-literal`, async () => {});
  const varName = 'from-variable';
  context.step(varName, async () => {});
  const obj = { name: 'from-property' };
  context.step(obj.name, async () => {});
  context.step(STEP_NAME, async () => {});
  context.step(`template-${event.id}`, async () => {});
  context.step(getStepName(), async () => {});
});

function getStepName(): string { return 'from-function'; }
