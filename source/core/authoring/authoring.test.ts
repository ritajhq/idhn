import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import { UntarStream } from '@std/tar/untar-stream'
import { DatabaseSync } from 'node:sqlite'
import {
  Builder,
  BuilderUnavailableError,
  Draft,
  InvalidPolicyError,
  Policy,
  Publishing,
  RefusedError,
  StaleDraftError,
  StillGoverningError,
  UnknownPolicyError,
  Workspace,
} from './index.ts'

const ADMIN =
  'package shop.admin\n\nallow if input.auth.claims.role == "admin"\n'
const ADMIN_TESTS =
  'package shop.admin_test\n\ntest_admin if data.shop.admin.allow with input as {"auth": {"claims": {"role": "admin"}}}\n'
const PUBLIC = 'package shop.public # anyone\n\nallow := true\n'

Deno.test('Policy: is named by the package its source declares', () => {
  assertEquals(Policy.write(ADMIN).name.toString(), 'shop.admin')
  assertEquals(Policy.write(PUBLIC).name.toString(), 'shop.public')
  assertEquals(Policy.write(ADMIN, '  ').tests, undefined)
  assertThrows(
    () => Policy.write('allow := true'),
    InvalidPolicyError,
    'package',
  )
})

Deno.test('Draft: policies govern actions, and one still governing cannot be removed', () => {
  const draft = Draft.empty()
  draft.write(Policy.write(ADMIN, ADMIN_TESTS))
  draft.write(Policy.write(PUBLIC))
  draft.associate('shop.orders.list', 'shop.admin')
  draft.associate('shop.orders.list', 'shop.public')
  draft.associate('shop.idhn.manifest.read', 'shop.admin')

  assertEquals(draft.governing('shop.orders.list'), [
    'shop.admin',
    'shop.public',
  ])
  assertEquals(draft.governedBy('shop.admin'), [
    'shop.idhn.manifest.read',
    'shop.orders.list',
  ])
  assertThrows(
    () => draft.associate('shop.x', 'shop.missing'),
    UnknownPolicyError,
  )
  const refused = assertThrows(
    () => draft.remove('shop.admin'),
    StillGoverningError,
  )
  assertEquals(refused.actions, ['shop.idhn.manifest.read', 'shop.orders.list'])

  draft.dissociate('shop.orders.list', 'shop.public')
  draft.remove('shop.public')
  assertEquals(draft.all.map((policy) => policy.name.toString()), [
    'shop.admin',
  ])
})

Deno.test('Draft: is the source tree the builder takes, and restores from one', () => {
  const draft = Draft.empty()
  draft.write(Policy.write(ADMIN, ADMIN_TESTS))
  draft.associate('shop.orders.list', 'shop.admin')
  const files: Record<string, string> = {
    ...draft.files(),
    'data.json': '{"tiers": []}',
  }
  assertEquals(Object.keys(files).sort(), [
    'data.json',
    'policies.yaml',
    'policies/shop.admin.rego',
    'policies/shop.admin_test.rego',
  ])
  assertEquals(
    files['policies.yaml'],
    'associations:\n  shop.orders.list:\n    - shop.admin\n',
  )

  const restored = Draft.empty()
  restored.restore(files)
  assertEquals(restored.files(), files)
  assertEquals(Draft.fromDocument(restored.toDocument()).files(), files)
})

Deno.test('Workspace: each edit is a new revision, and an edit on a stale one is refused', () => {
  const workspace = Workspace.open(new DatabaseSync(':memory:'))
  assertEquals(workspace.draft().revision, 0)

  const first = workspace.edit(0, (draft) => draft.write(Policy.write(ADMIN)))
  assertEquals(first.revision, 1)
  assertEquals(workspace.draft().policy('shop.admin')?.source, ADMIN)

  const stale = assertThrows(
    () => workspace.edit(0, (draft) => draft.write(Policy.write(PUBLIC))),
    StaleDraftError,
  )
  assertEquals([stale.basedOn, stale.current], [0, 1])

  // A change that fails saves nothing.
  assertThrows(
    () => workspace.edit(1, (draft) => draft.associate('a', 'shop.missing')),
    UnknownPolicyError,
  )
  assertEquals(workspace.draft().revision, 1)
})

