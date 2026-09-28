/** A `PolicySet` as it travels: the bundle base64-encoded, every document as its text. */
export interface PolicySetBody {
  version: string
  bundle: string
  registry: string
  enrichment: string | null
  data: string | null
}

/** Where a policy builder offers its current policy set. */
export const POLICIES_PATH = '/policies'
