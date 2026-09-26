/**
 * What authentication found on a request: a verified identity, no credential
 * at all, a credential that failed verification, or a credential that could
 * not be checked because the identity provider was unreachable.
 */
export type IdentityStatus =
  | 'authenticated'
  | 'anonymous'
  | 'invalid'
  | 'unavailable'

/**
 * Who an attempted action is attributed to, as far as authentication could
 * tell. Authentication only reports this; it never rejects a request.
 * Whether an identity is good enough is for the policies to decide, which
 * read it as the reserved `auth` fact of the `Context`.
 */
export class Identity {
  /** The context fact an `Identity` is contributed under. Nothing but authentication may write it. */
  static readonly FACT = 'auth'

  private constructor(
    readonly status: IdentityStatus,
    readonly subject: string | undefined,
    readonly issuer: string | undefined,
    readonly claims: Readonly<Record<string, unknown>>,
  ) {}

  static authenticated(
    subject: string,
    issuer: string,
    claims: Record<string, unknown> = {},
  ): Identity {
    if (subject.trim().length === 0) {
      throw new InvalidIdentityError(
        'An authenticated subject must not be empty',
      )
    }
    return new Identity(
      'authenticated',
      subject,
      issuer,
      Object.freeze({ ...claims }),
    )
  }

  static anonymous(): Identity {
    return new Identity('anonymous', undefined, undefined, Object.freeze({}))
  }

  static invalid(): Identity {
    return new Identity('invalid', undefined, undefined, Object.freeze({}))
  }

  /** A credential was presented but could not be checked. Policies that need an identity deny it; public ones are unaffected. */
  static unavailable(): Identity {
    return new Identity('unavailable', undefined, undefined, Object.freeze({}))
  }

  /** The plain document policies see as `input.auth`. */
  toFact(): Record<string, unknown> {
    return {
      status: this.status,
      ...(this.subject === undefined ? {} : { subject: this.subject }),
      ...(this.issuer === undefined ? {} : { issuer: this.issuer }),
      claims: { ...this.claims },
    }
  }
}

export class InvalidIdentityError extends Error {}
