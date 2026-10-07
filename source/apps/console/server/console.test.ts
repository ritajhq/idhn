import { assertEquals } from '@std/assert'
import { DatabaseSync } from 'node:sqlite'
import * as Access from '@idhn/access'
import * as Audit from '@idhn/audit'
import * as Authoring from '@idhn/authoring'
import * as Contract from '@idhn/contract'
import * as Distribution from '@idhn/distribution'
import * as Guard from '@idhn/guard'
import * as Judge from '@idhn/judge'
import * as Mechanisms from '@idhn/mechanisms'
import * as OPA from '@idhn/opa'
import * as Policy from '@idhn/policy'
import * as Resources from '@idhn/resources'
import * as Horizon from '@ritaj/horizon'
import * as MUX from '@ritaj/mux'
import { Client as HttpCourier } from '@ritaj/mux/client/http'
import { Server as HttpTransport } from '@ritaj/mux/server/http'
import { Intake as AuditIntake } from '../../audit/server/intake.ts'
import { Queries as AuditQueries } from '../../audit/server/queries.ts'
import { Server as AuditServer } from '../../audit/server/server.ts'
import { Server as GuardServer } from '../../guard/embedded/server.ts'
import { Builds } from '../../policy/builder/builds.ts'
import { Compiler } from '../../policy/builder/compiler.ts'
import { UploadIntake } from '../../policy/builder/intake.ts'
import { Opa } from '../../policy/builder/opa.ts'
import { Server as BuilderServer } from '../../policy/builder/server.ts'
import { Upload } from '../../policy/builder/sources/upload.ts'
import { AuditRelay, PolicyDesk, ResourceDesk } from './desks.ts'
import { Server, WebApp } from './server.ts'

const BUNDLE = new URL(
  '../../../core/opa/tests/fixtures/policy.wasm',
  import.meta.url,
)

/** Who is asking the service guard: the `role` cookie, so the console has to present the caller's own. */
class CookieRole implements Guard.Authenticators.Scheme {
  authenticatorFor(request: Request): Guard.Authenticator {
    const role = request.headers.get('cookie')?.match(/role=(\w+)/)?.[1]
    const identity = role === undefined
      ? Access.Identity.anonymous()
      : Access.Identity.authenticated(`u-${role}`, 'test', { role })
    return {
      authenticate: () => Promise.resolve(identity),
      rejectionFor: (who: Access.Identity) =>
        Guard.REJECTION_FOR_IDENTITY[who.status],
    }
  }
}

