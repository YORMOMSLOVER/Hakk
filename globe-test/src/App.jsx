import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import {
  DEFAULT_TLE_SETS,
  estimateNextPass,
  footprintPath,
  orbitPath,
  parseTle,
  parseTleText,
  propagateSatellite,
} from './lib/tle'

const REALTIME_REFRESH_MS = 1000
const SIMULATION_REFRESH_MS = 120
const SIMULATION_SPEEDS = [1, 10, 60, 300]
const GROUP_OPTIONS = ['none', 'country', 'operator', 'orbitType', 'mission']
const ORBIT_FILTERS = ['Все', 'LEO', 'MEO', 'GEO', 'HEO']
const SIMULATION_WINDOW_MINUTES = 12 * 60
const PASS_LOOKAHEAD_HOURS = 36
const PASS_LIST_LIMIT = 8
const PASS_LIST_PREVIEW_COUNT = 3
const WORLD_MAP_MARKERS = [
  { name: 'Байконур', lat: 45.92, lng: 63.34 },
  { name: 'Канаверал', lat: 28.39, lng: -80.6 },
  { name: 'Тулуза', lat: 43.6, lng: 1.44 },
]
const MAP_STYLE_OPTIONS = [
  { id: 'terrain', label: 'Схема' },
  { id: 'satellite', label: 'Спутник' },
]
const MAP_VIEWBOX_WIDTH = 1000
const MAP_VIEWBOX_HEIGHT = 500

function formatNumber(value, digits = 0) {
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value)
}

function formatDateTime(date) {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(date)
}

function formatGroupMode(mode) {
  if (mode === 'country') return 'по стране'
  if (mode === 'operator') return 'по оператору'
  if (mode === 'orbitType') return 'по типу орбиты'
  if (mode === 'mission') return 'по назначению'
  return 'без группировки'
}

function formatGroupOption(mode) {
  if (mode === 'country') return 'По стране'
  if (mode === 'operator') return 'По оператору'
  if (mode === 'orbitType') return 'По типу орбиты'
  if (mode === 'mission') return 'По назначению'
  return 'Без группировки'
}

function formatDurationFromNow(targetDate, referenceDate) {
  const diffMinutes = Math.round((targetDate.getTime() - referenceDate.getTime()) / 60000)

  if (diffMinutes <= 0) return 'сейчас'
  if (diffMinutes < 60) return `через ${diffMinutes} мин`

  const hours = Math.floor(diffMinutes / 60)
  const minutes = diffMinutes % 60
  return minutes > 0 ? `через ${hours} ч ${minutes} мин` : `через ${hours} ч`
}

function groupLabel(telemetry, mode) {
  if (mode === 'country') return telemetry.country
  if (mode === 'operator') return telemetry.operator
  if (mode === 'orbitType') return telemetry.orbitType
  if (mode === 'mission') return telemetry.mission
  return 'Все спутники'
}

function clampMapTransform(transform, viewport) {
  if (!viewport) return transform

  const width = viewport.clientWidth || viewport.getBoundingClientRect().width || 0
  const height = viewport.clientHeight || viewport.getBoundingClientRect().height || 0
  const scale = Math.max(1, Math.min(4, transform.scale))
  const maxOffsetX = Math.max(0, ((scale - 1) * width) / 2)
  const maxOffsetY = Math.max(0, ((scale - 1) * height) / 2)

  return {
    scale,
    offsetX: Math.min(maxOffsetX, Math.max(-maxOffsetX, transform.offsetX)),
    offsetY: Math.min(maxOffsetY, Math.max(-maxOffsetY, transform.offsetY)),
  }
}

function normalizeLongitude(value) {
  const normalized = ((value + 180) % 360 + 360) % 360 - 180
  return normalized === -180 ? 180 : normalized
}

function clampLatitude(value) {
  return Math.max(-90, Math.min(90, value))
}

function convertEventToLatLng(event, container, transform) {
  const rect = container.getBoundingClientRect()
  const originX = rect.width / 2
  const originY = rect.height / 2
  const localX = (event.clientX - rect.left - transform.offsetX - originX) / transform.scale + originX
  const localY = (event.clientY - rect.top - transform.offsetY - originY) / transform.scale + originY
  const normalizedX = Math.min(1, Math.max(0, localX / rect.width))
  const normalizedY = Math.min(1, Math.max(0, localY / rect.height))

  return {
    lat: clampLatitude(90 - normalizedY * 180),
    lng: normalizeLongitude(normalizedX * 360 - 180),
  }
}

function projectMapPosition(lat, lng) {
  const { x, y } = projectMapCoordinates(lat, lng)

  return {
    left: `${(x / MAP_VIEWBOX_WIDTH) * 100}%`,
    top: `${(y / MAP_VIEWBOX_HEIGHT) * 100}%`,
  }
}

function projectMapCoordinates(lat, lng) {
  return {
    x: ((normalizeLongitude(lng) + 180) / 360) * MAP_VIEWBOX_WIDTH,
    y: ((90 - clampLatitude(lat)) / 180) * MAP_VIEWBOX_HEIGHT,
  }
}

function buildWorldGrid() {
  const verticalLines = []
  const horizontalLines = []

  for (let lng = -150; lng <= 150; lng += 30) {
    verticalLines.push(
      <div
        key={`lng-${lng}`}
        className="map-grid__line map-grid__line--vertical"
        style={{ left: `${((lng + 180) / 360) * 100}%` }}
      />,
    )
  }

  for (let lat = -60; lat <= 60; lat += 30) {
    horizontalLines.push(
      <div
        key={`lat-${lat}`}
        className="map-grid__line map-grid__line--horizontal"
        style={{ top: `${((90 - lat) / 180) * 100}%` }}
      />,
    )
  }

  return { verticalLines, horizontalLines }
}

function unwrapLongitudeAroundCenter(lng, centerLng) {
  const delta = normalizeLongitude(lng - centerLng)
  return centerLng + delta
}

function buildCoveragePathSegment(points, offsetX = 0) {
  if (points.length < 3) return null

  const [firstPoint, ...restPoints] = points

  return [
    `M ${(firstPoint.x + offsetX).toFixed(2)} ${firstPoint.y.toFixed(2)}`,
    ...restPoints.map((point) => `L ${(point.x + offsetX).toFixed(2)} ${point.y.toFixed(2)}`),
    'Z',
  ].join(' ')
}

function coveragePathData(points, centerLng) {
  if (!points?.length) return null

  const normalizedCenterLng = normalizeLongitude(centerLng ?? points[0]?.lng ?? 0)
  const projectedPoints = points.map((point) => {
    const unwrappedLng = unwrapLongitudeAroundCenter(point.lng, normalizedCenterLng)

    return {
      x: ((unwrappedLng + 180) / 360) * MAP_VIEWBOX_WIDTH,
      y: ((90 - clampLatitude(point.lat)) / 180) * MAP_VIEWBOX_HEIGHT,
    }
  })

  const duplicateOffsets = [0, -MAP_VIEWBOX_WIDTH, MAP_VIEWBOX_WIDTH]
  const visiblePaths = duplicateOffsets
    .filter((offsetX) => {
      const xs = projectedPoints.map((point) => point.x + offsetX)
      const minX = Math.min(...xs)
      const maxX = Math.max(...xs)
      return maxX >= 0 && minX <= MAP_VIEWBOX_WIDTH
    })
    .map((offsetX) => buildCoveragePathSegment(projectedPoints, offsetX))
    .filter(Boolean)

  return visiblePaths.length > 0 ? visiblePaths.join(' ') : null
}

