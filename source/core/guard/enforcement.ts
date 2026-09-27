import * as Judge from '@idhn/judge'

/**
 * How much of its job a guard does:
 *
 * - `full`: authenticates the caller, then asks the judge.
 * - `authn-only`: authenticates the caller and lets any authenticated one
 *   through, asking no judge.
 * - `permissive`: lets every caller through, neither authenticating it nor
 *   asking a judge.
 *
 * Anything but `full` is for development only.
 */
export const ENFORCEMENT_LEVELS = ['full', 'authn-only', 'permissive'] as const

export type EnforcementLevel = typeof ENFORCEMENT_LEVELS[number]

/** Builds the judge a `full` guard asks, awaiting whatever it is built from. */
type Judging = () => Judge.Behavior | Promise<Judge.Behavior>

type JudgeFor = (judging: Judging) => Promise<Judge.Behavior>

const JUDGES: Readonly<Record<EnforcementLevel, JudgeFor>> = {
  full: async (judging) => await judging(),
  'authn-only': () => Promise.resolve(new Judge.AuthenticatedOnly()),
  permissive: () => Promise.resolve(new Judge.Permissive()),
}

const AUTHENTICATES: Readonly<Record<EnforcementLevel, boolean>> = {
  full: true,
  'authn-only': true,
  permissive: false,
}

/**
 * Picks a guard's judge and authentication for its `EnforcementLevel`. What
 * only some levels use is handed in as a function that builds it, so a level
 * that doesn't use it never builds it, nor needs the settings it is built
 * from.
 */
export class Enforcement {
  constructor(private readonly level: EnforcementLevel) {}

  /** The judge to ask: the one `judging` builds at `full`, a stand-in otherwise. */
  judge(judging: Judging): Promise<Judge.Behavior> {
    return JUDGES[this.level](judging)
  }

  /** How to authenticate callers: the scheme `declared` builds, or the one `none` builds when this level authenticates no one. */
  authentication<Scheme>(declared: () => Scheme, none: () => Scheme): Scheme {
    if (!AUTHENTICATES[this.level]) {
      return none()
    }
    return declared()
  }
}
