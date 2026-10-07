import { useState } from 'react'
import * as Contract from '@idhn/contract'
import {
  Badge,
  type BadgeColor,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  InputField,
  InputGroup,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  Switch,
  TabItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  useIcon,
} from '@ritaj/ui'
import { Describe } from '../console.ts'
import { useConsole } from '../console-provider.tsx'
import { Notice } from '../components/notice.tsx'
import {
  OUTCOMES,
  OutcomesChart,
  slotsOf,
} from '../components/outcomes-chart.tsx'
import { Panel } from '../components/panel.tsx'
import { useCall } from '../use-call.ts'

const HOUR = 60 * 60_000

/** The windows the audit looks back over. */
const WINDOWS: readonly { value: string; label: string; ms: number }[] = [
  { value: '1h', label: 'Last hour', ms: HOUR },
  { value: '24h', label: '24 hours', ms: 24 * HOUR },
  { value: '7d', label: '7 days', ms: 7 * 24 * HOUR },
  { value: '30d', label: '30 days', ms: 30 * 24 * HOUR },
]

const ALL = 'all'

const OUTCOME_COLORS: Readonly<
  Record<Contract.Audit.RequestView['outcome'], BadgeColor>
> = {
  forwarded: 'blue',
  rejected: 'amber',
  failed: 'red',
}

const VERDICT_COLORS: Readonly<
  Record<'allow' | 'deny' | 'neutral', BadgeColor>
> = {
  allow: 'green',
  deny: 'red',
  neutral: 'gray',
}

