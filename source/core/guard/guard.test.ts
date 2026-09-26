import { assertEquals } from '@std/assert'
import * as Access from '@idhn/access'
import * as Judge from '@idhn/judge'
import * as Policy from '@idhn/policy'
import type { ActionResolver, ResolvedAction } from './action-resolver.ts'
import type { Authenticator } from './authenticator.ts'
import { Guard } from './guard.ts'
import type { ServiceProvider } from './service-provider.ts'

class FakeActionResolver implements ActionResolver {
  constructor(private readonly resolved: ResolvedAction | null) {}

  resolve(): Promise<ResolvedAction | null> {
    return Promise.resolve(this.resolved)
  }
}

class FakeAuthenticator implements Authenticator {
  calls = 0

  constructor(private readonly identity: Access.Identity) {}

  authenticate(): Promise<Access.Identity> {
    this.calls++
    return Promise.resolve(this.identity)
  }
}

class ContextCapturingJudge implements Judge.Behavior {
  received: Access.Context[] = []

  decide(
    _action: Access.Action,
    context: Access.Context,
  ): Promise<Judge.Decision> {
    this.received.push(context)
    return Promise.resolve(new Judge.Decision(true))
  }
}

class FakePolicyRepository implements Policy.Repository {
  calls = 0

  constructor(private readonly policies: Policy.Identifier[]) {}

  findPoliciesFor(_action: Access.Action): Promise<Policy.Identifier[]> {
    this.calls++
    return Promise.resolve(this.policies)
  }
}

class FakePolicyEngine implements Policy.Engine {
  constructor(private readonly verdict: Policy.Verdict) {}

  evaluate(
    policy: Policy.Identifier,
    _context: Access.Context,
  ): Promise<Policy.Result> {
    return Promise.resolve(new Policy.Result(policy, this.verdict))
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
  verdict: Policy.Verdict,
): { judge: Judge.Behavior; repository: FakePolicyRepository } {
  const policy = new Policy.Identifier('policy.a')
  const repository = new FakePolicyRepository([policy])
  const judge = new Judge.Local(
    repository,
    new FakePolicyEngine(verdict),
    new Judge.DenyOverridesStrategy(new Judge.Decision(false)),
    new Judge.Enrichers.Passthrough(),
  )
  return { judge, repository }
}

const resolvedAction: ResolvedAction = {
  action: new Access.Action('invoice.approve'),
  context: new Access.Context({ subject: 'alice' }),
}

Deno.test('Guard.execute: forwards when the judge allows', async () => {
  const serviceProvider = new RecordingServiceProvider()
  const { judge } = judgeAlwaysReturning(Policy.Verdict.Allow)
  const guard = new Guard(
    judge,
    new FakeActionResolver(resolvedAction),
    new FakeAuthenticator(Access.Identity.anonymous()),
    serviceProvider,
  )

  await guard.execute()

  assertEquals(serviceProvider.calls, ['forward'])
})

Deno.test('Guard.execute: rejects when the judge denies', async () => {
  const serviceProvider = new RecordingServiceProvider()
  const { judge } = judgeAlwaysReturning(Policy.Verdict.Deny)
  const guard = new Guard(
    judge,
    new FakeActionResolver(resolvedAction),
    new FakeAuthenticator(Access.Identity.anonymous()),
    serviceProvider,
  )

  await guard.execute()

  assertEquals(serviceProvider.calls, ['reject'])
})

Deno.test('Guard.execute: rejects without consulting the judge when no action is resolved', async () => {
  const serviceProvider = new RecordingServiceProvider()
  const { judge, repository } = judgeAlwaysReturning(Policy.Verdict.Allow)
  const authenticator = new FakeAuthenticator(Access.Identity.anonymous())
  const guard = new Guard(
    judge,
    new FakeActionResolver(null),
    authenticator,
    serviceProvider,
  )

  await guard.execute()

  assertEquals(serviceProvider.calls, ['reject'])
  assertEquals(repository.calls, 0)
  assertEquals(authenticator.calls, 0)
})

Deno.test('Guard.execute: hands the judge the identity as the auth fact, next to the request facts', async () => {
  const judge = new ContextCapturingJudge()
  const guard = new Guard(
    judge,
    new FakeActionResolver(resolvedAction),
    new FakeAuthenticator(
      Access.Identity.authenticated('u-1', 'https://auth.test', {
        username: 'alice',
      }),
    ),
    new RecordingServiceProvider(),
  )

  await guard.execute()

  assertEquals(judge.received.map((context) => context.facts), [{
    subject: 'alice',
    auth: {
      status: 'authenticated',
      subject: 'u-1',
      issuer: 'https://auth.test',
      claims: { username: 'alice' },
    },
  }])
})

Deno.test('Guard.execute: still asks the judge when authentication finds no identity, leaving the call to the policies', async () => {
  const serviceProvider = new RecordingServiceProvider()
  const judge = new ContextCapturingJudge()
  const guard = new Guard(
    judge,
    new FakeActionResolver(resolvedAction),
    new FakeAuthenticator(Access.Identity.invalid()),
    serviceProvider,
  )

  await guard.execute()

  assertEquals(judge.received[0].facts.auth, {
    status: 'invalid',
    claims: {},
  })
  assertEquals(serviceProvider.calls, ['forward'])
})
