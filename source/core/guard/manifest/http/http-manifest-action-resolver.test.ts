import { assertEquals } from '@std/assert'
import { HttpManifestActionResolver } from './http-manifest-action-resolver.ts'
import { parseManifest } from '../parse-manifest.ts'
import type { HttpManifest } from './schema.ts'

const manifest: HttpManifest = parseManifest({
  id: 'billing_service',
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

Deno.test('HttpManifestActionResolver.resolve: resolves the first matching action, prefixed by manifest id', async () => {
  const request = new Request('https://example.test/invoices/42/approve', {
    method: 'POST',
    headers: { 'x-user-id': 'alice' },
  })
  const resolver = new HttpManifestActionResolver(manifest, request)

  const resolved = await resolver.resolve()

  assertEquals(resolved?.action.name, 'billing_service.invoice.approve')
  assertEquals(resolved?.context.facts, { invoiceId: '42', subject: 'alice' })
})

Deno.test('HttpManifestActionResolver.resolve: falls through to a later action when an earlier one does not match', async () => {
  const request = new Request('https://example.test/invoices/42', {
    method: 'GET',
  })
  const resolver = new HttpManifestActionResolver(manifest, request)

  const resolved = await resolver.resolve()

  assertEquals(resolved?.action.name, 'billing_service.invoice.read')
  assertEquals(resolved?.context.facts, { invoiceId: '42' })
})

Deno.test('HttpManifestActionResolver.resolve: falls through when the match succeeds but a required extract field is missing', async () => {
  const request = new Request('https://example.test/invoices/42/approve', {
    method: 'POST',
  })
  const resolver = new HttpManifestActionResolver(manifest, request)

  const resolved = await resolver.resolve()

  assertEquals(resolved, null)
})

Deno.test('HttpManifestActionResolver.resolve: returns null when no action matches at all', async () => {
  const request = new Request('https://example.test/unknown', {
    method: 'DELETE',
  })
  const resolver = new HttpManifestActionResolver(manifest, request)

  assertEquals(await resolver.resolve(), null)
})

const bodyManifest: HttpManifest = parseManifest({
  id: 'places',
  actions: [
    {
      name: 'profile.get',
      match: { method: 'POST', path: '/rpc' },
      extract: [{ from: { property: 'body', type: 'json', using: 'query' }, as: 'placeId' }],
    },
    {
      name: 'profile.update',
      match: { method: 'POST', path: '/rpc' },
      extract: [{ from: { property: 'body', type: 'json', using: 'action' }, as: 'placeId' }],
    },
  ],
})

Deno.test('HttpManifestActionResolver.resolve: leaves the request body unread, so a resolved request can still be forwarded', async () => {
  const body = JSON.stringify({ query: 'p-1' })
  const request = new Request('https://example.test/rpc', { method: 'POST', body })
  const resolver = new HttpManifestActionResolver(bodyManifest, request)

  const resolved = await resolver.resolve()

  assertEquals(resolved?.context.facts, { placeId: 'p-1' })
  assertEquals(await request.text(), body)
})

Deno.test('HttpManifestActionResolver.resolve: reads the body again for a later action after an earlier one read it and fell through', async () => {
  const request = new Request('https://example.test/rpc', {
    method: 'POST',
    body: JSON.stringify({ action: 'p-2' }),
  })
  const resolver = new HttpManifestActionResolver(bodyManifest, request)

  const resolved = await resolver.resolve()

  assertEquals(resolved?.action.name, 'places.profile.update')
  assertEquals(resolved?.context.facts, { placeId: 'p-2' })
})
