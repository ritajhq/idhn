import { useCallback, useEffect, useState } from 'react'
import * as Contract from '@idhn/contract'
import type * as Horizon from '@ritaj/horizon'
import { Describe } from './console.ts'
import { useConsole } from './console-provider.tsx'

/** The draft everyone authors, and the one way to change it. */
export interface DraftState {
  readonly draft: Contract.Policies.DraftView | undefined
  readonly error: string | undefined
  /**
   * Sends a change made on the draft as last read; whether it was made. A
   * change on a draft someone else has changed since is not made: the draft
   * is reloaded and the error says so.
   */
  readonly change: (
    call: Horizon.Action<
      Contract.Policies.DraftView,
      Contract.Rejected | Contract.Stale
    >,
  ) => Promise<boolean>
  readonly reload: () => void
}

export function useDraft(refresh: number): DraftState {
  const console = useConsole()
  const [draft, setDraft] = useState<Contract.Policies.DraftView | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [round, setRound] = useState(0)
  const reload = useCallback(() => setRound((n) => n + 1), [])

  useEffect(() => {
    console.Send(new Contract.Policies.Draft())
      .then((loaded) => {
        setDraft(loaded)
        setError(undefined)
      })
      .catch((e) => setError(Describe(e)))
  }, [refresh, round])

  const change = useCallback(
    async (
      call: Horizon.Action<
        Contract.Policies.DraftView,
        Contract.Rejected | Contract.Stale
      >,
    ) => {
      try {
        setDraft(await console.Send(call))
        setError(undefined)
        return true
      } catch (e) {
        if (e instanceof Contract.Stale) reload()
        setError(Describe(e))
        return false
      }
    },
    [console, reload],
  )

  return { draft, error, change, reload }
}
