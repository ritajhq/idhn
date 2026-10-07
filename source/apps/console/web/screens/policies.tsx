import { useEffect, useState } from 'react'
import * as Contract from '@idhn/contract'
import {
  Badge,
  Button,
  cn,
  TabItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TabPanel,
  Tabs,
  TabsList,
  useIcon,
} from '@ritaj/ui'
import { Describe } from '../console.ts'
import { useConsole } from '../console-provider.tsx'
import type { DraftState } from '../draft.ts'
import { CodeField } from '../components/code-field.tsx'
import { Notice } from '../components/notice.tsx'
import { Panel } from '../components/panel.tsx'
import { useCall } from '../use-call.ts'

/** Where a new policy starts: a package to name it, denying until it says otherwise. */
const STARTER = `package shop.orders

default allow := false

allow if input.auth.status == "authenticated"
`

/** What is open in the editor: a policy of the draft, or a new one. */
type Open = { name: string } | { name: undefined }

/** The policies judges evaluate: authored in the draft, checked by the builder, then published. */
export function Policies({ state }: { state: DraftState }) {
  const { draft, error, change } = state
  const [open, setOpen] = useState<Open | undefined>()
  const policies = draft?.policies ?? []
  const PlusIcon = useIcon('plus')

  // Open the first policy once there is one, and let go of one removed.
  useEffect(() => {
    if (
      open?.name !== undefined && policies.some((p) => p.name === open.name)
    ) return
    if (open !== undefined && open.name === undefined) return
    setOpen(policies[0] ? { name: policies[0].name } : undefined)
  }, [draft])

  const policy = policies.find((p) => p.name === open?.name)

  return (
    <>
      <Panel
        title='Policies'
        description='Each one a Rego package; its name is the package it declares'
        action={
          <Button
            size='compact'
            variant='secondary'
            leadingIcon={PlusIcon}
            onClick={() => setOpen({ name: undefined })}
          >
            New policy
          </Button>
        }
      >
        {error && <Notice tone='error'>{error}</Notice>}
        <div className='grid grid-cols-1 gap-4 md:grid-cols-[16rem_minmax(0,1fr)]'>
          <nav aria-label='Policies' className='grid content-start gap-1'>
            {policies.length === 0 && open === undefined && (
              <p className='text-body text-muted-foreground'>No policies yet</p>
            )}
            {policies.map((p) => (
              <button
                key={p.name}
                type='button'
                onClick={() => setOpen({ name: p.name })}
                className={cn(
                  'flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-body transition-colors hover:bg-hover',
                  p.name === open?.name && 'bg-surface-1 shadow-surface-1',
                )}
              >
                <code className='truncate font-mono'>{p.name}</code>
                <Badge
                  color={p.governs.length ? 'green' : 'gray'}
                  size='compact'
                >
                  {p.governs.length}{' '}
                  {p.governs.length === 1 ? 'action' : 'actions'}
                </Badge>
              </button>
            ))}
          </nav>
          {draft && open && (
            <Editor
              key={open.name ?? 'new'}
              policy={policy}
              revision={draft.revision}
              change={change}
              onSaved={(name) => setOpen({ name })}
            />
          )}
        </div>
      </Panel>
      {draft && <Publishing revision={draft.revision} state={state} />}
    </>
  )
}

function Editor(
  { policy, revision, change, onSaved }: {
    policy: Contract.Policies.PolicyView | undefined
    revision: number
    change: DraftState['change']
    onSaved(name: string): void
  },
) {
  const [source, setSource] = useState(policy?.source ?? STARTER)
  const [tests, setTests] = useState(policy?.tests ?? '')
  const [tab, setTab] = useState('source')
  const [saved, setSaved] = useState(false)
  const SaveIcon = useIcon('check')
  const edited = source !== (policy?.source ?? STARTER) ||
    tests !== (policy?.tests ?? '')

  async function save() {
    setSaved(false)
    const made = await change(
      new Contract.Policies.Write(revision, source, tests, policy?.name ?? ''),
    )
    if (!made) return
    setSaved(true)
    const declared = /^\s*package\s+([\w.]+)/m.exec(source)?.[1]
    if (declared) onSaved(declared)
  }

  return (
    <div className='grid min-w-0 gap-3'>
      <div className='flex flex-wrap items-center gap-2'>
        <h3 className='text-body font-medium'>
          {policy
            ? <code className='font-mono'>{policy.name}</code>
            : 'New policy'}
        </h3>
        {policy && policy.governs.length > 0 && (
          <span className='text-caption text-muted-foreground'>
            governs {policy.governs.join(', ')}
          </span>
        )}
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabItem value='source' label='Source' />
          <TabItem value='tests' label='Tests' />
        </TabsList>
        <TabPanel value='source' className='pt-3'>
          <CodeField
            aria-label='Policy source'
            rows={16}
            value={source}
            onChange={(event) => setSource(event.target.value)}
          />
        </TabPanel>
        <TabPanel value='tests' className='pt-3'>
          <CodeField
            aria-label='Policy tests'
            rows={16}
            placeholder={`package ${
              policy?.name ?? 'shop.orders'
            }_test\n\ntest_… if …`}
            value={tests}
            onChange={(event) => setTests(event.target.value)}
          />
        </TabPanel>
      </Tabs>
      <div className='flex flex-wrap items-center gap-2'>
        <Button leadingIcon={SaveIcon} disabled={!edited} onClick={save}>
          Save to draft
        </Button>
        {policy && (
          <Button
            variant='ghost'
            onClick={() =>
              change(new Contract.Policies.Remove(revision, policy.name))}
          >
            Remove
          </Button>
        )}
        {saved && !edited && (
          <span className='text-caption text-muted-foreground'>
            Saved: check and publish it below
          </span>
        )}
      </div>
    </div>
  )
}

