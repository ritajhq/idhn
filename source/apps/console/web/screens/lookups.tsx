import { useEffect, useState } from 'react'
import * as Contract from '@idhn/contract'
import {
  Badge,
  Button,
  cn,
  InputField,
  InputGroup,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  Switch,
  Tooltip,
  useIcon,
} from '@ritaj/ui'
import type { DraftState } from '../draft.ts'
import { Notice } from '../components/notice.tsx'
import { Panel } from '../components/panel.tsx'

/** What is open in the editor: a lookup of the draft, or a new one. */
type Open = { name: string } | { name: undefined }

/**
 * The facts judges look up before evaluating, for what a request alone can't
 * say. Each provides its fact to policies, and is made for every action they
 * govern: associating an action with one of them brings its lookups along.
 */
export function Lookups({ state }: { state: DraftState }) {
  const { draft, error, change } = state
  const [open, setOpen] = useState<Open | undefined>()
  const lookups = draft?.lookups ?? []
  const PlusIcon = useIcon('plus')

  // Open the first lookup once there is one, and let go of one removed.
  useEffect(() => {
    if (
      open?.name !== undefined && lookups.some((l) => l.name === open.name)
    ) return
    if (open !== undefined && open.name === undefined) return
    setOpen(lookups[0] ? { name: lookups[0].name } : undefined)
  }, [draft])

  const lookup = lookups.find((l) => l.name === open?.name)

  return (
    <Panel
      title='Lookups'
      description='Each answer reaches the policies it provides to as input.<name>'
      action={
        <Button
          size='compact'
          variant='secondary'
          leadingIcon={PlusIcon}
          onClick={() => setOpen({ name: undefined })}
        >
          New lookup
        </Button>
      }
    >
      {error && <Notice tone='error'>{error}</Notice>}
      <div className='grid grid-cols-1 gap-4 md:grid-cols-[16rem_minmax(0,1fr)]'>
        <nav aria-label='Lookups' className='grid content-start gap-1'>
          {lookups.length === 0 && open === undefined && (
            <p className='text-body text-muted-foreground'>No lookups yet</p>
          )}
          {lookups.map((l) => (
            <button
              key={l.name}
              type='button'
              onClick={() => setOpen({ name: l.name })}
              className={cn(
                'flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-body transition-colors hover:bg-hover',
                l.name === open?.name && 'bg-surface-1 shadow-surface-1',
              )}
            >
              <code className='truncate font-mono'>{l.name}</code>
              <Badge color={l.madeFor.length ? 'green' : 'gray'} size='compact'>
                {l.madeFor.length}{' '}
                {l.madeFor.length === 1 ? 'action' : 'actions'}
              </Badge>
            </button>
          ))}
        </nav>
        {draft && open && (
          <div className='grid min-w-0 gap-6'>
            <Editor
              key={open.name ?? 'new'}
              lookup={lookup}
              revision={draft.revision}
              change={change}
              onSaved={(name) => setOpen({ name })}
            />
            {lookup && (
              <Provisions lookup={lookup} draft={draft} change={change} />
            )}
          </div>
        )}
      </div>
    </Panel>
  )
}

