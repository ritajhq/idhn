import { assertEquals, assertRejects } from '@std/assert'
import { DatabaseSync } from 'node:sqlite'
import * as Guard from '@idhn/guard'
import {
  Catalog,
  Importer,
  NotAGuardError,
  RefusedError,
  UnreachableError,
} from './index.ts'

const MANIFEST = Guard.parseManifest({
  id: 'directory',
  actions: [{
    name: 'members.list',
    match: { method: 'GET', path: '/members' },
    restrict: [{ field: '/members/*/email' }],
  }],
})

/** A stand-in guard: hands its manifest to the cookie `sid=admin`, refuses `sid=member`, and asks anyone else to sign in. */
async function withGuard(
  answer: (request: Request) => Response,
  test: (origin: URL) => Promise<void>,
) {
  const server = Deno.serve({ port: 0, onListen: () => {} }, answer)
  try {
    await test(new URL(`http://localhost:${server.addr.port}/some/page`))
  } finally {
    await server.shutdown()
  }
}

const guard = (request: Request) => {
  if (new URL(request.url).pathname !== Guard.MANIFEST_PATH) {
    return new Response(null, { status: 404 })
  }
  const cookie = request.headers.get('cookie')
  if (cookie === 'sid=admin') {
    return Response.json(Guard.writeManifest(MANIFEST))
  }
  return new Response(null, { status: cookie === null ? 401 : 403 })
}

const as = (cookie?: string) => new Headers(cookie ? { cookie } : {})

Deno.test("Importer: imports a resource from its guard, presenting the caller's credential", async () => {
  await withGuard(guard, async (origin) => {
    const now = new Date('2026-10-06T10:00:00Z')
    const resource = await new Importer(1000, () => now).import(
      origin,
      as('sid=admin'),
    )
    assertEquals(resource.id, 'directory')
    assertEquals(resource.origin.origin, origin.origin)
    assertEquals(resource.importedAt, now)
    assertEquals(
      resource.actions.map((action) => [action.name, action.builtIn]),
      [
        ['directory.members.list', false],
        ['directory.idhn.manifest.read', true],
      ],
    )
  })
})

Deno.test('Importer: says why a guard refused, and what answered is no guard', async () => {
  await withGuard(guard, async (origin) => {
    const importer = new Importer(1000)
    const anonymous = await assertRejects(
      () => importer.import(origin, as()),
      RefusedError,
    )
    assertEquals(anonymous.rejection, 'unauthenticated')
    const member = await assertRejects(
      () => importer.import(origin, as('sid=member')),
      RefusedError,
    )
    assertEquals(member.rejection, 'forbidden')
  })
  await withGuard(() => new Response('<html>'), async (origin) => {
    await assertRejects(
      () => new Importer(1000).import(origin, as()),
      NotAGuardError,
    )
  })
  await withGuard(() => Response.json({ id: 'x' }), async (origin) => {
    await assertRejects(
      () => new Importer(1000).import(origin, as()),
      NotAGuardError,
      'manifest.actions',
    )
  })
  await assertRejects(
    () => new Importer(1000).import(new URL('http://localhost:1'), as()),
    UnreachableError,
  )
})

Deno.test('Catalog: keeps one resource per manifest id, re-importing replacing it', async () => {
  await withGuard(guard, async (origin) => {
    const catalog = Catalog.open(new DatabaseSync(':memory:'))
    const importer = new Importer(1000)
    catalog.save(await importer.import(origin, as('sid=admin')))
    catalog.save(await importer.import(origin, as('sid=admin')))

    const [resource] = catalog.all()
    assertEquals(catalog.all().length, 1)
    assertEquals(resource.actions[0].restrictions?.toJSON(), {
      '/members/*/email': 'covered',
    })
    assertEquals(catalog.find('directory')?.toDocument(), resource.toDocument())

    catalog.remove('directory')
    assertEquals(catalog.find('directory'), undefined)
  })
})
