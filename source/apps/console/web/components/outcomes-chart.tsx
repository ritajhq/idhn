import { useEffect, useRef, useState } from 'react'
import type * as Contract from '@idhn/contract'

type Outcome = 'forwarded' | 'rejected' | 'failed'

/** The series, bottom of each stack first, and how each is named. */
export const OUTCOMES: readonly { key: Outcome; label: string }[] = [
  { key: 'forwarded', label: 'Let through' },
  { key: 'rejected', label: 'Refused' },
  { key: 'failed', label: 'Failed' },
]

const HEIGHT = 200
const AXIS = 40
const BOTTOM = 22
/** Headroom above the top gridline, so its label is never cut off. */
const TOP = 10
/** The surface gap between touching marks: stacked segments and neighbouring columns alike. */
const GAP = 2
const RADIUS = 4

type Slot = Contract.Audit.OverviewView['series'][number]

/** Every slot of the window, the ones nothing happened in included, so time reads evenly. */
export function slotsOf(overview: Contract.Audit.OverviewView): Slot[] {
  const counted = new Map(
    overview.series.map((slot) => [new Date(slot.at).getTime(), slot]),
  )
  const first =
    Math.floor(new Date(overview.from).getTime() / overview.stepMs) *
    overview.stepMs
  const slots: Slot[] = []
  for (
    let at = first;
    at < new Date(overview.to).getTime();
    at += overview.stepMs
  ) {
    slots.push(
      counted.get(at) ??
        {
          at: new Date(at).toISOString(),
          forwarded: 0,
          rejected: 0,
          failed: 0,
        },
    )
  }
  return slots
}

/** A round step above `max`, so the axis reads 0 / 50 / 100 rather than 0 / 37 / 74. */
function niceMax(max: number): number {
  if (max <= 4) return 4
  const magnitude = 10 ** Math.floor(Math.log10(max))
  const step = [1, 2, 2.5, 5, 10].find((s) => s * magnitude >= max / 4)! *
    magnitude
  return Math.ceil(max / step) * step
}

/** A rectangle with its top corners rounded: the end of a stack, anchored to the baseline. */
function cappedBar(x: number, y: number, w: number, h: number): string {
  const r = Math.min(RADIUS, w / 2, h)
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${
    x + w
  },${y} ${x + w},${y + r}V${y + h}Z`
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  useEffect(() => {
    if (!ref.current) return
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(240, entry.contentRect.width))
    )
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  return { ref, width }
}

const time = (at: string, stepMs: number) =>
  new Date(at).toLocaleString(
    undefined,
    stepMs >= 86_400_000
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' },
  )

/** Requests per slot of the window, stacked by outcome, with a legend and a tooltip per column. */
export function OutcomesChart(
  { overview }: { overview: Contract.Audit.OverviewView },
) {
  const { ref, width } = useWidth()
  const [hovered, setHovered] = useState<number | undefined>()
  const slots = slotsOf(overview)
  const max = niceMax(
    Math.max(0, ...slots.map((s) => s.forwarded + s.rejected + s.failed)),
  )
  const plot = width - AXIS
  const column = plot / Math.max(1, slots.length)
  const barWidth = Math.max(1, column - GAP)
  const y = (count: number) => (count / max) * (HEIGHT - BOTTOM - TOP)
  const ticks = [0, max / 2, max]
  const labelled = new Set([
    0,
    Math.floor((slots.length - 1) / 2),
    slots.length - 1,
  ])
  const slot = hovered === undefined ? undefined : slots[hovered]

  return (
    <div className='grid gap-3'>
      <ul
        className='flex flex-wrap gap-4 text-caption text-muted-foreground'
        aria-label='Legend'
      >
        {OUTCOMES.map(({ key, label }) => (
          <li key={key} className='flex items-center gap-1.5'>
            <span
              className='inline-block size-2.5 rounded-sm'
              style={{ background: `var(--outcome-${key})` }}
            />
            {label}
          </li>
        ))}
      </ul>
      <div ref={ref} className='relative'>
        <svg
          width={width}
          height={HEIGHT}
          role='img'
          aria-label={`Requests by outcome, ${slots.length} slots of ${
            overview.stepMs / 60_000
          } minutes`}
          onMouseLeave={() => setHovered(undefined)}
        >
          {ticks.map((tick) => {
            const at = HEIGHT - BOTTOM - y(tick)
            return (
              <g key={tick}>
                <line
                  x1={AXIS}
                  x2={width}
                  y1={at}
                  y2={at}
                  className='stroke-border'
                  strokeWidth={1}
                />
                <text
                  x={AXIS - 8}
                  y={at}
                  dy='0.32em'
                  textAnchor='end'
                  className='fill-muted-foreground text-[11px]'
                >
                  {tick.toLocaleString()}
                </text>
              </g>
            )
          })}
          {slots.map((s, i) => {
            const x = AXIS + i * column + GAP / 2
            let base = HEIGHT - BOTTOM
            const present = OUTCOMES.filter(({ key }) => s[key] > 0)
            return (
              <g key={s.at}>
                {present.map(({ key }, j) => {
                  const h = y(s[key])
                  const top = base - h
                  // The gap above every segment but the last one stacked.
                  const drawn = j === present.length - 1
                    ? (
                      <path
                        key={key}
                        d={cappedBar(x, top, barWidth, h)}
                        fill={`var(--outcome-${key})`}
                      />
                    )
                    : (
                      <rect
                        key={key}
                        x={x}
                        y={top + GAP}
                        width={barWidth}
                        height={Math.max(0, h - GAP)}
                        fill={`var(--outcome-${key})`}
                      />
                    )
                  base = top
                  return drawn
                })}
                {labelled.has(i) && (
                  <text
                    x={x + barWidth / 2}
                    y={HEIGHT - 6}
                    textAnchor={i === 0
                      ? 'start'
                      : i === slots.length - 1
                      ? 'end'
                      : 'middle'}
                    className='fill-muted-foreground text-[11px]'
                  >
                    {time(s.at, overview.stepMs)}
                  </text>
                )}
                {/* The hover target: the whole column, taller than its marks. */}
                <rect
                  x={AXIS + i * column}
                  y={0}
                  width={column}
                  height={HEIGHT - BOTTOM}
                  fill='transparent'
                  onMouseEnter={() => setHovered(i)}
                />
              </g>
            )
          })}
        </svg>
        {slot && hovered !== undefined && (
          <div
            role='tooltip'
            className='pointer-events-none absolute top-2 z-10 grid min-w-40 gap-1 rounded-lg bg-surface-3 p-2.5 text-caption shadow-surface-3'
            style={{
              left: Math.min(
                width - 168,
                Math.max(0, AXIS + hovered * column + column / 2 - 84),
              ),
            }}
          >
            <span className='font-medium text-foreground'>
              {time(slot.at, overview.stepMs)}
            </span>
            {OUTCOMES.map(({ key, label }) => (
              <span
                key={key}
                className='flex items-center justify-between gap-3 text-muted-foreground'
              >
                <span className='flex items-center gap-1.5'>
                  <span
                    className='inline-block size-2 rounded-sm'
                    style={{ background: `var(--outcome-${key})` }}
                  />
                  {label}
                </span>
                <span className='tabular-nums text-foreground'>
                  {slot[key].toLocaleString()}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