function Editor(
  { lookup, revision, change, onSaved }: {
    lookup: Contract.Lookups.LookupView | undefined
    revision: number
    change: DraftState['change']
    onSaved(name: string): void
  },
) {
  const [name, setName] = useState(lookup?.name ?? '')
  const [url, setUrl] = useState(lookup?.url ?? '')
  const [ttl, setTtl] = useState(String(lookup?.ttlSeconds ?? 0))
  const [wait, setWait] = useState(
    lookup?.timeoutMs === undefined ? '' : String(lookup.timeoutMs),
  )
  const [optional, setOptional] = useState(lookup?.optional ?? false)
  const SaveIcon = useIcon('check')
  const edited = name !== (lookup?.name ?? '') ||
    url !== (lookup?.url ?? '') ||
    ttl !== String(lookup?.ttlSeconds ?? 0) ||
    wait !==
      (lookup?.timeoutMs === undefined ? '' : String(lookup.timeoutMs)) ||
    optional !== (lookup?.optional ?? false)

  async function save() {
    const made = await change(
      new Contract.Lookups.Write(
        revision,
        {
          name: name.trim(),
          url,
          ttlSeconds: Number(ttl || 0),
          timeoutMs: wait.trim() ? Number(wait) : undefined,
          optional,
        },
        lookup?.name ?? '',
      ),
    )
    if (made) onSaved(name.trim())
  }

  return (
    <div className='grid min-w-0 gap-3'>
      <h3 className='text-body font-medium'>
        {lookup
          ? <code className='font-mono'>{lookup.name}</code>
          : 'New lookup'}
      </h3>
      <InputGroup>
        <InputField
          index={0}
          label='Fact name'
          placeholder='managed_places'
          value={name}
          onChange={setName}
        />
        <InputField
          index={1}
          label='URL'
          placeholder='http://service:4000/managers/{auth.subject}/places'
          value={url}
          onChange={setUrl}
        />
        <InputField
          index={2}
          label='Keep answers for (seconds)'
          inputMode='numeric'
          value={ttl}
          onChange={setTtl}
        />
        <InputField
          index={3}
          label='Wait for an answer (ms, empty for the default)'
          inputMode='numeric'
          value={wait}
          onChange={setWait}
        />
      </InputGroup>
      <Switch
        label='Optional: judge without the fact when the lookup fails'
        checked={optional}
        onToggle={() => setOptional((on) => !on)}
      />
      <div className='flex flex-wrap items-center gap-2'>
        <Button
          leadingIcon={SaveIcon}
          disabled={!edited || !name.trim() || !url.trim()}
          onClick={save}
        >
          Save to draft
        </Button>
        {lookup && (
          <Button
            variant='ghost'
            onClick={() =>
              change(new Contract.Lookups.Remove(revision, lookup.name))}
          >
            Remove
          </Button>
        )}
      </div>
    </div>
  )
}

/** The policies a lookup provides to, and the actions that makes it for. */
function Provisions(
  { lookup, draft, change }: {
    lookup: Contract.Lookups.LookupView
    draft: Contract.Policies.DraftView
    change: DraftState['change']
  },
) {
  const XIcon = useIcon('x')
  const available = draft.policies.filter((p) =>
    !lookup.providesTo.includes(p.name)
  )

  return (
    <div className='grid gap-3'>
      <h3 className='text-body font-medium'>Provides to</h3>
      <div className='flex flex-wrap items-center gap-1.5'>
        {lookup.providesTo.length === 0 && (
          <Badge variant='dot' color='gray'>no policy: made for nothing</Badge>
        )}
        {lookup.providesTo.map((policy) => (
          <span
            key={policy}
            className='inline-flex items-center gap-1 rounded-md bg-surface-1 py-0.5 pl-2 pr-0.5 shadow-surface-1'
          >
            <code className='font-mono text-caption'>{policy}</code>
            <Tooltip content={`Stop providing to ${policy}`}>
              <Button
                size='icon-compact'
                variant='ghost'
                aria-label={`Withdraw from ${policy}`}
                onClick={() =>
                  change(
                    new Contract.Lookups.Withdraw(
                      draft.revision,
                      lookup.name,
                      policy,
                    ),
                  )}
              >
                <XIcon />
              </Button>
            </Tooltip>
          </span>
        ))}
        {available.length > 0 && (
          <Select
            value=''
            onValueChange={(policy) =>
              policy &&
              change(
                new Contract.Lookups.Provide(
                  draft.revision,
                  lookup.name,
                  policy,
                ),
              )}
          >
            <SelectTrigger
              aria-label={`Provide ${lookup.name} to a policy`}
              placeholder='Policy…'
              className='w-56'
            />
            <SelectContent>
              {available.map((p, i) => (
                <SelectItem key={p.name} index={i} value={p.name}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <p className='text-caption text-muted-foreground'>
        Made for every action those policies govern
        {lookup.madeFor.length > 0 ? ':' : ' — none yet'}
      </p>
      {lookup.madeFor.length > 0 && (
        <div className='flex flex-wrap gap-1.5'>
          {lookup.madeFor.map((action) => (
            <code
              key={action}
              className='rounded-md bg-surface-1 px-2 py-0.5 font-mono text-caption shadow-surface-1'
            >
              {action}
            </code>
          ))}
        </div>
      )}
    </div>
  )
}
