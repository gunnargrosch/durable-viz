import { withDurableExecution } from '@aws/durable-execution-sdk-js'
import { microvm } from '@aws/durable-execution-sdk-js-extensions/compute/microvm'

export const handler = withDurableExecution(async (event: { commits: string[] }, context) => {
  return context.map('builds', event.commits, async (itemCtx, commit) =>
    microvm(itemCtx, `build-${commit}`, { commit }, {
      imageIdentifier: 'image',
      executionRoleArn: 'role',
      timeout: { minutes: 5 },
    }),
  )
})
