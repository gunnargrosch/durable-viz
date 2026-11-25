import { withDurableExecution } from '@aws/durable-execution-sdk-js'
import { microvmSession as runMicrovmSession } from '@aws/durable-execution-sdk-js-extensions/compute/microvm'

const pipeline = async (vm, ctx) => {
  const build = await vm.invoke(ctx, 'build', { repo: 'org/app' }, {
    timeout: { minutes: 15 },
  })
  await ctx.wait('cool-down', { minutes: 5 })
  return vm.invoke(ctx, 'test', build, {
    timeout: { minutes: 10 },
  })
}

export const handler = withDurableExecution(async (event, context) => {
  return runMicrovmSession(context, 'ci-pipeline', {
    imageIdentifier: 'image',
    executionRoleArn: 'role',
    timeout: { hours: 1 },
  }, pipeline)
})
