import { assertEquals } from '@std/assert'
import {
  Action,
  Context,
  Decision,
  DenyOverridesStrategy,
  Judge,
  Policy,
  type PolicyEngine,
  type PolicyRepository,
  PolicyResult,
  Verdict,
} from '@mithaq/judge'
import type { ActionResolver, ResolvedAction } from './action-resolver.ts'
import { Guard } from './guard.ts'
import type { ServiceProvider } from './service-provider.ts'

class FakeActionResolver implements ActionResolver {
  constructor(private readonly resolved: ResolvedAction | null) {}

  resolve(): Promise<ResolvedAction | null> {
    return Promise.resolve(this.resolved)
  }
}

class FakePolicyRepository implements PolicyRepository {
  calls = 0

  constructor(private readonly policies: Policy[]) {}

  findPoliciesFor(_action: Action): Promise<Policy[]> {
    this.calls++
    return Promise.resolve(this.policies)
  }
}

class FakePolicyEngine implements PolicyEngine {
  constructor(private readonly verdict: Verdict) {}

  evaluate(policy: Policy, _context: Context): Promise<PolicyResult> {
    return Promise.resolve(new PolicyResult(policy, this.verdict))
  }
}

class RecordingServiceProvider implements ServiceProvider {
  calls: Array<'forward' | 'reject'> = []

  forward(): Promise<void> {
    this.calls.push('forward')
    return Promise.resolve()
  }

  reject(): Promise<void> {
    this.calls.push('reject')
    return Promise.resolve()
  }
}

function judgeAlwaysReturning(
  verdict: Verdict,
): { judge: Judge; repository: FakePolicyRepository } {
  const policy = new Policy('policy.a')
  const repository = new FakePolicyRepository([policy])
  const judge = new Judge(
    repository,
    new FakePolicyEngine(verdict),
    new DenyOverridesStrategy(new Decision(false)),
  )
  return { judge, repository }
}

const resolvedAction: ResolvedAction = {
  action: new Action('invoice.approve'),
  context: new Context({ subject: 'alice' }),
}

Deno.test('Guard.execute: forwards when the judge allows', async () => {
  const serviceProvider = new RecordingServiceProvider()
  const { judge } = judgeAlwaysReturning(Verdict.Allow)
  const guard = new Guard(
    judge,
    new FakeActionResolver(resolvedAction),
    serviceProvider,
  )

  await guard.execute()

  assertEquals(serviceProvider.calls, ['forward'])
})

Deno.test('Guard.execute: rejects when the judge denies', async () => {
  const serviceProvider = new RecordingServiceProvider()
  const { judge } = judgeAlwaysReturning(Verdict.Deny)
  const guard = new Guard(
    judge,
    new FakeActionResolver(resolvedAction),
    serviceProvider,
  )

  await guard.execute()

  assertEquals(serviceProvider.calls, ['reject'])
})

Deno.test('Guard.execute: rejects without consulting the judge when no action is resolved', async () => {
  const serviceProvider = new RecordingServiceProvider()
  const { judge, repository } = judgeAlwaysReturning(Verdict.Allow)
  const guard = new Guard(judge, new FakeActionResolver(null), serviceProvider)

  await guard.execute()

  assertEquals(serviceProvider.calls, ['reject'])
  assertEquals(repository.calls, 0)
})
