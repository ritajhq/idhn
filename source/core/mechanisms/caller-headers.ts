import * as MUX from '@ritaj/mux'

const PREFIX = 'x-idhn-'
const SUBJECT = `${PREFIX}subject`
const ISSUER = `${PREFIX}issuer`
const CLAIMS = `${PREFIX}claims`

/** The caller's own credentials, kept with the guard's word so a relay can present them onward. */
const ONWARD = ['cookie', 'authorization']

/**
 * Who is calling a service behind an idhn guard, as the guard says in the
 * `x-idhn-*` headers it forwards (see the guard's `CallerHeaders`): an
 * authenticated caller is described by them, anyone else by none. The guard
 * drops whatever `x-idhn-*` headers a caller sent, so they can be trusted —
 * only while the service can't be reached except through its guard.
 *
 * The credential it extracts keeps the caller's own `cookie` and
 * `authorization` too, so a service relaying a call on the caller's behalf
 * (to another guard, say) presents what they presented.
 */
export class CallerHeaders implements MUX.Mechanism<MUX.Credentials.Headers> {
  Extract(envelope: MUX.Envelope): MUX.Credentials.Headers | undefined {
    if (envelope.Header(SUBJECT) === undefined) return undefined
    const fields: Record<string, string> = {}
    for (const name of [SUBJECT, ISSUER, CLAIMS, ...ONWARD]) {
      const value = envelope.Header(name)
      if (value !== undefined) fields[name] = value
    }
    return new MUX.Credentials.Headers(fields)
  }

  // deno-lint-ignore require-await
  async Verify(credential: MUX.Credentials.Headers): Promise<MUX.Caller> {
    const subject = credential.Fields[SUBJECT]
    const claims = this.decode(credential.Fields[CLAIMS])
    if (claims === undefined) return MUX.Caller.Invalid
    return MUX.Caller.Authenticated(
      subject,
      credential.Fields[ISSUER] ?? 'idhn',
      claims,
    )
  }

  private decode(
    encoded: string | undefined,
  ): Record<string, unknown> | undefined {
    if (encoded === undefined) return {}
    try {
      const base64 = encoded.replaceAll('-', '+').replaceAll('_', '/')
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
      const claims = JSON.parse(new TextDecoder().decode(bytes))
      return typeof claims === 'object' && claims !== null &&
          !Array.isArray(claims)
        ? claims
        : undefined
    } catch {
      return undefined
    }
  }
}
