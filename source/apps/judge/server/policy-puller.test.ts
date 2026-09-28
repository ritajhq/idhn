import { assertEquals } from '@std/assert'
import * as Distribution from '@idhn/distribution'
import { PolicyPuller } from './policy-puller.ts'

const set = (version: string) =>
  new Distribution.PolicySet(version, new Uint8Array([1]), 'associations: {}\n')

Deno.test({
  name: 'PolicyPuller: announces the builder\'s set, each newer one, and failures while it has none',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const publication = new Distribution.Publication()
    const server = new Distribution.Http.Server(publication)
    const http = Deno.serve(
      { port: 0, onListen: () => {} },
      async (request) => (await server.handle(request)) ?? new Response(null, { status: 404 }),
    )
    const puller = new PolicyPuller(
      new Distribution.Http.Client(new URL(`http://localhost:${http.addr.port}`)),
      100,
    )
    const announced: string[] = []
    let failures = 0
    let recoveries = 0
    puller.OnPolicySet.Do((pulled) => announced.push(pulled.version))
    puller.OnFailed.Do(() => failures++)
    puller.OnRecovered.Do(() => recoveries++)

    await puller.start()
    await new Promise((resolve) => setTimeout(resolve, 350))
    publication.publish(set('v1'))
    await new Promise((resolve) => setTimeout(resolve, 350))
    publication.publish(set('v2'))
    await new Promise((resolve) => setTimeout(resolve, 350))
    await http.shutdown()

    assertEquals(failures, 1) // nothing published at first: said once, not at every poll
    assertEquals(recoveries, 1)
    assertEquals(announced, ['v1', 'v2']) // each once, however many polls
  },
})