/** A stand-in policy builder: unpacks what it is sent, and refuses any policy without an `allow` rule. */
async function withBuilder(
  test: (
    builder: Builder,
    received: () => Record<string, string>[],
  ) => Promise<void>,
) {
  const received: Record<string, string>[] = []
  const server = Deno.serve(
    { port: 0, onListen: () => {} },
    async (request) => {
      const files: Record<string, string> = {}
      for await (const entry of request.body!.pipeThrough(new UntarStream())) {
        files[entry.path] = await new Response(entry.readable).text()
      }
      received.push(files)
      const problems = Object.entries(files)
        .filter(([path, source]) =>
          path.endsWith('.rego') && !source.includes('allow')
        )
        .map(([path]) => `${path}: no allow rule`)
      return Response.json({
        version: request.headers.get('x-policy-version'),
        problems,
      }, {
        status: problems.length > 0 ? 422 : 200,
      })
    },
  )
  try {
    await test(
      new Builder(new URL(`http://localhost:${server.addr.port}`)),
      () => received,
    )
  } finally {
    await server.shutdown()
  }
}

Deno.test('Publishing: checks the draft, then publishes it as the next revision', async () => {
  await withBuilder(async (builder, received) => {
    const workspace = Workspace.open(new DatabaseSync(':memory:'))
    workspace.edit(0, (draft) => {
      draft.write(Policy.write(ADMIN))
      draft.associate('shop.orders.list', 'shop.admin')
    })
    const now = new Date('2026-10-06T12:00:00Z')
    const publishing = new Publishing(workspace, builder, () => now)

    assertEquals(await publishing.check(), [])
    const [first, second] = await Promise.all([
      publishing.publish('u-1'),
      publishing.publish('u-2'),
    ])

    assertEquals([first.version, second.version], ['r1', 'r2'])
    assertEquals(
      workspace.revisions().map((
        revision,
      ) => [revision.version, revision.publishedBy]),
      [
        ['r2', 'u-2'],
        ['r1', 'u-1'],
      ],
    )
    assertEquals(workspace.revision(1).files, received()[1])
    assertEquals(workspace.revision(1).publishedAt, now)
  })
})

Deno.test('Publishing: a draft that does not build publishes no revision', async () => {
  await withBuilder(async (builder) => {
    const workspace = Workspace.open(new DatabaseSync(':memory:'))
    workspace.edit(
      0,
      (draft) => draft.write(Policy.write('package shop.broken\n')),
    )
    const publishing = new Publishing(workspace, builder)

    assertEquals(await publishing.check(), [
      'policies/shop.broken.rego: no allow rule',
    ])
    const refused = await assertRejects(
      () => publishing.publish('u-1'),
      RefusedError,
    )
    assertEquals(refused.problems.length, 1)
    assertEquals(workspace.revisions(), [])
  })
  await assertRejects(
    () =>
      new Publishing(
        Workspace.open(new DatabaseSync(':memory:')),
        new Builder(new URL('http://localhost:1')),
      ).check(),
    BuilderUnavailableError,
  )
})

Deno.test('Draft: a policy written under a new package is the old one renamed, governing what it did', () => {
  const draft = Draft.empty()
  draft.write(Policy.write(ADMIN))
  draft.associate('shop.orders.list', 'shop.admin')

  draft.write(
    Policy.write(ADMIN.replace('shop.admin', 'shop.staff')),
    'shop.admin',
  )

  assertEquals(draft.all.map((policy) => policy.name.toString()), [
    'shop.staff',
  ])
  assertEquals(draft.governing('shop.orders.list'), ['shop.staff'])
  assertThrows(
    () => draft.write(Policy.write(PUBLIC), 'shop.missing'),
    UnknownPolicyError,
  )
})
