import { withDurableExecution } from '@aws/durable-execution-sdk-js';

export const handler = withDurableExecution(async (event: any, context: any) => {
  context.step('step-a', async () => {});

  if (event.flag) {
    try {
      context.waitForCallback('callback-ok', async () => {});
      context.step('finalize-ok', async () => {});
    } catch {
      context.step('finalize-err', async () => {});
    }
  }

  context.step('step-b', async () => {});
});
