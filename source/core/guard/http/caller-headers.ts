import type * as Access from '@idhn/access'

/** Every header the guard speaks in to the protected service. A caller may never send one of its own. */
const PREFIX = 'x-idhn-'

const SUBJECT = `${PREFIX}subject`
const ISSUER = `${PREFIX}issuer`
const CLAIMS = `${PREFIX}claims`

/**
 * How a guard tells the protected service who is calling, on the request it
 * forwards. Whatever `x-idhn-*` headers the caller sent are dropped, always,
 * so the service can trust the ones that remain; then an authenticated
 * caller is described by:
 *
 * - `x-idhn-subject` — who they are;
 * - `x-idhn-issuer` — who vouches for it;
 * - `x-idhn-claims` — their claims, as base64url-encoded JSON: one header,
 *   because header names lose their case and claims may hold any JSON.
 *
 * Any other caller is described by no header at all. The trust holds only
 * while the service can't be reached except through its guard.
 */
export class CallerHeaders {
  /** The request's headers as the protected service receives them, speaking for `identity`. */
  describe(headers: Headers, identity: Access.Identity): Headers {
    const described = new Headers(headers)
    for (const name of [...described.keys()]) {
      if (name.startsWith(PREFIX)) described.delete(name)
    }
    if (identity.status !== 'authenticated') return described

    described.set(SUBJECT, identity.subject!)
    described.set(ISSUER, identity.issuer!)
    described.set(CLAIMS, this.encode(identity.claims))
    return described
  }

  private encode(claims: Readonly<Record<string, unknown>>): string {
    const bytes = new TextEncoder().encode(JSON.stringify(claims))
    return btoa(String.fromCharCode(...bytes))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '')
  }
}