/** Checking the draft with the builder, publishing it, and the revisions published before. */
function Publishing(
  { revision, state }: { revision: number; state: DraftState },
) {
  const console = useConsole()
  const [round, setRound] = useState(0)
  const revisions = useCall(
    () => console.Send(new Contract.Policies.Revisions()),
    [round],
  )
  const [checked, setChecked] = useState<
    { revision: number; problems: string[] } | undefined
  >()
  const [busy, setBusy] = useState<'check' | 'publish' | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [message, setMessage] = useState<string | undefined>()
  const CheckIcon = useIcon('check')
  const RocketIcon = useIcon('rocket')
  const RestoreIcon = useIcon('rotate-ccw')

  async function run(kind: 'check' | 'publish', work: () => Promise<void>) {
    setBusy(kind)
    setError(undefined)
    setMessage(undefined)
    try {
      await work()
    } catch (e) {
      if (e instanceof Contract.Rejected && e.Reason === 'does_not_build') {
        setChecked({ revision, problems: e.Details })
      } else setError(Describe(e))
    } finally {
      setBusy(undefined)
    }
  }

  const check = () =>
    run('check', async () => {
      const problems = await console.Send(new Contract.Policies.Check(revision))
      setChecked({ revision, problems })
    })

  const publish = () =>
    run('publish', async () => {
      const published = await console.Send(new Contract.Policies.Publish())
      setChecked({ revision, problems: [] })
      setMessage(
        `Published as ${published.version}: judges pick it up on their next pull`,
      )
      setRound((n) => n + 1)
    })

  async function restore(number: number) {
    if (await state.change(new Contract.Policies.Restore(revision, number))) {
      setMessage(
        `The draft is r${number}'s sources again: publish to serve them`,
      )
    }
  }

  const current = checked?.revision === revision ? checked : undefined

  return (
    <>
      <Panel
        title='Publish'
        description={`Draft revision ${revision}: the builder checks, tests and compiles it before judges get it`}
        action={
          <div className='flex gap-2'>
            <Button
              size='compact'
              variant='secondary'
              leadingIcon={CheckIcon}
              loading={busy === 'check'}
              disabled={busy !== undefined}
              onClick={check}
            >
              Check
            </Button>
            <Button
              size='compact'
              leadingIcon={RocketIcon}
              loading={busy === 'publish'}
              disabled={busy !== undefined}
              onClick={publish}
            >
              Publish
            </Button>
          </div>
        }
      >
        {error && <Notice tone='error'>{error}</Notice>}
        {message && <Notice tone='success'>{message}</Notice>}
        {current && current.problems.length === 0 && !message && (
          <Notice tone='success'>It builds: every check and test passes</Notice>
        )}
        {current && current.problems.length > 0 && (
          <Notice tone='error' details={`${current.problems.length} to fix`}>
            It doesn't build yet
          </Notice>
        )}
        {current && current.problems.length > 0 && (
          <pre className='overflow-x-auto rounded-lg bg-surface-1 p-3 font-mono text-caption shadow-surface-1'>
            {current.problems.join('\n\n')}
          </pre>
        )}
      </Panel>
      <Panel
        title='Revisions'
        description='Every publication; restoring one puts its sources back in the draft'
      >
        {revisions.error && <Notice tone='error'>{revisions.error}</Notice>}
        {(revisions.value ?? []).length === 0 && !revisions.loading && (
          <p className='text-body text-muted-foreground'>
            Nothing published yet
          </p>
        )}
        {(revisions.value ?? []).length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead>Published</TableHead>
                <TableHead>By</TableHead>
                <TableHead>From draft</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(revisions.value ?? []).map((r, i) => (
                <TableRow key={r.number} index={i}>
                  <TableCell>
                    <span className='flex items-center gap-2'>
                      <code className='font-mono'>{r.version}</code>
                      {i === 0 && (
                        <Badge variant='dot' color='green'>serving</Badge>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className='whitespace-nowrap'>
                    {new Date(r.publishedAt).toLocaleString()}
                  </TableCell>
                  <TableCell>{r.publishedBy}</TableCell>
                  <TableCell>revision {r.draftRevision}</TableCell>
                  <TableCell>
                    <div className='flex justify-end'>
                      <Button
                        size='compact'
                        variant='ghost'
                        leadingIcon={RestoreIcon}
                        onClick={() =>
                          restore(r.number)}
                      >
                        Restore
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </>
  )
}