/** Everything the console talks to, for real, each on its own port; and the console. */
async function withConsole(
  test: (
    console: (role: string) => Horizon.Client,
    world: {
      serviceGuard: string
      publication: Distribution.Publication
      audit: string
    },
  ) => Promise<void>,
) {
  const servers: Deno.HttpServer[] = []
  const serve = (handle: (request: Request) => Promise<Response>) => {
    const server = Deno.serve({ port: 0, onListen: () => {} }, handle)
    servers.push(server)
    return `http://localhost:${server.addr.port}`
  }

  // The policy builder, taking uploads.
  const publication = new Distribution.Publication()
  const builds = new Builds(new Compiler(new Opa()), publication)
  const upload = new Upload(await Deno.makeTempDir())
  await upload.start()
  const builder = serve((request) =>
    new BuilderServer(
      new Distribution.Http.Server(publication),
      new UploadIntake(upload, builds),
      publication,
    )
      .handle(request)
  )

  // The audit server.
  const store = Audit.Stores.Sqlite.open(new DatabaseSync(':memory:'))
  const auditResolvers = new Horizon.Resolvers()
  new AuditQueries(store).serve(auditResolvers)
  const auditTransport = new HttpTransport()
  new Horizon.Server(auditResolvers, new Horizon.Handlers()).Use(auditTransport)
  const auditServer = new AuditServer(
    new AuditIntake(
      new Audit.Ingestion(store, new Audit.Redaction()),
      undefined,
      4,
    ),
    auditTransport,
  )
  const audit = serve((request) => auditServer.handle(request))

  // A service's guard, whose manifest admins may read (core/opa's `resource.steward` fixture).
  const registry = new Policy.Registries.InMemory()
  await registry.associate(
    new Access.Action('directory.idhn.manifest.read'),
    new Policy.Identifier('resource.steward'),
  )
  const guard = new GuardServer(
    Guard.parseManifest({
      id: 'directory',
      actions: [{
        name: 'members.list',
        match: { method: 'GET', path: '/members' },
        restrict: [{ field: '/members/*/email' }],
      }],
    }) as Guard.HttpManifest,
    new Judge.Local(
      registry,
      await OPA.PolicyEngine.load(await Deno.readFile(BUNDLE)),
      new Judge.DenyOverridesStrategy(new Judge.Decision(false)),
      new Judge.Enrichers.Passthrough(),
    ),
    new CookieRole(),
    new URL('http://localhost:1'),
    new Guard.RejectResponses.Bare(),
    2000,
  )
  const serviceGuard = serve((request) => guard.handle(request))

  // The console.
  const db = new DatabaseSync(':memory:')
  const workspace = Authoring.Workspace.open(db)
  const resolvers = new Horizon.Resolvers()
  const handlers = new Horizon.Handlers()
  new ResourceDesk(Resources.Catalog.open(db), new Resources.Importer(2000))
    .serve(resolvers, handlers)
  new PolicyDesk(
    workspace,
    new Authoring.Publishing(
      workspace,
      new Authoring.Builder(new URL(builder)),
    ),
  ).serve(
    resolvers,
    handlers,
  )
  new AuditRelay(new Horizon.Client(new HttpCourier(audit), { timeout: 2000 }))
    .serve(resolvers)
  const transport = new HttpTransport(
    new MUX.Authentication([new Mechanisms.CallerHeaders()]),
  )
  new Horizon.Server(resolvers, handlers).Use(transport)
  const dist = await Deno.makeTempDir()
  for (const name of ['index.html', 'main.js', 'index.css']) {
    await Deno.writeTextFile(`${dist}/${name}`, name)
  }
  const consoleServer = new Server(transport, await WebApp.load(dist))
  const consoleUrl = serve((request) => consoleServer.handle(request))

  /** A browser session, as the console's own guard forwards it: who the caller is, and their cookie. */
  const as = (role: string) => {
    const courier = new HttpCourier(consoleUrl)
    const headers = new Guard.CallerHeaders().describe(
      new Headers({ cookie: `role=${role}` }),
      Access.Identity.authenticated(`u-${role}`, 'test', { role }),
    )
    courier.Carry(new MUX.Credentials.Headers(Object.fromEntries(headers)))
    return new Horizon.Client(courier, { timeout: 30_000 })
  }

  try {
    await test(as, { serviceGuard, publication, audit })
  } finally {
    for (const server of servers) await server.shutdown()
  }
}

const POLICY =
  'package directory.members\n\ndefault allow := false\n\nallow if input.auth.status == "authenticated"\n'
const TESTS =
  'package directory.members_test\n\nimport data.directory.members\n\ntest_member if members.allow with input as {"auth": {"status": "authenticated"}}\n'

Deno.test("console: imports a resource from its guard with the caller's own credential", async () => {
  await withConsole(async (as, { serviceGuard }) => {
    const resource = await as('admin').Issue(
      new Contract.Resources.Import(serviceGuard),
    )
    assertEquals(resource.id, 'directory')
    assertEquals(resource.actions.map((action) => action.name), [
      'directory.members.list',
      'directory.idhn.manifest.read',
    ])
    assertEquals(resource.actions[0].match, { method: 'GET', path: '/members' })
    assertEquals(resource.actions[0].restrictions, {
      '/members/*/email': 'covered',
    })
    assertEquals(
      (await as('admin').Ask(new Contract.Resources.List())).map((listed) =>
        listed.id
      ),
      ['directory'],
    )

    const refused = await as('member').Attempt(
      new Contract.Resources.Import(serviceGuard),
    )
    assertEquals(
      !refused.ok && refused.fault instanceof Contract.Rejected &&
        refused.fault.Reason,
      'import_forbidden',
    )
  })
})

