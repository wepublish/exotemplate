<script lang="ts" setup>
  import type {
    ChartBand,
    SentryChartSeries,
    SentrySeriesPoint
  } from '~/utils/sentry'

  const props = defineProps<{
    series: SentryChartSeries[]
    // Short unit suffix for axis / tooltips, e.g. 'ms'.
    unitLabel: string
    // Optional shaded threshold bands drawn behind the chart.
    bands?: ChartBand[]
  }>()

  const { formatNumber, formatDate, formatDateTime } = useFormatters()

  // Internal coordinate system; the SVG scales to its container via viewBox.
  const W = 800
  const H = 280
  const PAD = { l: 52, r: 16, t: 12, b: 32 }
  const plotW = W - PAD.l - PAD.r
  const plotH = H - PAD.t - PAD.b

  // One text-colour class per series (stroke = currentColor). Green (brand)
  // first, then distinct hues for additional lines.
  const SERIES_COLORS = [
    'text-primary',
    'text-sky-500',
    'text-amber-500',
    'text-rose-500'
  ]
  function colorFor(i: number): string {
    return SERIES_COLORS[i % SERIES_COLORS.length]!
  }

  // 'p90(span.duration)' → 'p90' for a compact legend label.
  function seriesLabel(name: string): string {
    const m = name.match(/^([^(]+)\(/)
    return m ? m[1]! : name
  }

  function finite(pts: SentrySeriesPoint[]): number[] {
    return pts
      .map((p) => p.value)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  }

  function niceCeil(v: number): number {
    if (!Number.isFinite(v) || v <= 0) return 1
    const pow = Math.pow(10, Math.floor(Math.log10(v)))
    const n = v / pow
    const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
    return step * pow
  }

  const geom = computed(() => {
    const allPts = props.series.flatMap((s) => s.points)
    const allValues = props.series.flatMap((s) => finite(s.points))

    if (allPts.length < 2 || allValues.length === 0) {
      return null
    }

    const timestamps = allPts.map((p) => p.timestamp)
    const t0 = Math.min(...timestamps)
    const t1 = Math.max(...timestamps)
    const span = t1 - t0 || 1
    const yMax = niceCeil(Math.max(...allValues))

    const xFor = (ts: number) => PAD.l + ((ts - t0) / span) * plotW
    const yFor = (v: number) => PAD.t + (1 - v / yMax) * plotH

    // Shaded threshold bands, clamped to the visible value range. A band whose
    // lower bound is already above yMax is off-screen and dropped; open-ended
    // bands (to === null) fill up to the top of the plot.
    const bandRects = (props.bands ?? [])
      .filter((b) => b.from < yMax)
      .map((b) => {
        const top = Math.min(b.to ?? yMax, yMax)
        const yTop = yFor(top)
        const yBottom = yFor(Math.max(b.from, 0))
        return {
          x: PAD.l,
          y: yTop,
          width: plotW,
          height: yBottom - yTop,
          color: b.color
        }
      })

    // Per series: line segments (breaking on null buckets) + hover dots.
    const lines = props.series.map((s, seriesIdx) => {
      const segments: string[] = []
      let run: SentrySeriesPoint[] = []
      const flush = () => {
        if (run.length >= 2) {
          segments.push(
            run
              .map(
                (p, i) =>
                  `${i === 0 ? 'M' : 'L'}${xFor(p.timestamp).toFixed(2)} ${yFor(p.value as number).toFixed(2)}`
              )
              .join(' ')
          )
        }
        run = []
      }
      for (const p of s.points) {
        if (typeof p.value === 'number' && Number.isFinite(p.value)) run.push(p)
        else flush()
      }
      flush()

      const dots = s.points
        .filter(
          (p): p is SentrySeriesPoint & { value: number } =>
            typeof p.value === 'number' && Number.isFinite(p.value)
        )
        .map((p) => ({
          cx: xFor(p.timestamp),
          cy: yFor(p.value),
          ts: p.timestamp,
          value: p.value
        }))

      return {
        name: s.name,
        label: seriesLabel(s.name),
        color: colorFor(seriesIdx),
        segments,
        dots
      }
    })

    // Horizontal gridlines + y labels (0 → yMax in 4 steps).
    const yTicks = Array.from({ length: 5 }, (_, i) => {
      const v = (yMax / 4) * i
      return { v, y: yFor(v) }
    })

    // ~6 evenly spaced x labels, from the densest series (buckets are uniform).
    const tickPts = props.series.reduce(
      (best, s) => (s.points.length > best.length ? s.points : best),
      [] as SentrySeriesPoint[]
    )
    const xTickCount = Math.min(6, tickPts.length)
    const xTicks = Array.from({ length: xTickCount }, (_, i) => {
      const idx =
        xTickCount > 1
          ? Math.round((i / (xTickCount - 1)) * (tickPts.length - 1))
          : 0
      const p = tickPts[idx]!
      return { x: xFor(p.timestamp), ts: p.timestamp }
    })

    return { lines, yTicks, xTicks, bandRects }
  })
</script>

<template>
  <div class="w-full">
    <!-- Legend (only meaningful with more than one line) -->
    <div v-if="geom && geom.lines.length > 1" class="flex flex-wrap gap-4 mb-2">
      <div
        v-for="line in geom.lines"
        :key="`legend-${line.name}`"
        class="flex items-center gap-1.5 text-xs text-muted"
      >
        <span
          class="inline-block w-3 h-0.5 rounded"
          :class="line.color"
          style="background-color: currentColor"
        />
        {{ line.label }}
      </div>
    </div>

    <svg
      v-if="geom"
      :viewBox="`0 0 ${W} ${H}`"
      class="w-full h-auto"
      preserveAspectRatio="none"
      role="img"
    >
      <!-- Threshold bands (behind everything else) -->
      <rect
        v-for="(band, i) in geom.bandRects"
        :key="`band${i}`"
        :x="band.x"
        :y="band.y"
        :width="band.width"
        :height="band.height"
        :class="band.color"
      />

      <!-- Gridlines + y-axis labels -->
      <g v-for="(tick, i) in geom.yTicks" :key="`y${i}`">
        <line
          :x1="PAD.l"
          :x2="W - PAD.r"
          :y1="tick.y"
          :y2="tick.y"
          class="stroke-gray-200 dark:stroke-gray-800"
          stroke-width="1"
          vector-effect="non-scaling-stroke"
        />
        <text
          :x="PAD.l - 8"
          :y="tick.y + 3"
          text-anchor="end"
          class="fill-gray-500 dark:fill-gray-400"
          font-size="11"
        >
          {{ formatNumber(tick.v, { maximumFractionDigits: 0 }) }}
        </text>
      </g>

      <!-- x-axis labels -->
      <text
        v-for="(tick, i) in geom.xTicks"
        :key="`x${i}`"
        :x="tick.x"
        :y="H - 10"
        :text-anchor="
          i === 0 ? 'start' : i === geom.xTicks.length - 1 ? 'end' : 'middle'
        "
        class="fill-gray-500 dark:fill-gray-400"
        font-size="11"
      >
        {{ formatDate(tick.ts, { day: '2-digit', month: '2-digit' }) }}
      </text>

      <!-- One coloured line (+ hover dots) per series -->
      <g
        v-for="line in geom.lines"
        :key="`series-${line.name}`"
        :class="line.color"
      >
        <path
          v-for="(s, i) in line.segments"
          :key="`s${i}`"
          :d="s"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linejoin="round"
          stroke-linecap="round"
          vector-effect="non-scaling-stroke"
        />
        <circle
          v-for="(d, i) in line.dots"
          :key="`d${i}`"
          :cx="d.cx"
          :cy="d.cy"
          r="2.5"
          fill="currentColor"
          class="transition-[r] hover:opacity-100"
        >
          <title>
            {{ line.label }} — {{ formatDateTime(d.ts) }} —
            {{ formatNumber(d.value, { maximumFractionDigits: 0 }) }}
            {{ unitLabel }}
          </title>
        </circle>
      </g>
    </svg>
  </div>
</template>
