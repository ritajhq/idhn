import { assertEquals } from '@std/assert'
import * as Access from '@idhn/access'
import * as Guard from '@idhn/guard'
import * as MUX from '@ritaj/mux'
import { CallerHeaders } from './caller-headers.ts'

/** The envelope of a request as a guard forwards it for `identity`. */
function forwarded(
  identity: Access.Identity,
  sent: HeadersInit = {},
): MUX.Envelope {
  const headers = new Guard.CallerHeaders().describe(
    new Headers(sent),
    identity,
  )
  return new MUX.Envelope(Object.fromEntries(headers))
}

Deno.test('CallerHeaders: the caller is who the guard in front says, keeping their own credential to present onward', async () => {
  const mechanism = new CallerHeaders()
  const envelope = forwarded(
    Access.Identity.authenticated('u-1', 'https://auth.test', {
      role: 'admin',
      name: 'Ada',
    }),
    { cookie: 'sid=abc', 'x-other': 'dropped' },
  )
  const credential = mechanism.Extract(envelope)!
  const caller = await mechanism.Verify(credential)
  assertEquals([caller.Status, caller.Subject, caller.Issuer], [
    'authenticated',
    'u-1',
    'https://auth.test',
  ])
  assertEquals(caller.Claims, { role: 'admin', name: 'Ada' })

  const onward = new MUX.Envelope()
  credential.PresentIn(onward)
  assertEquals(onward.Header('cookie'), 'sid=abc')
  assertEquals(onward.Header('x-other'), undefined)
})

Deno.test('CallerHeaders: no word from the guard is no caller, and claims it cannot read make an invalid one', async () => {
  const mechanism = new CallerHeaders()
  assertEquals(
    mechanism.Extract(
      forwarded(Access.Identity.anonymous(), { cookie: 'sid=abc' }),
    ),
    undefined,
  )
  const garbled = mechanism.Extract(
    new MUX.Envelope({ 'x-idhn-subject': 'u-1', 'x-idhn-claims': '!!' }),
  )!
  assertEquals((await mechanism.Verify(garbled)).Status, 'invalid')
})
