/**
 * A single policy's outcome. `Neutral` is distinct from `Deny`: it means the
 * policy had nothing to say (Rego's undefined/no-result), not that it
 * actively disallowed the action.
 */
export enum Verdict {
  Allow = 'allow',
  Deny = 'deny',
  Neutral = 'neutral',
}