function buildSpaceDiagram(position) {
  if (!position) return null

  const viewBoxSize = 320
  const center = viewBoxSize / 2
  const earthRadius = 46
  const axisLength = 122
  const distanceKm = Math.sqrt(
    position.coordinates3d.x ** 2 + position.coordinates3d.y ** 2 + position.coordinates3d.z ** 2,
  )
  const maxDistance = Math.max(distanceKm, 42164)
  const normalized = {
    x: position.coordinates3d.x / maxDistance,
    y: position.coordinates3d.y / maxDistance,
    z: position.coordinates3d.z / maxDistance,
  }
  const projectPoint = (vector) => ({
    x: center + (vector.x - vector.y) * axisLength * 0.72,
    y: center + vector.z * axisLength - (vector.x + vector.y) * axisLength * 0.28,
  })

  const axes = [
    { key: 'x', label: 'X', color: '#ff7b72', vector: { x: 1, y: 0, z: 0 } },
    { key: 'y', label: 'Y', color: '#6ee7ff', vector: { x: 0, y: 1, z: 0 } },
    { key: 'z', label: 'Z', color: '#facc15', vector: { x: 0, y: 0, z: 1 } },
  ].map((axis) => ({
    ...axis,
    point: projectPoint(axis.vector),
  }))

  return {
    center,
    earthRadius,
    distanceKm,
    satellitePoint: projectPoint(normalized),
    axes,
  }
}

