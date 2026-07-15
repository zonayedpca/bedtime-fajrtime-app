import {
  CalculationMethod,
  Coordinates,
  Madhab,
  PrayerTimes,
  Rounding,
} from 'adhan'
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  GripVertical,
  Info,
  LockKeyhole,
  Minus,
  MoonStar,
  MoveVertical,
  Plus,
  Settings2,
  Smartphone,
  Sparkles,
  Sun,
  Sunrise,
  X,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import './App.css'

type ThemeMode = 'auto' | 'light' | 'dark'
type DragMode = 'bedtime' | 'wake' | null

type DaySchedule = {
  key: string
  date: Date
  dayIndex: number
  fajrStart: number
  fajrEnd: number
  solarSunrise: number
  sunset: number
  wake: number
  duration: number
  bedtime: number
  actualLead: number
}

type HoverState = {
  index: number
  clientX: number
  clientY: number
  pointerType: string
} | null

type StoredSettings = {
  duration: number
  wakeLead: number
  theme: ThemeMode
  endAdjustment: number
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const DHAKA_TIME_ZONE = 'Asia/Dhaka'
const DHAKA_COORDINATES = new Coordinates(23.8103, 90.4125)
const MIN_DURATION = 5 * 60
const MAX_DURATION = 10 * 60
const DEFAULT_DURATION = 6 * 60 + 45
const MIN_WAKE_LEAD = 5
const MAX_WAKE_LEAD = 90
const DEFAULT_WAKE_LEAD = 15
const NIGHT_START = 18 * 60
const NIGHT_END = 31 * 60 + 30
const MOBILE_BREAKPOINT = '(max-width: 767px)'
const STORAGE_KEY = 'before-fajr:v3'
const LEGACY_STORAGE_KEYS = ['before-fajr:v2', 'fajr-sleep-planner:v1']

const DESKTOP_CHART = {
  width: 1460,
  height: 490,
  margin: { top: 34, right: 30, bottom: 58, left: 76 },
}

const MOBILE_CHART = {
  width: 430,
  height: 500,
  margin: { top: 38, right: 22, bottom: 62, left: 66 },
}

const monthFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  timeZone: DHAKA_TIME_ZONE,
})
const monthLongFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  timeZone: DHAKA_TIME_ZONE,
})
const longDateFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: DHAKA_TIME_ZONE,
})
const shortDateFormatter = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  timeZone: DHAKA_TIME_ZONE,
})

function roundToFive(minutes: number) {
  return Math.round(minutes / 5) * 5
}

function ceilToFive(minutes: number) {
  return Math.ceil(minutes / 5) * 5
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function daysInYear(year: number) {
  return new Date(year, 1, 29).getMonth() === 1 ? 366 : 365
}

function dayIndexForDate(year: number, month: number, day: number) {
  const start = new Date(year, 0, 1, 12).getTime()
  const target = new Date(year, month, day, 12).getTime()
  return Math.round((target - start) / 86_400_000)
}

function dateKey(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: DHAKA_TIME_ZONE,
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function dhakaTodayParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: DHAKA_TIME_ZONE,
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  }
}

function zonedMinutes(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: DHAKA_TIME_ZONE,
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return Number(values.hour) * 60 + Number(values.minute)
}

function toNightMinutes(clockMinutes: number) {
  const normalized = ((clockMinutes % (24 * 60)) + 24 * 60) % (24 * 60)
  return normalized >= NIGHT_START
    ? normalized - NIGHT_START
    : normalized + 24 * 60 - NIGHT_START
}

function fromNightMinutes(nightMinutes: number) {
  return (nightMinutes + NIGHT_START) % (24 * 60)
}

function formatClock(clockMinutes: number) {
  const normalized = ((clockMinutes % (24 * 60)) + 24 * 60) % (24 * 60)
  const hour24 = Math.floor(normalized / 60)
  const minute = normalized % 60
  const suffix = hour24 >= 12 ? 'PM' : 'AM'
  const hour12 = hour24 % 12 || 12
  return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return mins ? `${hours}h ${mins}m` : `${hours}h`
}

function createPrayerTimes(date: Date) {
  const params = CalculationMethod.Karachi()
  params.madhab = Madhab.Hanafi
  params.rounding = Rounding.Nearest
  return new PrayerTimes(DHAKA_COORDINATES, date, params)
}

function pathFor(
  values: number[],
  x: (index: number) => number,
  y: (value: number) => number,
) {
  return values
    .map((value, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(2)} ${y(value).toFixed(2)}`)
    .join(' ')
}

function bandPath(
  upper: number[],
  lower: number[],
  x: (index: number) => number,
  y: (value: number) => number,
) {
  const forward = upper
    .map((value, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(2)} ${y(value).toFixed(2)}`)
    .join(' ')
  const backward = lower
    .map((_, reversedIndex) => {
      const index = lower.length - 1 - reversedIndex
      return `L ${x(index).toFixed(2)} ${y(lower[index]).toFixed(2)}`
    })
    .join(' ')
  return `${forward} ${backward} Z`
}

