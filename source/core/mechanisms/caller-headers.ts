import * as MUX from '@ritaj/mux'

const PREFIX = 'x-idhn-'
const SUBJECT = `${PREFIX}subject`
const ISSUER = `${PREFIX}issuer`
const CLAIMS = `${PREFIX}claims`

/** The caller's own credentials, kept with the guard's word so a relay can present them onward. */
const ONWARD = ['cookie', 'authorization']

/**
 * What a guard forwarded with a request: its word on who is calling, for
 * this service to read, and the caller's own credential, which is all a
 * relay presents onward — the guard's word is never passed on, so a service
 * relayed to without a guard in front can't be told who is calling by it.
 */
export class Forwarded extends MUX.Credential {
  constructor(
    readonly Word: Readonly<Record<string, string>>,
    private readonly own: Readonly<Record<string, string>>,
  ) {
    super()
  }

  PresentIn(envelope: MUX.Envelope): void {
    for (const [name, value] of Object.entries(this.own)) {
      envelope.SetHeader(name, value)
    }
  }
}

/**
 * Who is calling a service behind an idhn guard, as the guard says in the
 * `x-idhn-*` headers it forwards (see the guard's `CallerHeaders`): an
 * authenticated caller is described by them, anyone else by none. The guard
 * drops whatever `x-idhn-*` headers a caller sent, so they can be trusted —
 * only while the service can't be reached except through its guard.
 *
 * The credential it extracts keeps the caller's own `cookie` and
 * `authorization` too, so a service relaying a call on the caller's behalf
 * (to another guard, say) presents what they presented — and only that.
 */
export class CallerHeaders implements MUX.Mechanism<Forwarded> {
  Extract(envelope: MUX.Envelope): Forwarded | undefined {
    if (envelope.Header(SUBJECT) === undefined) return undefined
    return new Forwarded(
      this.pick(envelope, [SUBJECT, ISSUER, CLAIMS]),
      this.pick(envelope, ONWARD),
    )
  }

  // deno-lint-ignore require-await
  async Verify(credential: Forwarded): Promise<MUX.Caller> {
    const subject = credential.Word[SUBJECT]
    const claims = this.decode(credential.Word[CLAIMS])
    if (claims === undefined) return MUX.Caller.Invalid
    return MUX.Caller.Authenticated(
      subject,
      credential.Word[ISSUER] ?? 'idhn',
      claims,
    )
  }

  private pick(
    envelope: MUX.Envelope,
    names: readonly string[],
  ): Record<string, string> {
    const fields: Record<string, string> = {}
    for (const name of names) {
      const value = envelope.Header(name)
      if (value !== undefined) fields[name] = value
    }
    return fields
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