Deno.test('console: authors policies and associations, refusing a change on a stale draft', async () => {
  await withConsole(async (as) => {
    const ada = as('admin')
    let draft = await ada.Ask(new Contract.Policies.Draft())
    assertEquals(draft.revision, 0)

    draft = await ada.Issue(
      new Contract.Policies.Write(draft.revision, POLICY, TESTS),
    )
    draft = await ada.Issue(
      new Contract.Policies.Associate(
        draft.revision,
        'directory.members.list',
        'directory.members',
      ),
    )
    assertEquals(draft.revision, 2)
    assertEquals(draft.policies[0].governs, ['directory.members.list'])

    const stale = await ada.Attempt(
      new Contract.Policies.Associate(
        0,
        'directory.idhn.manifest.read',
        'directory.members',
      ),
    )
    assertEquals(
      !stale.ok && stale.fault instanceof Contract.Stale &&
        [stale.fault.BasedOn, stale.fault.Current],
      [0, 2],
    )

    const governing = await ada.Attempt(
      new Contract.Policies.Remove(draft.revision, 'directory.members'),
    )
    assertEquals(
      !governing.ok && governing.fault instanceof Contract.Rejected &&
        [governing.fault.Reason, governing.fault.Details],
      ['still_governing', ['directory.members.list']],
    )

    const invalid = await ada.Attempt(
      new Contract.Policies.Write(draft.revision, 'allow := true'),
    )
    assertEquals(
      !invalid.ok && invalid.fault instanceof Contract.Rejected &&
        invalid.fault.Reason,
      'invalid_policy',
    )
  })
})

Deno.test('console: checks the draft with the builder, then publishes it for judges to pull', async () => {
  await withConsole(async (as, { publication }) => {
    const ada = as('admin')
    let draft = await ada.Issue(
      new Contract.Policies.Write(
        0,
        'package directory.broken\n\nallow if {\n',
      ),
    )
    assertEquals(
      (await ada.Ask(new Contract.Policies.Check(draft.revision))).length > 0,
      true,
    )
    const refused = await ada.Attempt(new Contract.Policies.Publish())
    assertEquals(
      !refused.ok && refused.fault instanceof Contract.Rejected &&
        refused.fault.Reason,
      'does_not_build',
    )
    assertEquals(publication.current, undefined)

    draft = await ada.Issue(
      new Contract.Policies.Remove(draft.revision, 'directory.broken'),
    )
    draft = await ada.Issue(
      new Contract.Policies.Write(draft.revision, POLICY, TESTS),
    )
    draft = await ada.Issue(
      new Contract.Policies.Associate(
        draft.revision,
        'directory.members.list',
        'directory.members',
      ),
    )
    assertEquals(await ada.Ask(new Contract.Policies.Check(draft.revision)), [])

    const revision = await ada.Issue(new Contract.Policies.Publish())
    assertEquals([revision.version, revision.publishedBy], ['r1', 'u-admin'])
    assertEquals(publication.current?.version, 'r1')
    const [listed] = await ada.Ask(new Contract.Policies.Revisions())
    assertEquals([listed.version, listed.files], ['r1', undefined])
    assertEquals(
      Object.keys(
        (await ada.Ask(new Contract.Policies.Revision(1))).files ?? {},
      ).sort(),
      [
        'policies.yaml',
        'policies/directory.members.rego',
        'policies/directory.members_test.rego',
      ],
    )
  })
})

Deno.test('console: relays the audit, answering from the audit server', async () => {
  await withConsole(async (as, { audit }) => {
    const timestamp = '2026-10-06T10:00:00.000Z'
    await fetch(`${audit}/records`, {
      method: 'POST',
      body: JSON.stringify({
        event: 'guard.request',
        timestamp,
        durationMs: 2,
        outcome: 'rejected',
        action: 'directory.members.list',
        rejection: 'forbidden',
      }),
    }).then((response) => response.body?.cancel())

    const since = new Date(timestamp)
    const until = new Date(since.getTime() + 60 * 60_000)
    const overview = await as('admin').Ask(
      new Contract.Audit.Overview(since, until),
    )
    assertEquals(overview.totals.rejected, 1)
    const page = await as('admin').Ask(new Contract.Audit.Trails(since, until))
    assertEquals(page.trails[0].request.action, 'directory.members.list')
  })
})

Deno.test('console manifest: names every call the console answers, so its guard can judge each', async () => {
  const manifest = await Guard.loadManifestFile(
    new URL('./manifest.yaml', import.meta.url).pathname,
    'http',
  )
  const declared = new Set(
    manifest.actions.map((action) => action.name).filter((name) =>
      name !== 'app.open'
    ),
  )
  const answered = [Contract.Resources, Contract.Policies, Contract.Audit]
    .flatMap((area) => Object.values(area))
    .filter((value): value is new () => MUX.Packet =>
      typeof value === 'function' && value.prototype instanceof Horizon.Message
    )
    .map((message) => MUX.Packet.Registry.Read(new message()).split('/').pop()!)
  assertEquals(answered.filter((name) => !declared.has(name)), [])
  assertEquals(declared.size, answered.length)
})
