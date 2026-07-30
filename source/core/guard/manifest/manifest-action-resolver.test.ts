import { assertEquals } from '@std/assert'
import { ManifestActionResolver } from './manifest-action-resolver.ts'
import { parseManifest } from './parse-manifest.ts'
import type { Manifest } from './schema.ts'

const manifest: Manifest = parseManifest({
  id: 'billing-service',
  actions: [
    {
      name: 'invoice.approve',
      match: { method: 'POST', path: '/invoices/:id/approve' },
      extract: [
        { from: { property: 'path', using: 'id' }, as: 'invoiceId' },
        { from: { property: 'header', using: 'x-user-id' }, as: 'subject' },
      ],
    },
    {
      name: 'invoice.read',
      match: { method: ['GET', 'HEAD'], path: '/invoices/:id' },
      extract: [{ from: { property: 'path', using: 'id' }, as: 'invoiceId' }],
    },
  ],
})

Deno.test('ManifestActionResolver.resolve: resolves the first matching action, prefixed by manifest id', async () => {
  const request = new Request('https://example.test/invoices/42/approve', {
    method: 'POST',
    headers: { 'x-user-id': 'alice' },
  })
  const resolver = new ManifestActionResolver(manifest, request)

  const resolved = await resolver.resolve()

  assertEquals(resolved?.action.name, 'billing-service.invoice.approve')
  assertEquals(resolved?.context.facts, { invoiceId: '42', subject: 'alice' })
})

Deno.test('ManifestActionResolver.resolve: falls through to a later action when an earlier one does not match', async () => {
  const request = new Request('https://example.test/invoices/42', {
    method: 'GET',
  })
  const resolver = new ManifestActionResolver(manifest, request)

  const resolved = await resolver.resolve()

  assertEquals(resolved?.action.name, 'billing-service.invoice.read')
  assertEquals(resolved?.context.facts, { invoiceId: '42' })
})

Deno.test('ManifestActionResolver.resolve: falls through when the match succeeds but a required extract field is missing', async () => {
  const request = new Request('https://example.test/invoices/42/approve', {
    method: 'POST',
  })
  const resolver = new ManifestActionResolver(manifest, request)

  const resolved = await resolver.resolve()

  assertEquals(resolved, null)
})

Deno.test('ManifestActionResolver.resolve: returns null when no action matches at all', async () => {
  const request = new Request('https://example.test/unknown', {
    method: 'DELETE',
  })
  const resolver = new ManifestActionResolver(manifest, request)

  assertEquals(await resolver.resolve(), null)
})
