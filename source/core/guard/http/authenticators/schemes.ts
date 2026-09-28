import type {
  HttpAuthentication,
  HttpAuthenticationDeclaration,
  HttpAuthentications,
  HttpAuthenticationScheme,
} from '../../manifest/http/schema.ts'
import { FirstPresented } from './first-presented.ts'
import type { Scheme } from './scheme.ts'

/** How a deployment builds each scheme it supports from a manifest's settings. A scheme left out is unsupported. */
export type Supported = {
  [S in HttpAuthenticationScheme]?: (settings: HttpAuthentications[S]) => Scheme
}

export class UnsupportedSchemeError extends Error {}

/**
 * The authentication schemes one deployment supports, wired in `main.ts`
 * (which is also where a scheme gets its secrets, from the environment).
 * `for()` builds the scheme a manifest declares (every listed one, when it
 * lists several), and fails at startup when the deployment does not support
 * one rather than letting requests through unauthenticated.
 */
export class Schemes {
  constructor(private readonly supported: Supported) {}

  for(authentication: HttpAuthenticationDeclaration): Scheme {
    if (Array.isArray(authentication)) {
      return new FirstPresented(
        authentication.map((scheme) => this.one(scheme)),
      )
    }
    return this.one(authentication as HttpAuthentication)
  }

  private one(authentication: HttpAuthentication): Scheme {
    const build = this.supported[authentication.scheme] as
      | ((settings: HttpAuthentication) => Scheme)
      | undefined
    if (build === undefined) {
      throw new UnsupportedSchemeError(
        `manifest.authentication.scheme "${authentication.scheme}" is not supported by this deployment (supported: ${
          Object.keys(this.supported).join(', ')
        })`,
      )
    }
    return build(authentication)
  }
}
