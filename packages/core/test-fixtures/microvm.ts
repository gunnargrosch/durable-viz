import { withDurableExecution } from '@aws/durable-execution-sdk-js'
import { microvm, microvmSession } from '@aws/durable-execution-sdk-js-extensions/compute/microvm'

export const handler = withDurableExecution(async (event: { key: string }, context) => {
  const build = await microvm(context, 'build', { key: event.key }, {
    imageIdentifier: 'image',
    executionRoleArn: 'role',
    timeout: { minutes: 5 },
  })

  const session = await microvmSession(context, 'pipeline', {
    imageIdentifier: 'image',
    executionRoleArn: 'role',
    timeout: { minutes: 10 },
  }, async (vm, sessionContext) => {
    const written = await vm.invoke(sessionContext, 'write', { key: event.key }, {
      timeout: { minutes: 5 },
    })
    await sessionContext.wait('pause', { seconds: 10 })
    return vm.invoke(sessionContext, 'read', written, {
      timeout: { minutes: 5 },
    })
  })

  return { build, session }
})