export default function App() {
  const globeContainerRef = useRef(null)
  const globeMountRef = useRef(null)
  const globeInstanceRef = useRef(null)
  const mapViewportRef = useRef(null)
  const dragStateRef = useRef(null)
  const skipMapClickRef = useRef(false)

  const [sourceType, setSourceType] = useState('preset')
  const [activeSetId, setActiveSetId] = useState(DEFAULT_TLE_SETS[0].id)
  const [customSatellites, setCustomSatellites] = useState([])
  const [simulationMode, setSimulationMode] = useState('realtime')
  const [isPlaying, setIsPlaying] = useState(true)
  const [simulationSpeed, setSimulationSpeed] = useState(60)
  const [simulationAnchorTime, setSimulationAnchorTime] = useState(() => new Date())
  const [simulatedTime, setSimulatedTime] = useState(() => new Date())
  const [selectedSatelliteId, setSelectedSatelliteId] = useState(null)
  const [selectedOrbitFilter, setSelectedOrbitFilter] = useState('Все')
  const [selectedCountry, setSelectedCountry] = useState('Все')
  const [selectedOperator, setSelectedOperator] = useState('Все')
  const [selectedMission, setSelectedMission] = useState('Все')
  const [altitudeFilter, setAltitudeFilter] = useState({ min: '', max: '' })
  const [groupBy, setGroupBy] = useState('none')
  const [satelliteListSearchQuery, setSatelliteListSearchQuery] = useState('')
  const [mapTransform, setMapTransform] = useState({ scale: 1, offsetX: 0, offsetY: 0 })
  const [mapStyle, setMapStyle] = useState('satellite')
  const [observer, setObserver] = useState({ lat: 55.75, lng: 37.62, label: 'Москва' })
  const [observerInputs, setObserverInputs] = useState({ lat: '55.75', lng: '37.62' })
  const [uploadStatus, setUploadStatus] = useState('')
  const [showCoverage, setShowCoverage] = useState(true)
  const [globeViewport, setGlobeViewport] = useState({ width: 0, height: 0, isPortrait: false })
  const [globeStatus, setGlobeStatus] = useState('loading')
  const [passPredictions, setPassPredictions] = useState([])
  const [passStatus, setPassStatus] = useState('idle')
  const [isPassListExpanded, setIsPassListExpanded] = useState(false)
  const [isSatelliteListExpanded, setIsSatelliteListExpanded] = useState(false)

  const worldGrid = useMemo(() => buildWorldGrid(), [])

  const clampTransform = (transform) => {
    const viewport = mapViewportRef.current
    return clampMapTransform(transform, viewport)
  }

  const activeRawSatellites = useMemo(() => {
    if (sourceType === 'file' && customSatellites.length > 0) return customSatellites
    return DEFAULT_TLE_SETS.find((item) => item.id === activeSetId)?.satellites ?? DEFAULT_TLE_SETS[0].satellites
  }, [activeSetId, customSatellites, sourceType])

  const satellites = useMemo(
    () => activeRawSatellites.map((satellite, index) => parseTle(satellite, index)),
    [activeRawSatellites],
  )


  useEffect(() => {
    const containerElement = globeContainerRef.current
    const mountElement = globeMountRef.current

    if (!containerElement || !mountElement || globeInstanceRef.current) return undefined

    let cancelled = false
    setGlobeStatus('loading')

    const bootGlobe = async () => {
      try {
        const { default: Globe } = await import('globe.gl')
        if (cancelled || !mountElement) return

        const globe = Globe()(mountElement)
          .globeImageUrl('//unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
          .backgroundImageUrl('//unpkg.com/three-globe/example/img/night-sky.png')
          .showAtmosphere(true)
          .atmosphereColor('#6ea8ff')
          .atmosphereAltitude(0.18)
          .pointRadius(0.6)
          .pointResolution(18)
          .pointAltitude('altitude')
          .pointsTransitionDuration(0)
          .pointColor('color')
          .pointLabel((point) => point.name)
          .pathColor('color')
          .pathStroke(0.9)
          .pathTransitionDuration(0)
          .pathDashAnimateTime(0)
          .pathPointLat((point) => point.lat)
          .pathPointLng((point) => point.lng)
          .pathPointAlt((point) => point.altitude)
          .labelLat('lat')
          .labelLng('lng')
          .labelAltitude('altitude')
          .labelText('text')
          .labelColor('color')
          .labelSize(1.2)
          .labelsTransitionDuration(0)
          .labelDotRadius(0.2)
          .htmlLat('lat')
          .htmlLng('lng')
          .htmlAltitude('altitude')
          .htmlTransitionDuration(0)
          .htmlElement((item) => {
            const element = document.createElement('div')
            element.className = 'globe-selection-badge'
            element.innerHTML = `
              <span class="globe-selection-badge__dot" style="--badge-color: ${item.color};"></span>
              <div class="globe-selection-badge__card">
                <strong>${item.name}</strong>
                <span>${formatNumber(item.altitudeKm, 0)} км • ${item.orbitType}</span>
              </div>
            `
            return element
          })
          .polygonCapColor((polygon) => polygon.capColor)
          .polygonSideColor((polygon) => polygon.sideColor)
          .polygonStrokeColor((polygon) => polygon.strokeColor)
          .polygonAltitude(0.001)
          .polygonLabel((polygon) => polygon.name)
          .polygonsTransitionDuration(0)

        globe.controls().enablePan = true
        globe.controls().zoomSpeed = 0.8
        globe.controls().minDistance = 180
        globe.controls().maxDistance = 700
        globe.pointOfView({ lat: 25, lng: 20, altitude: 2.2 }, 0)

        globeInstanceRef.current = globe
        setGlobeStatus('ready')
      } catch (error) {
        console.error(error)
        if (!cancelled) setGlobeStatus('error')
      }
    }

    bootGlobe()

    return () => {
      cancelled = true
      mountElement.replaceChildren()
      globeInstanceRef.current = null
    }
  }, [])

  useEffect(() => {
    const containerElement = globeContainerRef.current
    const globe = globeInstanceRef.current

    if (!containerElement || !globe) return undefined

    const updateGlobeSize = () => {
      const width = containerElement.clientWidth
      const isPortrait = width <= 980
      const height = isPortrait ? Math.min(width, 520) : Math.max(420, Math.round(width * 0.72))

      setGlobeViewport({ width, height, isPortrait })
      globe.width(width)
      globe.height(height)
      globe.pointOfView({ lat: 25, lng: 20, altitude: isPortrait ? 2.65 : 2.2 }, 350)
    }

    updateGlobeSize()

    const resizeObserver = new ResizeObserver(() => {
      updateGlobeSize()
    })

    resizeObserver.observe(containerElement)

    return () => resizeObserver.disconnect()
  }, [globeStatus])

  useEffect(() => {
    const viewport = mapViewportRef.current
    if (!viewport) return undefined

    const handleNativeWheel = (event) => {
      event.preventDefault()
    }

    viewport.addEventListener('wheel', handleNativeWheel, { passive: false })

    return () => viewport.removeEventListener('wheel', handleNativeWheel)
  }, [])

  useEffect(() => {
    const viewport = mapViewportRef.current
    if (!viewport) return undefined

    const resizeObserver = new ResizeObserver(() => {
      setMapTransform((previous) => clampMapTransform(previous, viewport))
    })

    resizeObserver.observe(viewport)

    return () => resizeObserver.disconnect()
  }, [])

  useEffect(() => {
    const tick = () => {
      setSimulatedTime((previous) => {
        if (simulationMode === 'realtime') return new Date()
        if (!isPlaying) return previous
        return new Date(previous.getTime() + simulationSpeed * 1000)
      })
    }

    tick()
    const intervalId = window.setInterval(
      tick,
      simulationMode === 'realtime' ? REALTIME_REFRESH_MS : SIMULATION_REFRESH_MS,
    )

    return () => window.clearInterval(intervalId)
  }, [isPlaying, simulationMode, simulationSpeed])

  const telemetry = useMemo(
    () =>
      satellites.map((satellite) => {
        const position = propagateSatellite(satellite, simulatedTime)

        return {
          id: satellite.id,
          name: satellite.name,
          color: satellite.color,
          lat: position.lat,
          lng: position.lng,
          altitudeKm: position.altitudeKm,
          altitudeRatio: position.altitudeRatio,
          speedKmS: position.speedKmS,
          orbitalPeriodMinutes: position.orbitalPeriodMinutes,
          orbitType: position.orbitType,
          visibilityRadiusKm: position.visibilityRadiusKm,
          coveragePath: footprintPath(position),
          country: satellite.metadata.country,
          operator: satellite.metadata.operator,
          mission: satellite.metadata.mission,
          inclinationDeg: satellite.inclinationDeg,
          coordinates3d: position.eci,
          orbit: orbitPath(satellite, simulatedTime),
          tle: `${satellite.line1}\n${satellite.line2}`,
        }
      }),
    [satellites, simulatedTime],
  )

  const telemetryLookup = useMemo(
    () => new Map(telemetry.map((item) => [item.id, item])),
    [telemetry],
  )

  const passComputationKey = useMemo(() => {
    const bucketMinutes = simulationMode === 'realtime' ? 5 : 10
    return Math.floor(simulatedTime.getTime() / (bucketMinutes * 60000))
  }, [simulatedTime, simulationMode])

  useEffect(() => {
    let cancelled = false

    setPassStatus('loading')

    const timerId = window.setTimeout(() => {
      const nextPasses = satellites
        .map((satellite) => {
          const nextPass = estimateNextPass(satellite, observer, simulatedTime, PASS_LOOKAHEAD_HOURS)
          if (!nextPass) return null

          return {
            id: satellite.id,
            time: nextPass.time,
            distanceKm: nextPass.distanceKm,
          }
        })
        .filter(Boolean)
        .sort((left, right) => left.time.getTime() - right.time.getTime())

      if (!cancelled) {
        setPassPredictions(nextPasses)
        setPassStatus('ready')
      }
    }, 0)

    return () => {
      cancelled = true
      window.clearTimeout(timerId)
    }
  }, [observer, passComputationKey, satellites, simulatedTime])

  const passPredictionLookup = useMemo(
    () => new Map(passPredictions.map((item) => [item.id, item])),
    [passPredictions],
  )

  const telemetryWithPasses = useMemo(
    () =>
      telemetry.map((item) => ({
        ...item,
        nextPass: passPredictionLookup.get(item.id) ?? null,
      })),
    [passPredictionLookup, telemetry],
  )

  const filterOptions = useMemo(() => {
    const countries = new Set(['Все'])
    const operators = new Set(['Все'])
    const missions = new Set(['Все'])

    telemetryWithPasses.forEach((item) => {
      countries.add(item.country)
      operators.add(item.operator)
      missions.add(item.mission)
    })

    return {
      countries: [...countries],
      operators: [...operators],
      missions: [...missions],
    }
  }, [telemetryWithPasses])

  const safeSelectedSatelliteId =
    selectedSatelliteId && telemetryWithPasses.some((item) => item.id === selectedSatelliteId)
      ? selectedSatelliteId
      : telemetryWithPasses[0]?.id ?? null

  const normalizedAltitudeFilter = useMemo(() => {
    const min = altitudeFilter.min.trim() === '' ? null : Number(altitudeFilter.min)
    const max = altitudeFilter.max.trim() === '' ? null : Number(altitudeFilter.max)

    return {
      min: Number.isFinite(min) ? min : null,
      max: Number.isFinite(max) ? max : null,
    }
  }, [altitudeFilter])

  const filteredTelemetry = useMemo(
    () =>
      telemetryWithPasses.filter((item) => {
        if (selectedOrbitFilter !== 'Все' && item.orbitType !== selectedOrbitFilter) return false
        if (selectedCountry !== 'Все' && item.country !== selectedCountry) return false
        if (selectedOperator !== 'Все' && item.operator !== selectedOperator) return false
        if (selectedMission !== 'Все' && item.mission !== selectedMission) return false
        if (normalizedAltitudeFilter.min !== null && item.altitudeKm < normalizedAltitudeFilter.min) return false
        if (normalizedAltitudeFilter.max !== null && item.altitudeKm > normalizedAltitudeFilter.max) return false
        return true
      }),
    [
      normalizedAltitudeFilter.max,
      normalizedAltitudeFilter.min,
      telemetryWithPasses,
      selectedCountry,
      selectedMission,
      selectedOperator,
      selectedOrbitFilter,
    ],
  )

  const searchedTelemetry = useMemo(() => {
    const normalizedQuery = satelliteListSearchQuery.trim().toLowerCase()
    if (!normalizedQuery) return filteredTelemetry

    return filteredTelemetry.filter((item) =>
      [
        item.name,
        item.country,
        item.operator,
        item.orbitType,
        item.mission,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery)),
    )
  }, [filteredTelemetry, satelliteListSearchQuery])

  const groupedTelemetry = useMemo(() => {
    const groups = new Map()

    searchedTelemetry.forEach((item) => {
      const key = groupBy === 'none' ? 'all' : groupLabel(item, groupBy)
      const title = groupBy === 'none' ? 'Все спутники' : groupLabel(item, groupBy)
      const list = groups.get(key)

      if (list) {
        list.items.push(item)
      } else {
        groups.set(key, { title, items: [item] })
      }
    })

    return [...groups.values()]
  }, [groupBy, searchedTelemetry])

  const visibleGroupedTelemetry = useMemo(() => {
    if (isSatelliteListExpanded) return groupedTelemetry

    let visibleCount = 0

    return groupedTelemetry
      .map((group) => {
        if (visibleCount >= PASS_LIST_PREVIEW_COUNT) return null

        const remaining = PASS_LIST_PREVIEW_COUNT - visibleCount
        const items = group.items.slice(0, remaining)
        visibleCount += items.length

        if (items.length === 0) return null

        return {
          ...group,
          items,
        }
      })
      .filter(Boolean)
  }, [groupedTelemetry, isSatelliteListExpanded])

  const searchedTelemetryCount = searchedTelemetry.length
  const hasHiddenSatelliteCards = searchedTelemetryCount > PASS_LIST_PREVIEW_COUNT

  const selectedSatellite = useMemo(
    () => filteredTelemetry.find((item) => item.id === safeSelectedSatelliteId) ?? filteredTelemetry[0] ?? null,
    [filteredTelemetry, safeSelectedSatelliteId],
  )

  const selectedSatelliteSpaceDiagram = useMemo(
    () => buildSpaceDiagram(selectedSatellite),
    [selectedSatellite],
  )

  const coverageTelemetry = useMemo(() => {
    if (!showCoverage) return []
    return selectedSatellite ? [selectedSatellite] : []
  }, [selectedSatellite, showCoverage])

  const renderMode = useMemo(() => {
    const total = filteredTelemetry.length
    return {
      showMapLabels: total <= 18,
      showGlobeLabels: total <= 36,
      showOrbits: total <= 80,
      status:
        total > 100 ? 'Оптимизированный режим для 100+ объектов' : 'Полный режим визуализации',
    }
  }, [filteredTelemetry.length])

  const observerUpcomingPasses = useMemo(
    () =>
      passPredictions
        .map((item) => {
          const telemetryItem = telemetryLookup.get(item.id)
          if (!telemetryItem) return null

          return {
            ...telemetryItem,
            nextPass: item,
          }
        })
        .filter(Boolean)
        .filter((item) => {
          if (selectedOrbitFilter !== 'Все' && item.orbitType !== selectedOrbitFilter) return false
          if (selectedCountry !== 'Все' && item.country !== selectedCountry) return false
          if (selectedOperator !== 'Все' && item.operator !== selectedOperator) return false
          if (selectedMission !== 'Все' && item.mission !== selectedMission) return false
          if (normalizedAltitudeFilter.min !== null && item.altitudeKm < normalizedAltitudeFilter.min) return false
          if (normalizedAltitudeFilter.max !== null && item.altitudeKm > normalizedAltitudeFilter.max) return false
          return true
        })
        .sort((left, right) => left.nextPass.time.getTime() - right.nextPass.time.getTime())
        .slice(0, PASS_LIST_LIMIT),
    [
      normalizedAltitudeFilter.max,
      normalizedAltitudeFilter.min,
      passPredictions,
      selectedCountry,
      selectedMission,
      selectedOperator,
      selectedOrbitFilter,
      telemetryLookup,
    ],
  )

  const visibleObserverUpcomingPasses = useMemo(
    () =>
      isPassListExpanded
        ? observerUpcomingPasses
        : observerUpcomingPasses.slice(0, PASS_LIST_PREVIEW_COUNT),
    [isPassListExpanded, observerUpcomingPasses],
  )

  const hasHiddenObserverUpcomingPasses = observerUpcomingPasses.length > PASS_LIST_PREVIEW_COUNT

  useEffect(() => {
    if (!hasHiddenObserverUpcomingPasses && isPassListExpanded) {
      setIsPassListExpanded(false)
    }
  }, [hasHiddenObserverUpcomingPasses, isPassListExpanded])

  const comparisonMode = groupBy === 'none' ? 'orbitType' : groupBy
  const comparisonRows = useMemo(() => {
    const rows = new Map()

    filteredTelemetry.forEach((item) => {
      const key = groupLabel(item, comparisonMode)
      const current = rows.get(key) ?? {
        title: key,
        count: 0,
        altitudeSum: 0,
        speedSum: 0,
        maxCoverageKm: 0,
      }

      current.count += 1
      current.altitudeSum += item.altitudeKm
      current.speedSum += item.speedKmS
      current.maxCoverageKm = Math.max(current.maxCoverageKm, item.visibilityRadiusKm)
      rows.set(key, current)
    })

    return [...rows.values()]
      .map((row) => ({
        ...row,
        averageAltitudeKm: row.altitudeSum / row.count,
        averageSpeedKmS: row.speedSum / row.count,
      }))
      .sort((left, right) => right.count - left.count)
  }, [comparisonMode, filteredTelemetry])


  useEffect(() => {
    setObserverInputs({
      lat: Number.isFinite(observer.lat) ? String(Number(observer.lat.toFixed(2))) : '',
      lng: Number.isFinite(observer.lng) ? String(Number(observer.lng.toFixed(2))) : '',
    })
  }, [observer.lat, observer.lng])

  const timelineValue = useMemo(() => {
    const diffMinutes = Math.round((simulatedTime.getTime() - simulationAnchorTime.getTime()) / 60000)
    return Math.max(-SIMULATION_WINDOW_MINUTES, Math.min(SIMULATION_WINDOW_MINUTES, diffMinutes))
  }, [simulatedTime, simulationAnchorTime])

  const selectedPassAlert = useMemo(() => {
    if (!selectedSatellite?.nextPass?.time) return null

    const diffMinutes = Math.round(
      (selectedSatellite.nextPass.time.getTime() - simulatedTime.getTime()) / 60000,
    )

    if (diffMinutes < 0 || diffMinutes > 120) return null

    return {
      ...selectedSatellite.nextPass,
      diffMinutes,
    }
  }, [selectedSatellite, simulatedTime])

  useEffect(() => {
    const globe = globeInstanceRef.current
    if (!globe) return

    globe.pointsData(
      filteredTelemetry.map((satellite) => ({
        lat: satellite.lat,
        lng: satellite.lng,
        altitude: satellite.altitudeRatio,
        color: satellite.color,
        name: satellite.name,
      })),
    )

    globe.labelsData(
      renderMode.showGlobeLabels
        ? filteredTelemetry.map((satellite) => ({
            lat: satellite.lat,
            lng: satellite.lng,
            altitude: satellite.altitudeRatio + 0.015,
            text: satellite.name,
            color: satellite.color,
          }))
        : [],
    )

    globe.pathsData(
      renderMode.showOrbits
        ? filteredTelemetry.map((satellite) => ({
            color: satellite.color,
            points: satellite.orbit,
          }))
        : [],
    )
    globe.pathPoints('points')

    globe.polygonsData(
      coverageTelemetry.map((satellite) => ({
        name: `${satellite.name}: зона покрытия ≈ ${formatNumber(satellite.visibilityRadiusKm, 0)} км`,
        capColor: `${satellite.color}33`,
        sideColor: `${satellite.color}12`,
        strokeColor: satellite.color,
        geometry: {
          type: 'Polygon',
          coordinates: [satellite.coveragePath.map((point) => [point.lng, point.lat])],
        },
      })),
    )

    globe.htmlElementsData(
      selectedSatellite
        ? [
            {
              lat: selectedSatellite.lat,
              lng: selectedSatellite.lng,
              altitude: selectedSatellite.altitudeRatio + 0.08,
              color: selectedSatellite.color,
              name: selectedSatellite.name,
              altitudeKm: selectedSatellite.altitudeKm,
              orbitType: selectedSatellite.orbitType,
            },
          ]
        : [],
    )
  }, [coverageTelemetry, filteredTelemetry, renderMode.showGlobeLabels, renderMode.showOrbits, selectedSatellite])

  const handlePresetChange = (event) => {
    setSourceType('preset')
    setActiveSetId(event.target.value)
    setUploadStatus('')
  }

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    const content = await file.text()
    const parsed = parseTleText(content, file.name)

    if (parsed.length === 0) {
      setUploadStatus('Не удалось распознать TLE в выбранном файле.')
      return
    }

    setCustomSatellites(parsed)
    setSourceType('file')
    setSelectedSatelliteId(parsed[0]?.id ?? null)
    setUploadStatus(`Загружено спутников: ${parsed.length}`)
  }

  const handleMapWheel = (event) => {
    event.preventDefault()
    event.stopPropagation()

    const viewport = mapViewportRef.current

    setMapTransform((previous) => {
      const nextScale = Math.max(1, Math.min(4, previous.scale - event.deltaY * 0.0012))

      if (!viewport || nextScale === previous.scale) {
        return clampTransform({
          scale: nextScale,
          offsetX: previous.offsetX,
          offsetY: previous.offsetY,
        })
      }

      const rect = viewport.getBoundingClientRect()
      const originX = rect.width / 2
      const originY = rect.height / 2
      const cursorX = event.clientX - rect.left
      const cursorY = event.clientY - rect.top
      const contentX = (cursorX - previous.offsetX - originX) / previous.scale
      const contentY = (cursorY - previous.offsetY - originY) / previous.scale

      return clampTransform({
        scale: nextScale,
        offsetX: cursorX - originX - contentX * nextScale,
        offsetY: cursorY - originY - contentY * nextScale,
      })
    })
  }

  const handleMapPointerDown = (event) => {
    const target = mapViewportRef.current
    if (!target) return

    dragStateRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      offsetX: mapTransform.offsetX,
      offsetY: mapTransform.offsetY,
      scale: mapTransform.scale,
      moved: false,
    }

    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const handleMapPointerMove = (event) => {
    const dragState = dragStateRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) return

    const deltaX = event.clientX - dragState.x
    const deltaY = event.clientY - dragState.y

    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
      dragState.moved = true
      skipMapClickRef.current = true
    }

    setMapTransform(() =>
      clampTransform({
        scale: dragState.scale,
        offsetX: dragState.offsetX + deltaX,
        offsetY: dragState.offsetY + deltaY,
      }),
    )
  }

  const handleMapPointerUp = (event) => {
    const activePointerId = dragStateRef.current?.pointerId
    if (typeof activePointerId === 'number' && event?.currentTarget?.hasPointerCapture?.(activePointerId)) {
      event.currentTarget.releasePointerCapture?.(activePointerId)
    }

    window.setTimeout(() => {
      skipMapClickRef.current = false
    }, 0)
    dragStateRef.current = null
  }

  const handleMapClick = (event) => {
    if (skipMapClickRef.current) return
    if (event.target instanceof Element && event.target.closest('[data-map-satellite="true"]')) return

    const viewport = mapViewportRef.current
    if (!viewport) return

    const coordinates = convertEventToLatLng(event, viewport, mapTransform)
    setObserver({
      lat: coordinates.lat,
      lng: coordinates.lng,
      label: `Точка ${formatNumber(coordinates.lat, 2)} / ${formatNumber(coordinates.lng, 2)}`,
    })
  }

  const startRealtime = () => {
    setSimulationMode('realtime')
    setIsPlaying(true)
    const now = new Date()
    setSimulationAnchorTime(now)
    setSimulatedTime(now)
  }

  const startSimulation = () => {
    const now = new Date()
    setSimulationMode('sim')
    setSimulationAnchorTime(now)
    setSimulatedTime(now)
  }

  const shiftTimeline = (deltaMinutes) => {
    const baseTime = simulationMode === 'realtime' ? new Date() : simulatedTime

    if (simulationMode === 'realtime') {
      setSimulationAnchorTime(baseTime)
    }

    setSimulationMode('sim')
    setIsPlaying(false)
    setSimulatedTime(new Date(baseTime.getTime() + deltaMinutes * 60000))
  }

  const handleTimelineChange = (event) => {
    const minutes = Number(event.target.value)
    setSimulationMode('sim')
    setIsPlaying(false)
    setSimulatedTime(new Date(simulationAnchorTime.getTime() + minutes * 60000))
  }

  const handleMapZoomStep = (delta) => {
    setMapTransform((previous) =>
      clampTransform({
        scale: Math.max(1, Math.min(4, previous.scale + delta)),
        offsetX: previous.offsetX,
        offsetY: previous.offsetY,
      }),
    )
  }

  const handleObserverInputChange = (field, rawValue, limits) => {
    setObserverInputs((previous) => ({
      ...previous,
      [field]: rawValue,
    }))

    if (rawValue.trim() === '' || rawValue === '-' || rawValue === '.' || rawValue === '-.') return

    const numericValue = Number(rawValue)
    if (Number.isNaN(numericValue)) return

    const nextValue = Math.max(limits.min, Math.min(limits.max, numericValue))
    setObserver((previous) => ({
      ...previous,
      [field]: nextValue,
      label: 'Пользовательская точка',
    }))
  }

  const handleObserverInputBlur = (field, limits) => {
    const rawValue = observerInputs[field]
    const numericValue = Number(rawValue)
    const safeValue = Number.isNaN(numericValue)
      ? observer[field]
      : Math.max(limits.min, Math.min(limits.max, numericValue))

    setObserver((current) => ({
      ...current,
      [field]: safeValue,
      label: 'Пользовательская точка',
    }))
    setObserverInputs((previous) => ({
      ...previous,
      [field]: String(Number(safeValue.toFixed(2))),
    }))
  }

  const handleAltitudeFilterChange = (field, rawValue) => {
    if (rawValue !== '' && !/^[-]?\d*([.,]\d*)?$/.test(rawValue)) return

    setAltitudeFilter((previous) => ({
      ...previous,
      [field]: rawValue.replace(',', '.'),
    }))
  }

  return (
    <div className="app-shell container-fluid px-3 px-lg-4 py-4">
      <header className="topbar d-flex flex-column flex-xxl-row align-items-start justify-content-between gap-3 gap-lg-4 mb-4">
        <div>
          <p className="eyebrow">Ситуационная осведомлённость о спутниках</p>
          <h1>Карта и 3D-пространство спутников по TLE</h1>
          <p className="panel-copy">
            Показывает текущие положения, анимацию движения, фильтрацию, сравнение групп и
            список ближайших пролётов над выбранной точкой.
          </p>
        </div>

        <div className="time-chip">
          <span>{simulationMode === 'realtime' ? 'Реальное время' : 'Симуляция'}</span>
          <strong>{formatDateTime(simulatedTime)}</strong>
        </div>
      </header>

      <main className="dashboard-grid">
        <section className="controls-panel panel shadow-lg">
          <div className="panel-block">
            <h2>Источник TLE</h2>
            <label>
              Готовый набор
              <select value={activeSetId} onChange={handlePresetChange}>
                {DEFAULT_TLE_SETS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Загрузить TLE-файл
              <input type="file" accept=".txt,.tle,.3le" onChange={handleFileUpload} />
            </label>

            {uploadStatus ? <p className="helper-text">{uploadStatus}</p> : null}
            <p className="helper-text">
              Активный источник: {sourceType === 'file' ? 'пользовательский файл' : 'преднастроенный набор'}.
            </p>
          </div>

          <div className="panel-block">
            <h2>Время и анимация</h2>
            <div className="button-row">
              <button
                type="button"
                className={simulationMode === 'realtime' ? 'is-active' : ''}
                onClick={startRealtime}
              >
                Реальное время
              </button>
              <button
                type="button"
                className={simulationMode === 'sim' ? 'is-active' : ''}
                onClick={startSimulation}
              >
                Симуляция
              </button>
            </div>

            <div className="button-row button-row--triple">
              <button type="button" onClick={() => setIsPlaying((value) => !value)}>
                {isPlaying ? 'Пауза' : 'Пуск'}
              </button>
              <button type="button" onClick={() => shiftTimeline(-10)}>
                −10 мин
              </button>
              <button type="button" onClick={() => shiftTimeline(10)}>
                +10 мин
              </button>
            </div>

            <label>
              Скорость моделирования
              <select
                value={simulationSpeed}
                onChange={(event) => setSimulationSpeed(Number(event.target.value))}
              >
                {SIMULATION_SPEEDS.map((speed) => (
                  <option key={speed} value={speed}>
                    x{speed}
                  </option>
                ))}
              </select>
            </label>

            <div className="timeline-card">
              <div className="timeline-card__header">
                <strong>Шкала времени ±12 часов</strong>
                <button type="button" onClick={() => setSimulationAnchorTime(simulatedTime)}>
                  Центрировать
                </button>
              </div>
              <input
                type="range"
                min={-SIMULATION_WINDOW_MINUTES}
                max={SIMULATION_WINDOW_MINUTES}
                step={10}
                value={timelineValue}
                onChange={handleTimelineChange}
              />
              <div className="timeline-card__labels">
                <span>{formatDateTime(new Date(simulationAnchorTime.getTime() - SIMULATION_WINDOW_MINUTES * 60000))}</span>
                <span>Текущее смещение: {timelineValue >= 0 ? '+' : ''}{timelineValue} мин</span>
                <span>{formatDateTime(new Date(simulationAnchorTime.getTime() + SIMULATION_WINDOW_MINUTES * 60000))}</span>
              </div>
            </div>
          </div>

          <div className="panel-block">
            <h2>Фильтрация и группировка</h2>
            <label>
              Страна / оператор
              <div className="inline-fields">
                <select value={selectedCountry} onChange={(event) => setSelectedCountry(event.target.value)}>
                  {filterOptions.countries.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
                <select
                  value={selectedOperator}
                  onChange={(event) => setSelectedOperator(event.target.value)}
                >
                  {filterOptions.operators.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>
            </label>

            <label>
              Тип орбиты / назначение
              <div className="inline-fields">
                <select
                  value={selectedOrbitFilter}
                  onChange={(event) => setSelectedOrbitFilter(event.target.value)}
                >
                  {ORBIT_FILTERS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
                <select value={selectedMission} onChange={(event) => setSelectedMission(event.target.value)}>
                  {filterOptions.missions.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>
            </label>

            <label>
              Высота орбиты, км
              <div className="inline-fields">
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="От"
                  value={altitudeFilter.min}
                  onChange={(event) => handleAltitudeFilterChange('min', event.target.value)}
                />
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="До"
                  value={altitudeFilter.max}
                  onChange={(event) => handleAltitudeFilterChange('max', event.target.value)}
                />
              </div>
            </label>

            <label>
              Группировка карточек
              <select value={groupBy} onChange={(event) => setGroupBy(event.target.value)}>
                {GROUP_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {formatGroupOption(value)}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              className={showCoverage ? 'is-active' : ''}
              onClick={() => setShowCoverage((value) => !value)}
            >
              {showCoverage ? 'Скрыть зону покрытия' : 'Показать зону покрытия'}
            </button>
            <p className="helper-text">
              {renderMode.status}. Подписи и орбитальные следы автоматически упрощаются при росте числа объектов.
            </p>
          </div>
        </section>

        <div className="dashboard-main-column w-100">
          <section className="visual-panel panel shadow-lg">
          <div className="panel-heading">
            <h2>Положения спутников на карте</h2>
            <p>Колесо мыши или кнопки — масштаб, перетаскивание — перемещение, клик — выбрать точку наблюдения.</p>
          </div>

          <div className="map-toolbar">
            <div className="button-row">
              {MAP_STYLE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={mapStyle === option.id ? 'is-active' : ''}
                  onClick={() => setMapStyle(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="map-toolbar__actions">
              <button type="button" onClick={() => handleMapZoomStep(0.2)} aria-label="Приблизить карту">+</button>
              <button type="button" onClick={() => handleMapZoomStep(-0.2)} aria-label="Отдалить карту">−</button>
              <button
                type="button"
                onClick={() => setMapTransform({ scale: 1, offsetX: 0, offsetY: 0 })}
              >
                Сбросить вид
              </button>
            </div>
          </div>

          <div
            ref={mapViewportRef}
            className={`map-viewport map-viewport--${mapStyle}`}
            onWheel={handleMapWheel}
            onPointerDown={handleMapPointerDown}
            onPointerMove={handleMapPointerMove}
            onPointerUp={handleMapPointerUp}
            onPointerCancel={handleMapPointerUp}
            onLostPointerCapture={handleMapPointerUp}
            onClick={handleMapClick}
          >
            <div
              className="map-surface"
              style={{
                transform: `translate(${mapTransform.offsetX}px, ${mapTransform.offsetY}px) scale(${mapTransform.scale})`,
              }}
            >
              <div className="map-ocean" />
              {mapStyle === 'satellite' ? (
                <img
                  className="map-raster"
                  src="https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
                  alt=""
                  aria-hidden="true"
                  draggable="false"
                />
              ) : null}
              <div className="map-grid">
                {worldGrid.verticalLines}
                {worldGrid.horizontalLines}
              </div>
              <svg className="map-continents" viewBox="0 0 1000 500" preserveAspectRatio="none">
                <path d="M86 140l38-32 78 6 40 34-6 43-65 27-31 49-61-6-25-55zM278 142l58-48 97-8 58 21 7 63-78 42-41 71-85 8-56-57 17-56zM531 92l54 18 31 44 58-10 40 18 88 6 58 34-28 44-88 14-51 41-88 12-57-41-39-75 6-53zM723 332l69-20 86 27 32 71-41 51-102 4-61-42-8-54zM823 113l73 27 14 39-43 26-52-14-16-41z" />
              </svg>

              {coverageTelemetry.length > 0 ? (
                <svg
                  className="map-coverage"
                  viewBox={`0 0 ${MAP_VIEWBOX_WIDTH} ${MAP_VIEWBOX_HEIGHT}`}
                  preserveAspectRatio="none"
                >
                  {coverageTelemetry.map((satellite) => {
                    const pathData = coveragePathData(satellite.coveragePath, satellite.lng)
                    if (!pathData) return null

                    return (
                      <path
                        key={`${satellite.id}-coverage-footprint`}
                        className="map-coverage__footprint"
                        d={pathData}
                        style={{ '--coverage-color': satellite.color }}
                      />
                    )
                  })}
                </svg>
              ) : null}

              {filteredTelemetry.map((satellite) => (
                <button
                  key={satellite.id}
                  type="button"
                  className={`map-satellite ${selectedSatellite?.id === satellite.id ? 'is-selected' : ''}`}
                  data-map-satellite="true"
                  style={{
                    ...projectMapPosition(satellite.lat, satellite.lng),
                    '--satellite-color': satellite.color,
                  }}
                  onClick={(event) => {
                    event.stopPropagation()
                    setSelectedSatelliteId(satellite.id)
                  }}
                  title={`${satellite.name} • зона покрытия ≈ ${formatNumber(satellite.visibilityRadiusKm, 0)} км`}
                >
                  <span className="map-satellite__dot" />
                  {renderMode.showMapLabels ? <em className="map-satellite__label">{satellite.name}</em> : null}
                </button>
              ))}

              <div className="observer-point" style={projectMapPosition(observer.lat, observer.lng)}>
                <span />
                <strong>{observer.label}</strong>
              </div>

              {WORLD_MAP_MARKERS.map((marker) => (
                <div key={marker.name} className="map-city" style={projectMapPosition(marker.lat, marker.lng)}>
                  <span />
                  <small>{marker.name}</small>
                </div>
              ))}
            </div>
          </div>
          </section>

          <section className="space-panel panel shadow-lg">
          <div className="panel-heading">
            <h2>Положения спутников в пространстве</h2>
            <p>
              Вращайте глобус свободно: выбранный спутник подсвечивается карточкой прямо над планетой в 3D вместе с траекторией и зоной покрытия.
            </p>
          </div>
          <div
            ref={globeContainerRef}
            className={`globe-canvas ${globeViewport.isPortrait ? 'is-portrait' : ''}`}
            style={{ minHeight: globeViewport.height || undefined }}
          >
            <div ref={globeMountRef} className="globe-canvas__mount" />
            {globeStatus !== 'ready' ? (
              <div className="globe-canvas__status">
                {globeStatus === 'error'
                  ? 'Не удалось загрузить 3D-глобус.'
                  : 'Загрузка 3D-глобуса…'}
              </div>
            ) : null}
          </div>

          {selectedSatellite && selectedSatelliteSpaceDiagram ? (
            <article className="space-focus-card">
              <div className="space-focus-card__header">
                <div>
                  <p className="eyebrow">Фокус по выбранному объекту</p>
                  <h3>{selectedSatellite.name}</h3>
                </div>
                <p>
                  ECI-вектор обновляется в реальном времени и показывает, где спутник находится
                  относительно центра Земли.
                </p>
              </div>

              <div className="space-focus-card__body">
                <svg className="space-diagram" viewBox="0 0 320 320" role="img" aria-label="Положение спутника в пространстве">
                  <defs>
                    <radialGradient id="earthGlow" cx="50%" cy="45%" r="60%">
                      <stop offset="0%" stopColor="rgba(110, 168, 255, 0.95)" />
                      <stop offset="70%" stopColor="rgba(47, 93, 197, 0.9)" />
                      <stop offset="100%" stopColor="rgba(12, 24, 64, 0.95)" />
                    </radialGradient>
                  </defs>

                  <circle cx={selectedSatelliteSpaceDiagram.center} cy={selectedSatelliteSpaceDiagram.center} r={126} className="space-diagram__halo" />
                  {selectedSatelliteSpaceDiagram.axes.map((axis) => (
                    <g key={axis.key}>
                      <line
                        x1={selectedSatelliteSpaceDiagram.center}
                        y1={selectedSatelliteSpaceDiagram.center}
                        x2={axis.point.x}
                        y2={axis.point.y}
                        stroke={axis.color}
                        strokeWidth="2.4"
                        strokeLinecap="round"
                      />
                      <text x={axis.point.x} y={axis.point.y} dx="8" dy="-6" fill={axis.color}>
                        {axis.label}
                      </text>
                    </g>
                  ))}
                  <line
                    x1={selectedSatelliteSpaceDiagram.center}
                    y1={selectedSatelliteSpaceDiagram.center}
                    x2={selectedSatelliteSpaceDiagram.satellitePoint.x}
                    y2={selectedSatelliteSpaceDiagram.satellitePoint.y}
                    className="space-diagram__vector"
                  />
                  <circle
                    cx={selectedSatelliteSpaceDiagram.center}
                    cy={selectedSatelliteSpaceDiagram.center}
                    r={selectedSatelliteSpaceDiagram.earthRadius}
                    fill="url(#earthGlow)"
                    className="space-diagram__earth"
                  />
                  <circle
                    cx={selectedSatelliteSpaceDiagram.satellitePoint.x}
                    cy={selectedSatelliteSpaceDiagram.satellitePoint.y}
                    r="8"
                    fill={selectedSatellite.color}
                    className="space-diagram__satellite"
                  />
                  <text
                    x={selectedSatelliteSpaceDiagram.satellitePoint.x}
                    y={selectedSatelliteSpaceDiagram.satellitePoint.y}
                    dx="12"
                    dy="-12"
                    className="space-diagram__label"
                  >
                    {selectedSatellite.name}
                  </text>
                </svg>

                <div className="space-stats-grid">
                  <div className="space-stat">
                    <span>Радиус-вектор</span>
                    <strong>{formatNumber(selectedSatelliteSpaceDiagram.distanceKm, 0)} км</strong>
                  </div>
                  <div className="space-stat">
                    <span>Высота над Землёй</span>
                    <strong>{formatNumber(selectedSatellite.altitudeKm, 0)} км</strong>
                  </div>
                  <div className="space-stat">
                    <span>ECI X</span>
                    <strong>{formatNumber(selectedSatellite.coordinates3d.x, 0)} км</strong>
                  </div>
                  <div className="space-stat">
                    <span>ECI Y</span>
                    <strong>{formatNumber(selectedSatellite.coordinates3d.y, 0)} км</strong>
                  </div>
                  <div className="space-stat">
                    <span>ECI Z</span>
                    <strong>{formatNumber(selectedSatellite.coordinates3d.z, 0)} км</strong>
                  </div>
                  <div className="space-stat">
                    <span>Скорость</span>
                    <strong>{formatNumber(selectedSatellite.speedKmS, 2)} км/с</strong>
                  </div>
                </div>
              </div>
            </article>
          ) : null}
          </section>
        </div>

        <div className="dashboard-side-column w-100">
          <section className="details-panel panel shadow-lg">
          <div className="panel-heading">
            <h2>Карточка спутника</h2>
            <p>Выберите спутник на карте или в списке справа, чтобы увидеть его текущие параметры.</p>
          </div>

          {selectedSatellite ? (
            <article className="detail-card">
              <div className="detail-card__header">
                <span
                  className="satellite-card__swatch"
                  style={{ backgroundColor: selectedSatellite.color }}
                />
                <div>
                  <h3>{selectedSatellite.name}</h3>
                  <p>
                    {selectedSatellite.country} / {selectedSatellite.operator}
                  </p>
                </div>
              </div>

              {selectedPassAlert ? (
                <div className="notice-card">
                  Ближайший пролёт над точкой наблюдения — {formatDurationFromNow(selectedPassAlert.time, simulatedTime)}.
                </div>
              ) : null}

              <dl className="detail-grid">
                <div>
                  <dt>Орбита</dt>
                  <dd>{selectedSatellite.orbitType}</dd>
                </div>
                <div>
                  <dt>Назначение</dt>
                  <dd>{selectedSatellite.mission}</dd>
                </div>
                <div>
                  <dt>Высота</dt>
                  <dd>{formatNumber(selectedSatellite.altitudeKm, 0)} км</dd>
                </div>
                <div>
                  <dt>Период</dt>
                  <dd>{formatNumber(selectedSatellite.orbitalPeriodMinutes, 1)} мин</dd>
                </div>
                <div>
                  <dt>Текущие координаты</dt>
                  <dd>
                    {formatNumber(selectedSatellite.lat, 2)}°, {formatNumber(selectedSatellite.lng, 2)}°
                  </dd>
                </div>
                <div>
                  <dt>Пространство (ECI)</dt>
                  <dd>
                    X {formatNumber(selectedSatellite.coordinates3d.x, 0)} / Y{' '}
                    {formatNumber(selectedSatellite.coordinates3d.y, 0)} / Z{' '}
                    {formatNumber(selectedSatellite.coordinates3d.z, 0)} км
                  </dd>
                </div>
                <div>
                  <dt>Скорость</dt>
                  <dd>{formatNumber(selectedSatellite.speedKmS, 2)} км/с</dd>
                </div>
                <div>
                  <dt>Покрытие</dt>
                  <dd>{formatNumber(selectedSatellite.visibilityRadiusKm, 0)} км по поверхности</dd>
                </div>
                <div>
                  <dt>Следующий пролёт</dt>
                  <dd>
                    {selectedSatellite.nextPass?.time
                      ? formatDateTime(selectedSatellite.nextPass.time)
                      : `Не найден в ближайшие ${PASS_LOOKAHEAD_HOURS} часов`}
                  </dd>
                </div>
                <div>
                  <dt>Минимальная дистанция</dt>
                  <dd>
                    {selectedSatellite.nextPass?.distanceKm
                      ? `${formatNumber(selectedSatellite.nextPass.distanceKm, 0)} км`
                      : '—'}
                  </dd>
                </div>
              </dl>

              <div className="observer-form">
                <h4>Точка наблюдения</h4>
                <div className="inline-fields">
                  <label>
                    Широта
                    <input
                      type="number"
                      value={observerInputs.lat}
                      min={-90}
                      max={90}
                      step="0.1"
                      onChange={(event) =>
                        handleObserverInputChange('lat', event.target.value, {
                          min: -90,
                          max: 90,
                        })
                      }
                      onBlur={() =>
                        handleObserverInputBlur('lat', {
                          min: -90,
                          max: 90,
                        })
                      }
                    />
                  </label>
                  <label>
                    Долгота
                    <input
                      type="number"
                      value={observerInputs.lng}
                      min={-180}
                      max={180}
                      step="0.1"
                      onChange={(event) =>
                        handleObserverInputChange('lng', event.target.value, {
                          min: -180,
                          max: 180,
                        })
                      }
                      onBlur={() =>
                        handleObserverInputBlur('lng', {
                          min: -180,
                          max: 180,
                        })
                      }
                    />
                  </label>
                </div>
              </div>

              <div className="subpanel-card">
                <div className="subpanel-card__header">
                  <h4>Ближайшие пролёты над выбранной точкой</h4>
                  <span>{passStatus === 'loading' ? 'Пересчитываем…' : `${observerUpcomingPasses.length} найдено`}</span>
                </div>
                {observerUpcomingPasses.length > 0 ? (
                  <div className="pass-list">
                    {visibleObserverUpcomingPasses.map((item) => (
                      <button
                        key={`${item.id}-pass`}
                        type="button"
                        className={`pass-list__item ${safeSelectedSatelliteId === item.id ? 'is-selected' : ''}`}
                        onClick={() => setSelectedSatelliteId(item.id)}
                      >
                        <span className="pass-list__swatch" style={{ backgroundColor: item.color }} />
                        <div>
                          <strong>{item.name}</strong>
                          <small>
                            {formatDateTime(item.nextPass.time)} • {formatDurationFromNow(item.nextPass.time, simulatedTime)}
                          </small>
                        </div>
                        <span>{formatNumber(item.nextPass.distanceKm, 0)} км</span>
                      </button>
                    ))}
                    {hasHiddenObserverUpcomingPasses ? (
                      <button
                        type="button"
                        className="pass-list__toggle"
                        onClick={() => setIsPassListExpanded((current) => !current)}
                        aria-expanded={isPassListExpanded}
                        aria-label={isPassListExpanded ? 'Свернуть список пролётов' : 'Показать все пролёты'}
                      >
                        <span>{isPassListExpanded ? 'Свернуть' : 'Показать ещё'}</span>
                        <span
                          className={`pass-list__toggle-icon${isPassListExpanded ? ' pass-list__toggle-icon--expanded' : ''}`}
                          aria-hidden="true"
                        >
                          ↓
                        </span>
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <p className="helper-text">Над текущей точкой наблюдения нет пролётов в расчётном окне.</p>
                )}
              </div>

              <details>
                <summary>TLE</summary>
                <pre>{selectedSatellite.tle}</pre>
              </details>

            </article>
          ) : (
            <p className="helper-text">Нет спутников, удовлетворяющих текущим фильтрам.</p>
          )}
          </section>

          <section className="list-panel panel shadow-lg">
          <div className="panel-heading">
            <h2>Список спутников</h2>
            <p>{searchedTelemetryCount} объектов после применения фильтров, поиска и группировки.</p>
          </div>

          <div className="subpanel-card">
            <div className="subpanel-card__header">
              <h4>Сравнение группировок</h4>
              <span>{formatGroupMode(comparisonMode)}</span>
            </div>
            {comparisonRows.length > 0 ? (
              <div className="comparison-grid">
                {comparisonRows.map((row) => (
                  <article key={row.title} className="comparison-card">
                    <strong>{row.title}</strong>
                    <span>{row.count} спутн.</span>
                    <small>Средняя высота: {formatNumber(row.averageAltitudeKm, 0)} км</small>
                    <small>Средняя скорость: {formatNumber(row.averageSpeedKmS, 2)} км/с</small>
                    <small>Макс. покрытие: {formatNumber(row.maxCoverageKm, 0)} км</small>
                  </article>
                ))}
              </div>
            ) : (
              <p className="helper-text">Недостаточно данных для сравнения.</p>
            )}
          </div>

          <div className="subpanel-card">
            <label className="list-search-field">
              Поиск по спутникам
              <input
                type="search"
                value={satelliteListSearchQuery}
                placeholder="Название, страна, оператор, орбита…"
                onChange={(event) => setSatelliteListSearchQuery(event.target.value)}
              />
            </label>
          </div>

          <div className="satellite-list pe-1">
            {visibleGroupedTelemetry.map((group) => (
              <section key={group.title} className="satellite-group">
                <div className="satellite-group__header">{group.title}</div>
                {group.items.map((satellite) => (
                  <article
                    key={satellite.id}
                    className={`satellite-card ${safeSelectedSatelliteId === satellite.id ? 'is-selected' : ''}`}
                    onClick={() => setSelectedSatelliteId(satellite.id)}
                  >
                    <div className="satellite-card__header">
                      <span
                        className="satellite-card__swatch"
                        style={{ backgroundColor: satellite.color }}
                      />
                      <div>
                        <h3>{satellite.name}</h3>
                        <p>
                          {satellite.country} • {satellite.orbitType} • {satellite.mission}
                        </p>
                      </div>
                    </div>

                    <dl className="satellite-card__stats">
                      <div>
                        <dt>Координаты</dt>
                        <dd>
                          {formatNumber(satellite.lat, 1)}°, {formatNumber(satellite.lng, 1)}°
                        </dd>
                      </div>
                      <div>
                        <dt>Высота</dt>
                        <dd>{formatNumber(satellite.altitudeKm, 0)} км</dd>
                      </div>
                      <div>
                        <dt>Покрытие</dt>
                        <dd>{formatNumber(satellite.visibilityRadiusKm, 0)} км</dd>
                      </div>
                      <div>
                        <dt>Пролёт</dt>
                        <dd>
                          {satellite.nextPass?.time
                            ? formatDurationFromNow(satellite.nextPass.time, simulatedTime)
                            : 'нет окна'}
                        </dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </section>
            ))}
            {hasHiddenSatelliteCards ? (
              <button
                type="button"
                className="pass-list__toggle"
                onClick={() => setIsSatelliteListExpanded((current) => !current)}
                aria-expanded={isSatelliteListExpanded}
                aria-label={isSatelliteListExpanded ? 'Свернуть список спутников' : 'Показать все спутники'}
              >
                <span>{isSatelliteListExpanded ? 'Свернуть' : 'Показать ещё'}</span>
                <span
                  className={`pass-list__toggle-icon${isSatelliteListExpanded ? ' pass-list__toggle-icon--expanded' : ''}`}
                  aria-hidden="true"
                >
                  ↓
                </span>
              </button>
            ) : null}
            {searchedTelemetryCount === 0 ? (
              <p className="helper-text">По текущим фильтрам и поисковому запросу спутники не найдены.</p>
            ) : null}
          </div>
          </section>
        </div>
      </main>
    </div>
  )
}