/** What guards let through or refused, and why: at a glance, then request by request. */
export function Audit({ refresh }: { refresh: number }) {
  const console = useConsole()
  const [window, setWindow] = useState('24h')
  const [resource, setResource] = useState(ALL)
  const resources = useCall(() => console.Send(new Contract.Resources.List()), [
    refresh,
  ])
  const span = WINDOWS.find((w) => w.value === window)!.ms

  // The window is taken afresh on each load, so "last hour" means the hour before it.
  const overview = useCall(() => {
    const until = new Date()
    return console.Send(
      new Contract.Audit.Overview(
        new Date(until.getTime() - span),
        until,
        resource === ALL ? undefined : resource,
      ),
    )
  }, [refresh, window, resource])

  return (
    <>
      <div className='flex flex-wrap items-center gap-3'>
        <Tabs value={window} onValueChange={setWindow}>
          <TabsList>
            {WINDOWS.map((w) => (
              <TabItem key={w.value} value={w.value} label={w.label} />
            ))}
          </TabsList>
        </Tabs>
        <Select value={resource} onValueChange={setResource}>
          <SelectTrigger aria-label='Resource' className='w-56' />
          <SelectContent>
            <SelectItem index={0} value={ALL}>Every resource</SelectItem>
            {(resources.value ?? []).map((r, i) => (
              <SelectItem key={r.id} index={i + 1} value={r.id}>
                {r.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {overview.error && <Notice tone='error'>{overview.error}</Notice>}
      {overview.value && <Glance overview={overview.value} />}
      <Trails
        refresh={refresh}
        span={span}
        resource={resource === ALL ? undefined : resource}
      />
    </>
  )
}

function Stat(
  { label, value, note }: { label: string; value: string; note?: string },
) {
  return (
    <div className='grid gap-1 rounded-xl bg-surface-2 p-4 shadow-surface-2'>
      <span className='text-caption text-muted-foreground'>{label}</span>
      <span className='text-2xl font-semibold tabular-nums text-foreground'>
        {value}
      </span>
      {note && (
        <span className='text-caption text-muted-foreground'>{note}</span>
      )}
    </div>
  )
}

/** A duration, to a tenth of a millisecond. */
const ms = (n: number) => `${Math.round(n * 10) / 10} ms`

/** A count, compact past a thousand: 1,284 / 12.9K. */
const compact = (n: number) =>
  n < 10_000
    ? n.toLocaleString()
    : new Intl.NumberFormat(undefined, { notation: 'compact' }).format(n)

function share(part: number, whole: number): string | undefined {
  return whole === 0
    ? undefined
    : `${Math.round((part / whole) * 100)}% of requests`
}

/** The overview: totals, outcomes over time, and who and what was denied most. */
function Glance({ overview }: { overview: Contract.Audit.OverviewView }) {
  const [asTable, setAsTable] = useState(false)
  const { forwarded, rejected, failed } = overview.totals
  const total = forwarded + rejected + failed

  return (
    <>
      <div className='grid grid-cols-2 gap-3 md:grid-cols-5'>
        <Stat label='Requests' value={compact(total)} />
        <Stat
          label='Let through'
          value={compact(forwarded)}
          note={share(forwarded, total)}
        />
        <Stat
          label='Refused'
          value={compact(rejected)}
          note={share(rejected, total)}
        />
        <Stat
          label='Failed'
          value={compact(failed)}
          note={share(failed, total)}
        />
        <Stat
          label='Latency, p95'
          value={overview.latency ? `≤ ${overview.latency.p95} ms` : '—'}
          note={overview.latency
            ? `p50 ≤ ${overview.latency.p50} ms`
            : undefined}
        />
      </div>
      <Panel
        title='Requests over time'
        description={`By outcome, ${overview.stepMs / 60_000}-minute slots`}
        action={
          <Switch
            label='Show as table'
            checked={asTable}
            onToggle={() => setAsTable(!asTable)}
          />
        }
      >
        {total === 0 && (
          <p className='text-body text-muted-foreground'>
            No requests in this window
          </p>
        )}
        {total > 0 && !asTable && <OutcomesChart overview={overview} />}
        {total > 0 && asTable && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>From</TableHead>
                {OUTCOMES.map(({ key, label }) => (
                  <TableHead key={key}>{label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {slotsOf(overview).filter((s) =>
                s.forwarded + s.rejected + s.failed > 0
              ).map((s, i) => (
                <TableRow key={s.at} index={i}>
                  <TableCell className='whitespace-nowrap'>
                    {new Date(s.at).toLocaleString()}
                  </TableCell>
                  {OUTCOMES.map(({ key }) => (
                    <TableCell key={key} className='tabular-nums'>
                      {s[key].toLocaleString()}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
      <div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
        <Ranking
          title='Most denied actions'
          description='Refused as forbidden or unauthenticated'
          rows={overview.deniedActions}
          code
        />
        <Ranking
          title='Most denied callers'
          description='Signed in, and refused: raw records only'
          rows={overview.deniedSubjects}
        />
        <Ranking
          title='Policies that denied most'
          description='Each time a policy said deny'
          rows={overview.denyingPolicies}
          code
        />
        <Ranking
          title='Why requests were refused'
          description='Every refusal, by its reason'
          rows={overview.rejections.map((r) => ({
            ...r,
            name: r.name || 'no action matched',
          }))}
        />
      </div>
    </>
  )
}

function Ranking(
  { title, description, rows, code }: {
    title: string
    description: string
    rows: Contract.Audit.Ranked[]
    code?: boolean
  },
) {
  return (
    <Panel title={title} description={description}>
      {rows.length === 0 && (
        <p className='text-body text-muted-foreground'>None</p>
      )}
      {rows.length > 0 && (
        <Table>
          <TableBody>
            {rows.map((row, i) => (
              <TableRow key={row.name} index={i}>
                <TableCell className='min-w-0 break-all'>
                  {code
                    ? <code className='font-mono text-caption'>{row.name}</code>
                    : row.name}
                </TableCell>
                <TableCell className='w-20 text-right tabular-nums'>
                  {row.count.toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  )
}

const OUTCOME_FILTERS = [
  { value: ALL, label: 'Every outcome' },
  ...OUTCOMES.map(({ key, label }) => ({ value: key, label })),
]

/** Request by request, newest first, each with the decision it got. */
function Trails(
  { refresh, span, resource }: {
    refresh: number
    span: number
    resource: string | undefined
  },
) {
  const console = useConsole()
  const [outcome, setOutcome] = useState(ALL)
  const [subject, setSubject] = useState('')
  const [pages, setPages] = useState<Contract.Audit.TrailsPage[]>([])
  const [open, setOpen] = useState<Contract.Audit.TrailView | undefined>()
  const [error, setError] = useState<string | undefined>()
  const SearchIcon = useIcon('search')

  const ask = (cursor?: string) => {
    const until = new Date()
    return console.Send(
      new Contract.Audit.Trails(
        new Date(until.getTime() - span),
        until,
        {
          ...(resource ? { resource } : {}),
          ...(outcome !== ALL
            ? { outcome: outcome as Contract.Audit.Filters['outcome'] }
            : {}),
          ...(subject.trim() ? { subject: subject.trim() } : {}),
        },
        50,
        cursor,
      ),
    )
  }

  const first = useCall(async () => {
    const page = await ask()
    setPages([page])
    return page
  }, [refresh, span, resource, outcome, subject])

  async function more() {
    try {
      setPages([...pages, await ask(pages.at(-1)?.next)])
    } catch (e) {
      setError(Describe(e))
    }
  }

  const trails = pages.flatMap((page) => page.trails)

  return (
    <Panel
      title='Requests'
      description='Newest first; open one to see how it was decided'
    >
      <div className='flex flex-wrap items-end gap-3'>
        <Select value={outcome} onValueChange={setOutcome}>
          <SelectTrigger aria-label='Outcome' className='w-44' />
          <SelectContent>
            {OUTCOME_FILTERS.map((o, i) => (
              <SelectItem key={o.value} index={i} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <InputGroup className='min-w-0 flex-1'>
          <InputField
            index={0}
            label='Caller'
            labelHidden
            placeholder='Caller (subject)'
            icon={SearchIcon}
            value={subject}
            onChange={setSubject}
          />
        </InputGroup>
      </div>
      {(first.error || error) && (
        <Notice tone='error'>{first.error ?? error}</Notice>
      )}
      {trails.length === 0 && !first.loading && (
        <p className='text-body text-muted-foreground'>No requests match</p>
      )}
      {trails.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Caller</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead>Request</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trails.map((trail, i) => (
              <TableRow
                key={trail.request.recordId}
                index={i}
                className='cursor-pointer'
                onClick={() => setOpen(trail)}
              >
                <TableCell className='whitespace-nowrap'>
                  {new Date(trail.request.timestamp).toLocaleString()}
                </TableCell>
                <TableCell>
                  {trail.request.identity?.subject ??
                    trail.request.identity?.status ?? '—'}
                </TableCell>
                <TableCell>
                  {trail.request.action
                    ? (
                      <code className='font-mono text-caption'>
                        {trail.request.action}
                      </code>
                    )
                    : (
                      <span className='text-muted-foreground'>
                        no action matched
                      </span>
                    )}
                </TableCell>
                <TableCell>
                  <span className='flex flex-wrap items-center gap-1.5'>
                    <Badge
                      variant='dot'
                      color={OUTCOME_COLORS[trail.request.outcome]}
                    >
                      {trail.request.outcome}
                    </Badge>
                    {trail.request.rejection && (
                      <span className='text-caption text-muted-foreground'>
                        {trail.request.rejection}
                      </span>
                    )}
                  </span>
                </TableCell>
                <TableCell className='font-mono text-caption'>
                  {trail.request.method} {trail.request.path}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {pages.at(-1)?.next && (
        <Button variant='secondary' onClick={more}>Older requests</Button>
      )}
      <Dialog
        open={open !== undefined}
        onOpenChange={(o) => !o && setOpen(undefined)}
      >
        <DialogContent className='max-w-2xl'>
          {open && <TrailDetail trail={open} />}
        </DialogContent>
      </Dialog>
    </Panel>
  )
}

function TrailDetail({ trail }: { trail: Contract.Audit.TrailView }) {
  const { request, decision } = trail
  return (
    <>
      <DialogHeader>
        <DialogTitle>{request.action ?? 'No action matched'}</DialogTitle>
        <DialogDescription>
          {new Date(request.timestamp).toLocaleString()} · {request.method}{' '}
          {request.path} · {ms(request.durationMs)}
        </DialogDescription>
      </DialogHeader>
      <dl className='grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-body'>
        <dt className='text-muted-foreground'>Caller</dt>
        <dd>
          {request.identity
            ? `${request.identity.subject ?? '—'} (${request.identity.status})`
            : '—'}
        </dd>
        <dt className='text-muted-foreground'>Outcome</dt>
        <dd className='flex items-center gap-2'>
          <Badge variant='dot' color={OUTCOME_COLORS[request.outcome]}>
            {request.outcome}
          </Badge>
          {request.rejection}
        </dd>
        {request.error && (
          <>
            <dt className='text-muted-foreground'>Error</dt>
            <dd>{request.error}</dd>
          </>
        )}
        {request.source && (
          <>
            <dt className='text-muted-foreground'>Guard</dt>
            <dd className='font-mono text-caption'>
              {request.source.instance}
            </dd>
          </>
        )}
        <dt className='text-muted-foreground'>Decision</dt>
        <dd>
          {decision
            ? (
              <span className='grid gap-1.5'>
                <span>{decision.outcome}, in {ms(decision.durationMs)}</span>
                {decision.results.map((result) => (
                  <span key={result.policy} className='flex items-center gap-2'>
                    <Badge
                      color={VERDICT_COLORS[result.verdict]}
                      size='compact'
                    >
                      {result.verdict}
                    </Badge>
                    <code className='font-mono text-caption'>
                      {result.policy}
                    </code>
                  </span>
                ))}
                {decision.results.length === 0 && (
                  <span className='text-caption text-muted-foreground'>
                    No policy governs this action
                  </span>
                )}
              </span>
            )
            : <span className='text-muted-foreground'>No judge was asked</span>}
        </dd>
      </dl>
      {decision && (
        <div className='grid gap-1.5'>
          <span className='text-caption text-muted-foreground'>
            What the policies saw (sensitive fields covered)
          </span>
          <pre className='max-h-64 overflow-auto rounded-lg bg-surface-1 p-3 font-mono text-caption shadow-surface-1'>
            {JSON.stringify(decision.context, null, 2)}
          </pre>
        </div>
      )}
    </>
  )
}
