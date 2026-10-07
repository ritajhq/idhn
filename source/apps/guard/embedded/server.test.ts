import { assertEquals } from '@std/assert'
import * as Access from '@idhn/access'
import * as Disclosure from '@idhn/disclosure'
import {
  type Authenticator,
  type Authenticators,
  type HttpManifest,
  MANIFEST_PATH,
  parseManifest,
  REJECTION_FOR_IDENTITY,
  RejectResponses,
} from '@idhn/guard'
import * as Judge from '@idhn/judge'
import * as OPA from '@idhn/opa'
import * as Policy from '@idhn/policy'
import { Server } from './server.ts'

const BUNDLE = new URL(
  '../../../core/opa/tests/fixtures/policy.wasm',
  import.meta.url,
)

/** Who is asking, read off a test header, so each request can be anyone. */
class HeaderScheme implements Authenticators.Scheme {
  authenticatorFor(request: Request): Authenticator {
    const role = request.headers.get('x-test-role')
    const identity = role === null
      ? Access.Identity.anonymous()
      : Access.Identity.authenticated('u-1', 'test', { role })
    return {
      authenticate: () => Promise.resolve(identity),
      rejectionFor: (who: Access.Identity) =>
        REJECTION_FOR_IDENTITY[who.status],
    }
  }
}

/**
 * A guard in front of a member directory: the manifest covers emails and
 * names by default, the `member.directory` policy (core/opa's fixtures) lets
 * members see each email's domain and names' initials, and admins full names.
 */
async function withDirectory(
  test: (guard: Server, upstreamCalls: () => number) => Promise<void>,
) {
  let calls = 0
  const upstream = Deno.serve(
    { port: 0, onListen: () => {} },
    () => {
      calls++
      return Response.json({
        members: [
          {
            id: 'u-1',
            email: 'ada@example.com',
            name: 'Ada Lovelace',
            phone: '+44 20 7946 0001',
          },
        ],
      })
    },
  )
  const registry = new Policy.Registries.InMemory()
  await registry.associate(
    new Access.Action('directory.members.list'),
    new Policy.Identifier('member.directory'),
  )
  await registry.associate(
    new Access.Action('directory.idhn.manifest.read'),
    new Policy.Identifier('resource.steward'),
  )
  const judge = new Judge.Local(
    registry,
    await OPA.PolicyEngine.load(await Deno.readFile(BUNDLE)),
    new Judge.DenyOverridesStrategy(new Judge.Decision(false)),
    new Judge.Enrichers.Passthrough(),
  )
  const manifest = parseManifest({
    id: 'directory',
    actions: [{
      name: 'members.list',
      match: { method: 'GET', path: '/members' },
      restrict: [
        { field: '/members/*/email' },
        { field: '/members/*/name' },
        {
          field: '/members/*/phone',
          show: { kind: 'partial', keep: 'last', count: 4 },
        },
      ],
    }],
  })
  try {
    await test(
      new Server(
        manifest as HttpManifest,
        judge,
        new HeaderScheme(),
        new URL(`http://localhost:${upstream.addr.port}`),
        new RejectResponses.Bare(),
        2000,
      ),
      () => calls,
    )
  } finally {
    await upstream.shutdown()
  }
}

const list = (role?: string) =>
  new Request('http://guard.test/members', {
    headers: role ? { 'x-test-role': role } : {},
  })

Deno.test('embedded guard: a member sees what the policy lets through, the rest as the manifest declares', async () => {
  await withDirectory(async (guard) => {
    const response = await guard.handle(list('member'))
    assertEquals(response.status, 200)
    assertEquals(await response.json(), {
      members: [{
        id: 'u-1',
        email: `${Disclosure.MASK}@example.com`,
        name: 'A. L.',
        phone: `${Disclosure.MASK}0001`,
      }],
    })
  })
})

Deno.test('embedded guard: an admin sees full names, still not whole emails or phones', async () => {
  await withDirectory(async (guard) => {
    const [member] = (await (await guard.handle(list('admin'))).json()).members
    assertEquals(member.name, 'Ada Lovelace')
    assertEquals(member.email, `${Disclosure.MASK}@example.com`)
    assertEquals(member.phone, `${Disclosure.MASK}0001`)
  })
})

Deno.test('embedded guard: an anonymous caller is not let in at all', async () => {
  await withDirectory(async (guard) => {
    const response = await guard.handle(list())
    assertEquals(response.status, 401)
    await response.body?.cancel()
  })
})

const readManifest = (role?: string) =>
  new Request(`http://guard.test${MANIFEST_PATH}`, {
    headers: role ? { 'x-test-role': role } : {},
  })

Deno.test('embedded guard: serves its manifest to whom the policies allow, in its own syntax, never asking the service', async () => {
  await withDirectory(async (guard, upstreamCalls) => {
    const response = await guard.handle(readManifest('admin'))
    assertEquals(response.status, 200)
    const manifest = parseManifest(await response.json()) as HttpManifest
    assertEquals(manifest.id, 'directory')
    assertEquals(manifest.actions[0].restrict?.toJSON(), {
      '/members/*/email': 'covered',
      '/members/*/name': 'covered',
      '/members/*/phone': { kind: 'partial', keep: 'last', count: 4 },
    })
    assertEquals(upstreamCalls(), 0)
  })
})

Deno.test('embedded guard: refuses its manifest to a member the policies do not allow, and asks an anonymous caller to sign in', async () => {
  await withDirectory(async (guard) => {
    const member = await guard.handle(readManifest('member'))
    assertEquals(member.status, 403)
    await member.body?.cancel()
    const anonymous = await guard.handle(readManifest())
    assertEquals(anonymous.status, 401)
    await anonymous.body?.cancel()
  })
})
