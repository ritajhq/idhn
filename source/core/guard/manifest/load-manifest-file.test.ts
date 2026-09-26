import { assertEquals, assertRejects } from '@std/assert'
import { loadManifestFile } from './load-manifest-file.ts'
import { ManifestParseError } from './parse-manifest.ts'
import type { Protocol } from './schema.ts'

const fixturePath = new URL(
  './tests/fixtures/billing_service.yaml',
  import.meta.url,
)

Deno.test('loadManifestFile: reads and parses a real YAML manifest file', async () => {
  const manifest = await loadManifestFile(fixturePath, 'http')

  assertEquals(manifest.id, 'billing_service')
  assertEquals(manifest.actions.length, 2)
  assertEquals(manifest.actions[0].name, 'invoice.approve')
  assertEquals(manifest.actions[0].match.header, [{
    name: 'x-api-version',
    value: '2',
  }])
  assertEquals(manifest.actions[0].extract?.length, 5)
  assertEquals(manifest.actions[1].match.path, [
    '/invoices/:id',
    '/invoices/:id/summary',
  ])
})

Deno.test('loadManifestFile: rejects a manifest declared for a different protocol than the entry point serves', async () => {
  await assertRejects(
    () => loadManifestFile(fixturePath, 'grpc' as Protocol),
    ManifestParseError,
    'this entry point serves "grpc"',
  )
})
