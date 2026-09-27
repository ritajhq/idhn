import { assertEquals, assertRejects } from '@std/assert'
import * as Access from '@idhn/access'
import * as Judge from '@idhn/judge'
import * as Policy from '@idhn/policy'
import type { ActionResolver, ResolvedAction } from './action-resolver.ts'
import type { Authenticator } from './authenticator.ts'
import { Guard } from './guard.ts'
import { Rejection, REJECTION_FOR_IDENTITY } from './rejection.ts'
import type { RequestRecord } from './request-record.ts'
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

  rejectionFor(identity: Access.Identity): Rejection {
    return REJECTION_FOR_IDENTITY[identity.status]
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
  calls: Array<'forward' | Rejection> = []

  forward(): Promise<void> {
    this.calls.push('forward')
    return Promise.resolve()
  }

  reject(rejection: Rejection): Promise<void> {
    this.calls.push(rejection)
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

async function rejectionFor(identity: Access.Identity): Promise<unknown[]> {
  const serviceProvider = new RecordingServiceProvider()
  const { judge } = judgeAlwaysReturning(Policy.Verdict.Deny)
  const guard = new Guard(
    judge,
    new FakeActionResolver(resolvedAction),
    new FakeAuthenticator(identity),
    serviceProvider,
  )

  await guard.execute()
  return serviceProvider.calls
}

Deno.test('Guard.execute: rejects an authenticated caller the judge denies as forbidden', async () => {
  assertEquals(
    await rejectionFor(Access.Identity.authenticated('u-1', 'portal')),
    [Rejection.Forbidden],
  )
})

Deno.test('Guard.execute: rejects an anonymous or invalid caller the judge denies as unauthenticated', async () => {
  assertEquals(await rejectionFor(Access.Identity.anonymous()), [
    Rejection.Unauthenticated,
  ])
  assertEquals(await rejectionFor(Access.Identity.invalid()), [
    Rejection.Unauthenticated,
  ])
})

Deno.test('Guard.execute: rejects a caller whose identity could not be checked as unavailable', async () => {
  assertEquals(await rejectionFor(Access.Identity.unavailable()), [
    Rejection.Unavailable,
  ])
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

  assertEquals(serviceProvider.calls, [Rejection.Forbidden])
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
  for (
    const identity of [
      Access.Identity.invalid(),
      Access.Identity.unavailable(),
    ]
  ) {
    const serviceProvider = new RecordingServiceProvider()
    const judge = new ContextCapturingJudge()
    const guard = new Guard(
      judge,
      new FakeActionResolver(resolvedAction),
      new FakeAuthenticator(identity),
      serviceProvider,
    )

    await guard.execute()

    assertEquals(judge.received[0].facts.auth, identity.toFact())
    assertEquals(serviceProvider.calls, ['forward'])
  }
})

class IdentifiedJudge implements Judge.Behavior {
  constructor(private readonly allowed: boolean) {}

  decide(): Promise<Judge.Decision> {
    return Promise.resolve(new Judge.Decision(this.allowed, [], 'decision-1'))
  }
}

class UnreachableJudge implements Judge.Behavior {
  decide(): Promise<Judge.Decision> {
    return Promise.reject(new Error('judge-server unreachable'))
  }
}

function recordsOf(guard: Guard): RequestRecord[] {
  const records: RequestRecord[] = []
  guard.OnHandled.Do((record) => records.push(record))
  return records
}

const alice = Access.Identity.authenticated('alice', 'https://idp.test')

Deno.test('Guard.execute: records a forwarded request with its action, caller and the id of the judgement that allowed it', async () => {
  const guard = new Guard(
    new IdentifiedJudge(true),
    new FakeActionResolver(resolvedAction),
    new FakeAuthenticator(alice),
    new RecordingServiceProvider(),
  )
  const records = recordsOf(guard)

  await guard.execute()

  assertEquals(records.length, 1)
  assertEquals(records[0].outcome, 'forwarded')
  assertEquals(records[0].action, 'invoice.approve')
  assertEquals(records[0].identity, {
    status: 'authenticated',
    subject: 'alice',
  })
  assertEquals(records[0].decisionId, 'decision-1')
  assertEquals(records[0].rejection, undefined)
})

Deno.test('Guard.execute: records a denied request with the rejection it was answered with', async () => {
  const guard = new Guard(
    new IdentifiedJudge(false),
    new FakeActionResolver(resolvedAction),
    new FakeAuthenticator(Access.Identity.anonymous()),
    new RecordingServiceProvider(),
  )
  const records = recordsOf(guard)

  await guard.execute()

  assertEquals(records[0].outcome, 'rejected')
  assertEquals(records[0].rejection, Rejection.Unauthenticated)
  assertEquals(records[0].decisionId, 'decision-1')
})

Deno.test('Guard.execute: records a request no action matched, without an action, caller or judgement', async () => {
  const guard = new Guard(
    new IdentifiedJudge(true),
    new FakeActionResolver(null),
    new FakeAuthenticator(alice),
    new RecordingServiceProvider(),
  )
  const records = recordsOf(guard)

  await guard.execute()

  assertEquals(records[0].outcome, 'rejected')
  assertEquals(records[0].rejection, Rejection.Forbidden)
  assertEquals(records[0].action, undefined)
  assertEquals(records[0].identity, undefined)
  assertEquals(records[0].decisionId, undefined)
})

Deno.test('Guard.execute: records a request that failed, with how far it got, then fails the same way', async () => {
  const guard = new Guard(
    new UnreachableJudge(),
    new FakeActionResolver(resolvedAction),
    new FakeAuthenticator(alice),
    new RecordingServiceProvider(),
  )
  const records = recordsOf(guard)

  await assertRejects(
    () => guard.execute(),
    Error,
    'judge-server unreachable',
  )

  assertEquals(records.length, 1)
  assertEquals(records[0].outcome, 'failed')
  assertEquals(records[0].error, 'judge-server unreachable')
  assertEquals(records[0].action, 'invoice.approve')
  assertEquals(records[0].decisionId, undefined)
})
