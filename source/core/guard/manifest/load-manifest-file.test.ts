import { assertEquals } from '@std/assert'
import { loadManifestFile } from './load-manifest-file.ts'

const fixturePath = new URL(
  './tests/fixtures/billing-service.yaml',
  import.meta.url,
)

Deno.test('loadManifestFile: reads and parses a real YAML manifest file', async () => {
  const manifest = await loadManifestFile(fixturePath)

  assertEquals(manifest.id, 'billing-service')
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