function loadSettings(): StoredSettings {
  const candidates = [STORAGE_KEY, ...LEGACY_STORAGE_KEYS]
  for (const key of candidates) {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw)
      return {
        duration: typeof parsed.duration === 'number' ? parsed.duration : DEFAULT_DURATION,
        wakeLead: typeof parsed.wakeLead === 'number' ? parsed.wakeLead : DEFAULT_WAKE_LEAD,
        theme: (['auto', 'light', 'dark'].includes(parsed.theme) ? parsed.theme : 'auto') as ThemeMode,
        endAdjustment: typeof parsed.endAdjustment === 'number' ? parsed.endAdjustment : 0,
      }
    } catch {
      // Try the next stored version.
    }
  }

  return {
    duration: DEFAULT_DURATION,
    wakeLead: DEFAULT_WAKE_LEAD,
    theme: 'auto',
    endAdjustment: 0,
  }
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)

  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setMatches(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [query])

  return matches
}

function App() {
  const initialSettings = useMemo(loadSettings, [])
  const todayParts = useMemo(dhakaTodayParts, [])
  const isMobile = useMediaQuery(MOBILE_BREAKPOINT)
  const [year, setYear] = useState(todayParts.year)
  const [mobileMonth, setMobileMonth] = useState(todayParts.month - 1)
  const [targetDuration, setTargetDuration] = useState(initialSettings.duration)
  const [wakeLead, setWakeLead] = useState(initialSettings.wakeLead)
  const [themeMode, setThemeMode] = useState<ThemeMode>(initialSettings.theme)
  const [endAdjustment, setEndAdjustment] = useState(initialSettings.endAdjustment)
  const [selectedIndex, setSelectedIndex] = useState(() => dayIndexForDate(todayParts.year, todayParts.month - 1, todayParts.day))
  const [hover, setHover] = useState<HoverState>(null)
  const [dragMode, setDragMode] = useState<DragMode>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showInstallHelp, setShowInstallHelp] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(() => window.matchMedia('(display-mode: standalone)').matches)
  const [now, setNow] = useState(new Date())
  const chartRef = useRef<SVGSVGElement | null>(null)
  const chartViewportRef = useRef<HTMLDivElement | null>(null)
  const dragIndexRef = useRef<number | null>(null)
  const dragModeRef = useRef<DragMode>(null)

  const schedules = useMemo<DaySchedule[]>(() => {
    const count = daysInYear(year)
    return Array.from({ length: count }, (_, dayIndex) => {
      const date = new Date(year, 0, dayIndex + 1, 12, 0, 0)
      const prayers = createPrayerTimes(date)
      const fajrStartClock = zonedMinutes(prayers.fajr)
      const solarSunriseClock = zonedMinutes(prayers.sunrise)
      const fajrEndClock = solarSunriseClock + endAdjustment
      const sunsetClock = zonedMinutes(prayers.maghrib)
      const wakeClock = ceilToFive(fajrEndClock - wakeLead)
      const wake = toNightMinutes(wakeClock)

      return {
        key: dateKey(date),
        date,
        dayIndex,
        fajrStart: toNightMinutes(fajrStartClock),
        fajrEnd: toNightMinutes(fajrEndClock),
        solarSunrise: toNightMinutes(solarSunriseClock),
        sunset: sunsetClock,
        wake,
        duration: targetDuration,
        bedtime: wake - targetDuration,
        actualLead: fajrEndClock - wakeClock,
      }
    })
  }, [year, endAdjustment, targetDuration, wakeLead])

  useEffect(() => {
    if (year === todayParts.year) {
      const todayIndex = dayIndexForDate(year, todayParts.month - 1, todayParts.day)
      setSelectedIndex(todayIndex)
      setMobileMonth(todayParts.month - 1)
    } else {
      setSelectedIndex(0)
      setMobileMonth(0)
    }
  }, [todayParts.day, todayParts.month, todayParts.year, year])

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        duration: targetDuration,
        wakeLead,
        theme: themeMode,
        endAdjustment,
      }),
    )
  }, [targetDuration, wakeLead, themeMode, endAdjustment])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setIsInstalled(true)
      setInstallPrompt(null)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const selected = schedules[clamp(selectedIndex, 0, schedules.length - 1)]
  const hovered = hover ? schedules[hover.index] : null
  const todaySchedule = schedules.find((item) => item.key === dateKey(now))

  const resolvedTheme = useMemo(() => {
    if (themeMode !== 'auto') return themeMode
    if (!todaySchedule) return 'dark'
    const currentMinute = zonedMinutes(now)
    const sunrise = fromNightMinutes(todaySchedule.solarSunrise)
    return currentMinute >= sunrise && currentMinute < todaySchedule.sunset ? 'light' : 'dark'
  }, [now, themeMode, todaySchedule])

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolvedTheme === 'dark' ? '#07131c' : '#eef7f4')
  }, [resolvedTheme])

  const visibleRange = useMemo(() => {
    if (!isMobile) return { start: 0, end: schedules.length - 1 }
    const start = dayIndexForDate(year, mobileMonth, 1)
    const monthDays = new Date(year, mobileMonth + 1, 0).getDate()
    return { start, end: start + monthDays - 1 }
  }, [isMobile, mobileMonth, schedules.length, year])

  const visibleSchedules = useMemo(
    () => schedules.slice(visibleRange.start, visibleRange.end + 1),
    [schedules, visibleRange.end, visibleRange.start],
  )

  useEffect(() => {
    if (!isMobile || !selected) return
    const selectedMonth = selected.date.getMonth()
    if (selectedMonth !== mobileMonth) setMobileMonth(selectedMonth)
  }, [isMobile, mobileMonth, selected])

  const chartConfig = isMobile ? MOBILE_CHART : DESKTOP_CHART
  const plotWidth = chartConfig.width - chartConfig.margin.left - chartConfig.margin.right
  const plotHeight = chartConfig.height - chartConfig.margin.top - chartConfig.margin.bottom

  const xScale = useCallback(
    (localIndex: number) => chartConfig.margin.left + (localIndex / Math.max(visibleSchedules.length - 1, 1)) * plotWidth,
    [chartConfig.margin.left, plotWidth, visibleSchedules.length],
  )
  const yScale = useCallback(
    (nightMinutes: number) => chartConfig.margin.top + (nightMinutes / (NIGHT_END - NIGHT_START)) * plotHeight,
    [chartConfig.margin.top, plotHeight],
  )

  const bedtimeValues = visibleSchedules.map((item) => item.bedtime)
  const wakeValues = visibleSchedules.map((item) => item.wake)
  const fajrStartValues = visibleSchedules.map((item) => item.fajrStart)
  const fajrEndValues = visibleSchedules.map((item) => item.fajrEnd)

  const monthStarts = useMemo(() => {
    return Array.from({ length: 12 }, (_, month) => {
      const date = new Date(year, month, 1, 12)
      return {
        month,
        globalIndex: dayIndexForDate(year, month, 1),
        label: monthFormatter.format(date),
      }
    })
  }, [year])

  const mobileDateTicks = useMemo(() => {
    if (!isMobile) return []
    const last = visibleSchedules.length - 1
    return visibleSchedules
      .map((day, index) => ({ day, index }))
      .filter(({ day, index }) => index === 0 || index === last || day.date.getDate() % 5 === 0)
  }, [isMobile, visibleSchedules])

  const pointerToChart = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    const svg = chartRef.current
    if (!svg) return null
    const rect = svg.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) / rect.width) * chartConfig.width,
      y: ((event.clientY - rect.top) / rect.height) * chartConfig.height,
      pixelsToChartY: chartConfig.height / Math.max(rect.height, 1),
    }
  }, [chartConfig.height, chartConfig.width])

  const nearestLocalIndex = useCallback(
    (chartX: number) => clamp(
      Math.round(((chartX - chartConfig.margin.left) / plotWidth) * (visibleSchedules.length - 1)),
      0,
      visibleSchedules.length - 1,
    ),
    [chartConfig.margin.left, plotWidth, visibleSchedules.length],
  )

  const updateFromDrag = useCallback((mode: Exclude<DragMode, null>, globalIndex: number, chartY: number) => {
    const day = schedules[globalIndex]
    if (!day) return
    const rawNightMinute = ((chartY - chartConfig.margin.top) / plotHeight) * (NIGHT_END - NIGHT_START)

    if (mode === 'bedtime') {
      const bedtime = roundToFive(clamp(rawNightMinute, day.wake - MAX_DURATION, day.wake - MIN_DURATION))
      setTargetDuration(roundToFive(clamp(day.wake - bedtime, MIN_DURATION, MAX_DURATION)))
      return
    }

    const lead = roundToFive(clamp(day.fajrEnd - rawNightMinute, MIN_WAKE_LEAD, MAX_WAKE_LEAD))
    setWakeLead(lead)
  }, [chartConfig.margin.top, plotHeight, schedules])

  const startDrag = (
    mode: Exclude<DragMode, null>,
    globalIndex: number,
    event: ReactPointerEvent<SVGSVGElement>,
  ) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragModeRef.current = mode
    dragIndexRef.current = globalIndex
    setDragMode(mode)
  }

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const point = pointerToChart(event)
    if (!point) return

    if (dragModeRef.current && dragIndexRef.current !== null) {
      event.preventDefault()
      const globalIndex = dragIndexRef.current
      setSelectedIndex(globalIndex)
      setHover({ index: globalIndex, clientX: event.clientX, clientY: event.clientY, pointerType: event.pointerType })
      updateFromDrag(dragModeRef.current, globalIndex, point.y)
      return
    }

    if (event.pointerType === 'touch') return
    const localIndex = nearestLocalIndex(point.x)
    const globalIndex = visibleRange.start + localIndex
    setHover({ index: globalIndex, clientX: event.clientX, clientY: event.clientY, pointerType: event.pointerType })
  }

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    const point = pointerToChart(event)
    if (!point) return
    const localIndex = nearestLocalIndex(point.x)
    const globalIndex = visibleRange.start + localIndex
    const day = schedules[globalIndex]
    if (!day) return

    setSelectedIndex(globalIndex)
    setHover({ index: globalIndex, clientX: event.clientX, clientY: event.clientY, pointerType: event.pointerType })

    const pixelThreshold = event.pointerType === 'touch' ? 34 : 18
    const threshold = pixelThreshold * point.pixelsToChartY
    const bedtimeDistance = Math.abs(point.y - yScale(day.bedtime))
    const wakeDistance = Math.abs(point.y - yScale(day.wake))

    if (bedtimeDistance <= threshold && bedtimeDistance <= wakeDistance) {
      startDrag('bedtime', globalIndex, event)
    } else if (wakeDistance <= threshold) {
      startDrag('wake', globalIndex, event)
    }
  }

  const stopDragging = (event?: ReactPointerEvent<SVGSVGElement>) => {
    if (event && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragModeRef.current = null
    dragIndexRef.current = null
    setDragMode(null)
  }

  const changeTargetDuration = (next: number) => {
    setTargetDuration(roundToFive(clamp(next, MIN_DURATION, MAX_DURATION)))
  }

  const changeWakeLead = (next: number) => {
    setWakeLead(roundToFive(clamp(next, MIN_WAKE_LEAD, MAX_WAKE_LEAD)))
  }

  const changeMonth = (nextMonth: number) => {
    const normalized = (nextMonth + 12) % 12
    setMobileMonth(normalized)
    const currentDay = selected?.date.getDate() ?? 1
    const maxDay = new Date(year, normalized + 1, 0).getDate()
    setSelectedIndex(dayIndexForDate(year, normalized, Math.min(currentDay, maxDay)))
    setHover(null)
  }

  const installApp = async () => {
    if (installPrompt) {
      await installPrompt.prompt()
      const choice = await installPrompt.userChoice
      if (choice.outcome === 'accepted') setInstallPrompt(null)
      return
    }
    setShowInstallHelp(true)
  }

  const themeOptions: Array<{ value: ThemeMode; label: string; icon: typeof Sun }> = [
    { value: 'auto', label: 'Auto', icon: Sparkles },
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: MoonStar },
  ]

  const todayCard = todaySchedule ?? selected
  const selectedFajrWindow = selected.fajrEnd - selected.fajrStart
  const tooltipVisible = hovered && hover && hover.pointerType !== 'touch' && !dragMode
  const selectedLocalIndex = selectedIndex - visibleRange.start
  const selectedIsVisible = selectedLocalIndex >= 0 && selectedLocalIndex < visibleSchedules.length

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="topbar">
        <div className="brand">
          <img className="brand-icon" src="/icons/icon-192.png" alt="" />
          <div>
            <strong>Before Fajr</strong>
            <span>Dhaka sleep planner</span>
          </div>
        </div>
        <div className="topbar-actions">
          {!isInstalled && (
            <button className="install-button" onClick={installApp}>
              <Download size={16} /> <span>Install</span>
            </button>
          )}
          {isInstalled && <span className="installed-badge"><Check size={14} /> Installed</span>}
          <button className="icon-button" onClick={() => setShowSettings(true)} aria-label="Open settings">
            <Settings2 size={19} />
          </button>
        </div>
      </header>

      <main>
        <section className="hero-section">
          <div className="hero-copy">
            <div className="eyebrow"><Sparkles size={13} /> Wake before Fajr ends</div>
            <h1>Plan sleep around the <span>last minutes of Fajr.</span></h1>
            <p>Choose your sleep length and how early you want to wake. Both curves stay in five-minute steps and update every date together.</p>
          </div>

          <div className="tonight-card glass-card">
            <div className="tonight-heading">
              <div>
                <span className="card-kicker">Tonight’s plan</span>
                <strong>{shortDateFormatter.format(todayCard.date)}</strong>
              </div>
              <span className="location-chip"><Sunrise size={14} /> Dhaka</span>
            </div>
            <div className="tonight-times">
              <div><span>Sleep</span><strong>{formatClock(fromNightMinutes(todayCard.bedtime))}</strong><small>{formatDuration(targetDuration)}</small></div>
              <span className="time-connector" />
              <div><span>Wake</span><strong>{formatClock(fromNightMinutes(todayCard.wake))}</strong><small>{todayCard.actualLead} min before end</small></div>
            </div>
            <div className="fajr-end-row">
              <span>Fajr ends</span>
              <strong>{formatClock(fromNightMinutes(todayCard.fajrEnd))}</strong>
            </div>
          </div>
        </section>

        <section className="planner-card glass-card">
          <div className="planner-header">
            <div>
              <span className="section-label">Interactive sleep rhythm</span>
              <h2>{isMobile ? `${monthLongFormatter.format(new Date(year, mobileMonth, 1))} ${year}` : `${year} annual plan`}</h2>
              <p>{isMobile ? 'Tap a date, then drag either large handle vertically.' : 'Hover for exact times. Drag the bedtime or wake curve to reshape the whole year.'}</p>
            </div>
            <div className="year-picker">
              <button onClick={() => setYear((current) => current - 1)} aria-label="Previous year"><ChevronLeft size={17} /></button>
              <strong>{year}</strong>
              <button onClick={() => setYear((current) => current + 1)} aria-label="Next year"><ChevronRight size={17} /></button>
            </div>
          </div>

          {isMobile && (
            <div className="mobile-month-navigation">
              <button className="month-arrow" onClick={() => changeMonth(mobileMonth - 1)} aria-label="Previous month"><ChevronLeft size={18} /></button>
              <div className="month-strip" aria-label="Choose month">
                {monthStarts.map(({ month, label }) => (
                  <button
                    key={month}
                    className={mobileMonth === month ? 'active' : ''}
                    onClick={() => changeMonth(month)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button className="month-arrow" onClick={() => changeMonth(mobileMonth + 1)} aria-label="Next month"><ChevronRight size={18} /></button>
            </div>
          )}

          <div className="legend-row">
            <span><i className="legend-swatch bedtime" /> Bedtime <em>drag</em></span>
            <span><i className="legend-swatch wake" /> Wake <em>drag</em></span>
            <span><i className="legend-swatch fajr-start" /> Fajr begins</span>
            <span><i className="legend-swatch fajr-end" /> Fajr ends</span>
          </div>

          <div className={`mobile-gesture-card ${dragMode ? 'active' : ''}`}>
            <MoveVertical size={17} />
            <span>{dragMode === 'bedtime' ? 'Changing sleep duration for every date' : dragMode === 'wake' ? 'Changing wake buffer for every date' : 'Tap a date, then drag the purple or green handle'}</span>
          </div>

          <div
            ref={chartViewportRef}
            className={`chart-viewport ${dragMode ? `is-dragging ${dragMode}` : ''}`}
          >
            <svg
              ref={chartRef}
              className="sleep-chart"
              viewBox={`0 0 ${chartConfig.width} ${chartConfig.height}`}
              role="img"
              aria-label="Interactive graph showing bedtime, wake-up, Fajr start, and Fajr end"
              onPointerMove={handlePointerMove}
              onPointerDown={handlePointerDown}
              onPointerUp={stopDragging}
              onPointerCancel={stopDragging}
              onPointerLeave={() => {
                if (!dragModeRef.current) setHover(null)
              }}
            >
              <defs>
                <linearGradient id="sleepBand" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-bedtime)" stopOpacity="0.31" />
                  <stop offset="100%" stopColor="var(--chart-wake)" stopOpacity="0.08" />
                </linearGradient>
                <linearGradient id="fajrBand" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-fajr-start)" stopOpacity="0.04" />
                  <stop offset="100%" stopColor="var(--chart-fajr-end)" stopOpacity="0.17" />
                </linearGradient>
                <filter id="pointGlow" x="-200%" y="-200%" width="400%" height="400%">
                  <feGaussianBlur stdDeviation="5" result="blur" />
                  <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>

              <g className="chart-grid">
                {Array.from({ length: 14 }, (_, index) => {
                  const absoluteHour = 18 + index
                  const nightMinute = absoluteHour * 60 - NIGHT_START
                  if (nightMinute > NIGHT_END - NIGHT_START) return null
                  return (
                    <g key={absoluteHour}>
                      <line x1={chartConfig.margin.left} x2={chartConfig.margin.left + plotWidth} y1={yScale(nightMinute)} y2={yScale(nightMinute)} />
                      <text x={chartConfig.margin.left - 12} y={yScale(nightMinute) + 4} textAnchor="end">{formatClock((absoluteHour % 24) * 60).replace(':00', '')}</text>
                    </g>
                  )
                })}
              </g>

              {!isMobile && monthStarts.map(({ month, globalIndex, label }) => {
                const localIndex = globalIndex - visibleRange.start
                return (
                  <g className="month-marker" key={month}>
                    <line x1={xScale(localIndex)} x2={xScale(localIndex)} y1={chartConfig.margin.top} y2={chartConfig.margin.top + plotHeight} />
                    <text x={xScale(localIndex) + 5} y={chartConfig.height - 19}>{label}</text>
                  </g>
                )
              })}

              {isMobile && mobileDateTicks.map(({ day, index }) => (
                <g className="date-marker" key={day.key}>
                  <line x1={xScale(index)} x2={xScale(index)} y1={chartConfig.margin.top} y2={chartConfig.margin.top + plotHeight} />
                  <text x={xScale(index)} y={chartConfig.height - 20} textAnchor="middle">{day.date.getDate()}</text>
                </g>
              ))}

              <g className="chart-data">
                <path className="fajr-band" d={bandPath(fajrStartValues, fajrEndValues, xScale, yScale)} />
                <path className="sleep-band" d={bandPath(bedtimeValues, wakeValues, xScale, yScale)} />
                <path className="line fajr-start-line" d={pathFor(fajrStartValues, xScale, yScale)} />
                <path className="line fajr-end-line" d={pathFor(fajrEndValues, xScale, yScale)} />
                <path className="line wake-line draggable-line" d={pathFor(wakeValues, xScale, yScale)} />
                <path className="line bedtime-line draggable-line" d={pathFor(bedtimeValues, xScale, yScale)} />

                {hovered && hovered.dayIndex >= visibleRange.start && hovered.dayIndex <= visibleRange.end && (
                  <>
                    <line className="hover-column" x1={xScale(hovered.dayIndex - visibleRange.start)} x2={xScale(hovered.dayIndex - visibleRange.start)} y1={chartConfig.margin.top} y2={chartConfig.margin.top + plotHeight} />
                    <circle className="hover-point bedtime-point" cx={xScale(hovered.dayIndex - visibleRange.start)} cy={yScale(hovered.bedtime)} r="4" />
                    <circle className="hover-point wake-point" cx={xScale(hovered.dayIndex - visibleRange.start)} cy={yScale(hovered.wake)} r="4" />
                    <circle className="hover-point fajr-start-point" cx={xScale(hovered.dayIndex - visibleRange.start)} cy={yScale(hovered.fajrStart)} r="4" />
                    <circle className="hover-point fajr-end-point" cx={xScale(hovered.dayIndex - visibleRange.start)} cy={yScale(hovered.fajrEnd)} r="4" />
                  </>
                )}

                {selectedIsVisible && (
                  <>
                    <line className="selected-column" x1={xScale(selectedLocalIndex)} x2={xScale(selectedLocalIndex)} y1={chartConfig.margin.top} y2={chartConfig.margin.top + plotHeight} />

                    <circle className="selected-halo bedtime-halo" cx={xScale(selectedLocalIndex)} cy={yScale(selected.bedtime)} r={isMobile ? 24 : 18} />
                    <circle className="selected-handle bedtime-handle" cx={xScale(selectedLocalIndex)} cy={yScale(selected.bedtime)} r={isMobile ? 12 : 8} filter="url(#pointGlow)" />
                    <g className="handle-label bedtime-label" transform={`translate(${xScale(selectedLocalIndex)} ${yScale(selected.bedtime) - (isMobile ? 26 : 20)})`}>
                      <rect x="-55" y="-16" width="110" height="25" rx="12" />
                      <text textAnchor="middle" y="1">Sleep {formatDuration(targetDuration)}</text>
                    </g>

                    <circle className="selected-halo wake-halo" cx={xScale(selectedLocalIndex)} cy={yScale(selected.wake)} r={isMobile ? 24 : 18} />
                    <circle className="selected-handle wake-handle" cx={xScale(selectedLocalIndex)} cy={yScale(selected.wake)} r={isMobile ? 12 : 8} filter="url(#pointGlow)" />
                    <g className="handle-label wake-label" transform={`translate(${xScale(selectedLocalIndex)} ${yScale(selected.wake) + (isMobile ? 34 : 29)})`}>
                      <rect x="-56" y="-12" width="112" height="25" rx="12" />
                      <text textAnchor="middle" y="5">Wake {wakeLead}m early</text>
                    </g>
                  </>
                )}
              </g>

              <text className="y-axis-title" transform={`translate(20 ${chartConfig.margin.top + plotHeight / 2}) rotate(-90)`}>Dhaka local time</text>
            </svg>

            {tooltipVisible && (
              <div
                className="chart-tooltip"
                style={{
                  left: clamp(
                    hover.clientX - (chartViewportRef.current?.getBoundingClientRect().left ?? 0) + 16,
                    10,
                    (chartViewportRef.current?.clientWidth ?? 900) - 246,
                  ),
                  top: clamp(
                    hover.clientY - (chartViewportRef.current?.getBoundingClientRect().top ?? 0) - 120,
                    12,
                    390,
                  ),
                }}
              >
                <div className="tooltip-title">
                  <div>
                    <strong>{shortDateFormatter.format(hovered.date)}</strong>
                    <span>Current global plan</span>
                  </div>
                  <span className="global-badge"><GripVertical size={11} /> Global</span>
                </div>
                <dl>
                  <div><dt>Bedtime</dt><dd>{formatClock(fromNightMinutes(hovered.bedtime))}</dd></div>
                  <div><dt>Sleep</dt><dd>{formatDuration(hovered.duration)}</dd></div>
                  <div><dt>Fajr begins</dt><dd>{formatClock(fromNightMinutes(hovered.fajrStart))}</dd></div>
                  <div><dt>Wake</dt><dd>{formatClock(fromNightMinutes(hovered.wake))}</dd></div>
                  <div><dt>Fajr ends</dt><dd>{formatClock(fromNightMinutes(hovered.fajrEnd))}</dd></div>
                  <div><dt>Actual buffer</dt><dd>{hovered.actualLead} min</dd></div>
                </dl>
              </div>
            )}
          </div>

          <div className="chart-footnote">
            <span><i className="drag-indicator bedtime" /> Drag bedtime to change sleep for every date</span>
            <span><i className="drag-indicator wake" /> Drag wake to change the buffer for every date</span>
          </div>

          <div className="day-inspector">
            <div className="inspector-heading">
              <div>
                <span className="section-label">Selected date</span>
                <h3>{longDateFormatter.format(selected.date)}</h3>
              </div>
              <CalendarDays size={19} />
            </div>

            <div className="inspector-grid">
              <div className="metric bedtime-metric"><span>Bedtime</span><strong>{formatClock(fromNightMinutes(selected.bedtime))}</strong><small>Global curve</small></div>
              <div className="metric"><span>Sleep</span><strong>{formatDuration(selected.duration)}</strong><small>Until wake-up</small></div>
              <div className="metric"><span>Fajr begins</span><strong>{formatClock(fromNightMinutes(selected.fajrStart))}</strong><small>{formatDuration(selectedFajrWindow)} window</small></div>
              <div className="metric wake-metric"><span>Wake</span><strong>{formatClock(fromNightMinutes(selected.wake))}</strong><small><LockKeyhole size={11} /> {selected.actualLead} min before end</small></div>
              <div className="metric end-metric"><span>Fajr ends</span><strong>{formatClock(fromNightMinutes(selected.fajrEnd))}</strong><small>Sunrise</small></div>
              <div className="metric"><span>Wake target</span><strong>{wakeLead} min</strong><small>Snapped to 5 minutes</small></div>
            </div>

            <div className="mobile-global-controls">
              <div className="global-stepper bedtime-stepper">
                <div><span>Sleep duration</span><strong>{formatDuration(targetDuration)}</strong></div>
                <div className="stepper-buttons">
                  <button onClick={() => changeTargetDuration(targetDuration - 5)} aria-label="Sleep five minutes less"><Minus size={18} /></button>
                  <button onClick={() => changeTargetDuration(targetDuration + 5)} aria-label="Sleep five minutes more"><Plus size={18} /></button>
                </div>
              </div>
              <div className="global-stepper wake-stepper">
                <div><span>Wake before Fajr ends</span><strong>{wakeLead} minutes</strong></div>
                <div className="stepper-buttons">
                  <button onClick={() => changeWakeLead(wakeLead - 5)} aria-label="Wake five minutes later"><Minus size={18} /></button>
                  <button onClick={() => changeWakeLead(wakeLead + 5)} aria-label="Wake five minutes earlier"><Plus size={18} /></button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="control-grid">
          <div className="control-card glass-card bedtime-control-card">
            <div className="card-title-row">
              <div>
                <span className="section-label">Global sleep duration</span>
                <h3>{formatDuration(targetDuration)}</h3>
              </div>
              <Clock3 size={21} />
            </div>
            <input
              className="duration-slider"
              type="range"
              min={MIN_DURATION}
              max={MAX_DURATION}
              step={5}
              value={targetDuration}
              onChange={(event) => changeTargetDuration(Number(event.target.value))}
              aria-label="Global sleep duration"
            />
            <div className="range-labels"><span>5 hours</span><span>10 hours</span></div>
            <div className="preset-row">
              {[390, 405, 420, 450, 480].map((duration) => (
                <button key={duration} className={targetDuration === duration ? 'active' : ''} onClick={() => changeTargetDuration(duration)}>
                  {formatDuration(duration)}
                </button>
              ))}
            </div>
            <p>Dragging the purple graph curve changes this value and moves every bedtime together.</p>
          </div>

          <div className="control-card glass-card wake-control-card">
            <div className="card-title-row">
              <div>
                <span className="section-label">Wake before Fajr ends</span>
                <h3>{wakeLead} minutes</h3>
              </div>
              <Sunrise size={21} />
            </div>
            <input
              className="wake-slider"
              type="range"
              min={MIN_WAKE_LEAD}
              max={MAX_WAKE_LEAD}
              step={5}
              value={wakeLead}
              onChange={(event) => changeWakeLead(Number(event.target.value))}
              aria-label="Minutes to wake before Fajr ends"
            />
            <div className="range-labels"><span>5 min</span><span>90 min</span></div>
            <div className="preset-row">
              {[10, 15, 20, 30, 45].map((lead) => (
                <button key={lead} className={wakeLead === lead ? 'active' : ''} onClick={() => changeWakeLead(lead)}>
                  {lead} min
                </button>
              ))}
            </div>
            <p>The green wake curve is also draggable. The exact daily buffer can vary by a few minutes because wake time snaps to five-minute marks.</p>
          </div>
        </section>

        <section className="explanation-card glass-card">
          <div className="card-title-row">
            <div>
              <span className="section-label">How the anchor works</span>
              <h3>Fajr ends at sunrise</h3>
            </div>
            <Sunrise size={21} />
          </div>
          <div className="anchor-flow">
            <div><i className="fajr-start-dot" /><span>Fajr begins</span><strong>{formatClock(fromNightMinutes(selected.fajrStart))}</strong></div>
            <span className="flow-line" />
            <div><i className="wake-dot" /><span>You wake</span><strong>{formatClock(fromNightMinutes(selected.wake))}</strong></div>
            <span className="flow-line short"><small>{selected.actualLead} min</small></span>
            <div><i className="fajr-end-dot" /><span>Fajr ends</span><strong>{formatClock(fromNightMinutes(selected.fajrEnd))}</strong></div>
          </div>
          <p>Your selected wake buffer is applied to every date. The final wake clock is rounded to a five-minute mark, and bedtime is calculated backward from it.</p>
        </section>

        <section className="note-card">
          <Info size={17} />
          <p><strong>A planning estimate, not an official timetable.</strong> Fajr begins is calculated with the Karachi method; Fajr ends is sunrise for Dhaka. Compare the times with a trusted local timetable and use the end-time adjustment when needed.</p>
        </section>
      </main>

      {showSettings && (
        <div className="settings-backdrop" onMouseDown={() => setShowSettings(false)}>
          <aside className="settings-panel" onMouseDown={(event) => event.stopPropagation()}>
            <div className="settings-handle" />
            <div className="settings-header">
              <div><span className="section-label">Preferences</span><h2>Planner settings</h2></div>
              <button className="icon-button close-button" onClick={() => setShowSettings(false)} aria-label="Close settings"><X size={20} /></button>
            </div>

            <div className="setting-group">
              <label>Appearance</label>
              <div className="segmented-control">
                {themeOptions.map(({ value, label, icon: Icon }) => (
                  <button key={value} className={themeMode === value ? 'active' : ''} onClick={() => setThemeMode(value)}>
                    <Icon size={15} /> {label}
                  </button>
                ))}
              </div>
              <p>Auto follows the real sunrise and sunset in Dhaka.</p>
            </div>

            <div className="setting-group">
              <div className="setting-label-row"><label htmlFor="end-adjustment">Fajr end adjustment</label><strong>{endAdjustment > 0 ? '+' : ''}{endAdjustment} min</strong></div>
              <input id="end-adjustment" type="range" min="-15" max="15" step="1" value={endAdjustment} onChange={(event) => setEndAdjustment(Number(event.target.value))} />
              <div className="range-labels"><span>−15</span><span>Calculated sunrise</span><span>+15</span></div>
              <p>Use this only to match a trusted local Fajr end or sunrise timetable.</p>
            </div>

            <div className="setting-group install-setting">
              <div>
                <label>Install on this device</label>
                <p>Open it like a normal app and keep the planner available after the first visit.</p>
              </div>
              <button className="secondary-button" onClick={installApp} disabled={isInstalled}>
                {isInstalled ? <><Check size={15} /> Installed</> : <><Smartphone size={15} /> Install</>}
              </button>
            </div>
          </aside>
        </div>
      )}

      {showInstallHelp && (
        <div className="settings-backdrop" onMouseDown={() => setShowInstallHelp(false)}>
          <aside className="install-help-panel" onMouseDown={(event) => event.stopPropagation()}>
            <div className="install-help-icon"><img src="/icons/icon-192.png" alt="Before Fajr app icon" /></div>
            <button className="icon-button close-button install-close" onClick={() => setShowInstallHelp(false)} aria-label="Close install help"><X size={20} /></button>
            <span className="section-label">Install Before Fajr</span>
            <h2>Add it to your home screen</h2>
            <div className="install-steps">
              <div><strong>iPhone or iPad</strong><p>Open the browser Share menu, then choose <b>Add to Home Screen</b>.</p></div>
              <div><strong>Android or desktop</strong><p>Open the browser menu and choose <b>Install app</b> or <b>Add to Home screen</b>.</p></div>
            </div>
          </aside>
        </div>
      )}

      <footer>
        <span><MoonStar size={15} /> Before Fajr</span>
        <span>Installable · private by design · no account · no backend</span>
      </footer>
    </div>
  )
}

export default App
