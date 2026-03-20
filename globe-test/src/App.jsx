import { useEffect, useMemo, useRef, useState } from 'react'
import Globe from 'globe.gl'
import './App.css'
import {
  DEFAULT_TLE_SETS,
  estimateNextPass,
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
const WORLD_MAP_MARKERS = [
  { name: 'Байконур', lat: 45.92, lng: 63.34 },
  { name: 'Канаверал', lat: 28.39, lng: -80.6 },
  { name: 'Тулуза', lat: 43.6, lng: 1.44 },
]

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

function groupLabel(telemetry, mode) {
  if (mode === 'country') return telemetry.country
  if (mode === 'operator') return telemetry.operator
  if (mode === 'orbitType') return telemetry.orbitType
  if (mode === 'mission') return telemetry.mission
  return 'Все спутники'
}

function convertEventToLatLng(event, container) {
  const rect = container.getBoundingClientRect()
  const x = (event.clientX - rect.left) / rect.width
  const y = (event.clientY - rect.top) / rect.height

  return {
    lat: 90 - y * 180,
    lng: x * 360 - 180,
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

export default function App() {
  const globeContainerRef = useRef(null)
  const globeInstanceRef = useRef(null)
  const mapViewportRef = useRef(null)
  const dragStateRef = useRef(null)

  const [sourceType, setSourceType] = useState('preset')
  const [activeSetId, setActiveSetId] = useState(DEFAULT_TLE_SETS[0].id)
  const [customSatellites, setCustomSatellites] = useState([])
  const [simulationMode, setSimulationMode] = useState('realtime')
  const [isPlaying, setIsPlaying] = useState(true)
  const [simulationSpeed, setSimulationSpeed] = useState(60)
  const [simulatedTime, setSimulatedTime] = useState(() => new Date())
  const [selectedSatelliteId, setSelectedSatelliteId] = useState(null)
  const [selectedOrbitFilter, setSelectedOrbitFilter] = useState('Все')
  const [selectedCountry, setSelectedCountry] = useState('Все')
  const [selectedOperator, setSelectedOperator] = useState('Все')
  const [selectedMission, setSelectedMission] = useState('Все')
  const [groupBy, setGroupBy] = useState('none')
  const [mapTransform, setMapTransform] = useState({ scale: 1.35, offsetX: 0, offsetY: 0 })
  const [observer, setObserver] = useState({ lat: 55.75, lng: 37.62, label: 'Москва' })
  const [uploadStatus, setUploadStatus] = useState('')

  const worldGrid = useMemo(() => buildWorldGrid(), [])

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

    if (!containerElement || globeInstanceRef.current) return undefined

    const globe = Globe()(containerElement)
      .globeImageUrl('//unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
      .backgroundImageUrl('//unpkg.com/three-globe/example/img/night-sky.png')
      .showAtmosphere(true)
      .atmosphereColor('#6ea8ff')
      .atmosphereAltitude(0.18)
      .pointRadius(0.6)
      .pointResolution(20)
      .pointAltitude('altitude')
      .pointColor('color')
      .pointLabel((point) => point.name)
      .pathColor('color')
      .pathStroke(0.9)
      .pathPointLat((point) => point.lat)
      .pathPointLng((point) => point.lng)
      .pathPointAlt((point) => point.altitude)
      .labelLat('lat')
      .labelLng('lng')
      .labelAltitude('altitude')
      .labelText('text')
      .labelColor('color')
      .labelSize(1.2)
      .labelDotRadius(0.2)

    globe.controls().enablePan = true
    globe.controls().zoomSpeed = 0.8
    globe.controls().minDistance = 180
    globe.controls().maxDistance = 700
    globe.pointOfView({ lat: 25, lng: 20, altitude: 2.2 }, 0)

    globeInstanceRef.current = globe

    return () => {
      containerElement.innerHTML = ''
      globeInstanceRef.current = null
    }
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
        const nextPass = estimateNextPass(satellite, observer, simulatedTime)

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
          country: satellite.metadata.country,
          operator: satellite.metadata.operator,
          mission: satellite.metadata.mission,
          inclinationDeg: satellite.inclinationDeg,
          coordinates3d: position.eci,
          orbit: orbitPath(satellite, simulatedTime),
          tle: `${satellite.line1}\n${satellite.line2}`,
          nextPass,
        }
      }),
    [observer, satellites, simulatedTime],
  )

  const filterOptions = useMemo(() => {
    const countries = new Set(['Все'])
    const operators = new Set(['Все'])
    const missions = new Set(['Все'])

    telemetry.forEach((item) => {
      countries.add(item.country)
      operators.add(item.operator)
      missions.add(item.mission)
    })

    return {
      countries: [...countries],
      operators: [...operators],
      missions: [...missions],
    }
  }, [telemetry])

  const safeSelectedSatelliteId =
    selectedSatelliteId && telemetry.some((item) => item.id === selectedSatelliteId)
      ? selectedSatelliteId
      : telemetry[0]?.id ?? null

  const filteredTelemetry = useMemo(
    () =>
      telemetry.filter((item) => {
        if (selectedOrbitFilter !== 'Все' && item.orbitType !== selectedOrbitFilter) return false
        if (selectedCountry !== 'Все' && item.country !== selectedCountry) return false
        if (selectedOperator !== 'Все' && item.operator !== selectedOperator) return false
        if (selectedMission !== 'Все' && item.mission !== selectedMission) return false
        return true
      }),
    [telemetry, selectedCountry, selectedMission, selectedOperator, selectedOrbitFilter],
  )

  const groupedTelemetry = useMemo(() => {
    const groups = new Map()

    filteredTelemetry.forEach((item) => {
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
  }, [filteredTelemetry, groupBy])

  const selectedSatellite = useMemo(
    () => filteredTelemetry.find((item) => item.id === safeSelectedSatelliteId) ?? filteredTelemetry[0] ?? null,
    [filteredTelemetry, safeSelectedSatelliteId],
  )

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
      filteredTelemetry.map((satellite) => ({
        lat: satellite.lat,
        lng: satellite.lng,
        altitude: satellite.altitudeRatio + 0.015,
        text: satellite.name,
        color: satellite.color,
      })),
    )

    globe.pathsData(
      filteredTelemetry.map((satellite) => ({
        color: satellite.color,
        points: satellite.orbit,
      })),
    )
    globe.pathPoints('points')
  }, [filteredTelemetry])

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
    setUploadStatus(`Загружено спутников: ${parsed.length}`)
  }

  const handleMapWheel = (event) => {
    event.preventDefault()
    setMapTransform((previous) => ({
      ...previous,
      scale: Math.max(1, Math.min(4.2, previous.scale - event.deltaY * 0.0015)),
    }))
  }

  const handleMapPointerDown = (event) => {
    const target = mapViewportRef.current
    if (!target) return

    dragStateRef.current = {
      x: event.clientX,
      y: event.clientY,
      offsetX: mapTransform.offsetX,
      offsetY: mapTransform.offsetY,
    }

    target.setPointerCapture(event.pointerId)
  }

  const handleMapPointerMove = (event) => {
    if (!dragStateRef.current) return

    const deltaX = event.clientX - dragStateRef.current.x
    const deltaY = event.clientY - dragStateRef.current.y

    setMapTransform((previous) => ({
      ...previous,
      offsetX: dragStateRef.current.offsetX + deltaX,
      offsetY: dragStateRef.current.offsetY + deltaY,
    }))
  }

  const handleMapPointerUp = () => {
    dragStateRef.current = null
  }

  const handleMapClick = (event) => {
    if (dragStateRef.current) return
    const viewport = mapViewportRef.current
    if (!viewport) return

    const coordinates = convertEventToLatLng(event, viewport)
    setObserver({
      lat: coordinates.lat,
      lng: coordinates.lng,
      label: `Точка ${formatNumber(coordinates.lat, 2)} / ${formatNumber(coordinates.lng, 2)}`,
    })
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Satellite situational awareness</p>
          <h1>Карта и 3D-пространство спутников по TLE</h1>
          <p className="panel-copy">
            Показывает текущие положения, анимацию движения, фильтрацию и прогноз следующего пролёта
            над выбранной точкой.
          </p>
        </div>

        <div className="time-chip">
          <span>{simulationMode === 'realtime' ? 'Реальное время' : 'Симуляция'}</span>
          <strong>{formatDateTime(simulatedTime)}</strong>
        </div>
      </header>

      <main className="dashboard-grid">
        <section className="controls-panel panel">
          <div className="panel-block">
            <h2>Источник TLE</h2>
            <label>
              Предустановленный набор
              <select value={activeSetId} onChange={handlePresetChange}>
                {DEFAULT_TLE_SETS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Загрузить TLE файл
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
                onClick={() => {
                  setSimulationMode('realtime')
                  setIsPlaying(true)
                  setSimulatedTime(new Date())
                }}
              >
                Реальное время
              </button>
              <button
                type="button"
                className={simulationMode === 'sim' ? 'is-active' : ''}
                onClick={() => {
                  setSimulationMode('sim')
                  setSimulatedTime(new Date())
                }}
              >
                Симуляция
              </button>
            </div>

            <div className="button-row">
              <button type="button" onClick={() => setIsPlaying((value) => !value)}>
                {isPlaying ? 'Пауза' : 'Пуск'}
              </button>
              <button
                type="button"
                onClick={() => setSimulatedTime((value) => new Date(value.getTime() - 10 * 60000))}
              >
                −10 мин
              </button>
              <button
                type="button"
                onClick={() => setSimulatedTime((value) => new Date(value.getTime() + 10 * 60000))}
              >
                +10 мин
              </button>
            </div>

            <label>
              Скорость симуляции
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
              Группировка карточек
              <select value={groupBy} onChange={(event) => setGroupBy(event.target.value)}>
                {GROUP_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value === 'none' ? 'Без группировки' : value}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className="visual-panel panel">
          <div className="panel-heading">
            <h2>Положения спутников на карте</h2>
            <p>Колесо мыши — масштаб, перетаскивание — перемещение, клик — выбрать точку наблюдения.</p>
          </div>

          <div
            ref={mapViewportRef}
            className="map-viewport"
            onWheel={handleMapWheel}
            onPointerDown={handleMapPointerDown}
            onPointerMove={handleMapPointerMove}
            onPointerUp={handleMapPointerUp}
            onPointerLeave={handleMapPointerUp}
            onClick={handleMapClick}
          >
            <div
              className="map-surface"
              style={{
                transform: `translate(${mapTransform.offsetX}px, ${mapTransform.offsetY}px) scale(${mapTransform.scale})`,
              }}
            >
              <div className="map-ocean" />
              <div className="map-grid">
                {worldGrid.verticalLines}
                {worldGrid.horizontalLines}
              </div>
              <svg className="map-continents" viewBox="0 0 1000 500" preserveAspectRatio="none">
                <path d="M86 140l38-32 78 6 40 34-6 43-65 27-31 49-61-6-25-55zM278 142l58-48 97-8 58 21 7 63-78 42-41 71-85 8-56-57 17-56zM531 92l54 18 31 44 58-10 40 18 88 6 58 34-28 44-88 14-51 41-88 12-57-41-39-75 6-53zM723 332l69-20 86 27 32 71-41 51-102 4-61-42-8-54zM823 113l73 27 14 39-43 26-52-14-16-41z" />
              </svg>

              {filteredTelemetry.map((satellite) => (
                <button
                  key={satellite.id}
                  type="button"
                  className={`map-satellite ${selectedSatellite?.id === satellite.id ? 'is-selected' : ''}`}
                  style={{
                    left: `${((satellite.lng + 180) / 360) * 100}%`,
                    top: `${((90 - satellite.lat) / 180) * 100}%`,
                    '--satellite-color': satellite.color,
                  }}
                  onClick={(event) => {
                    event.stopPropagation()
                    setSelectedSatelliteId(satellite.id)
                  }}
                  title={satellite.name}
                >
                  <span />
                  <em>{satellite.name}</em>
                </button>
              ))}

              <div
                className="observer-point"
                style={{
                  left: `${((observer.lng + 180) / 360) * 100}%`,
                  top: `${((90 - observer.lat) / 180) * 100}%`,
                }}
              >
                <span />
                <strong>{observer.label}</strong>
              </div>

              {WORLD_MAP_MARKERS.map((marker) => (
                <div
                  key={marker.name}
                  className="map-city"
                  style={{
                    left: `${((marker.lng + 180) / 360) * 100}%`,
                    top: `${((90 - marker.lat) / 180) * 100}%`,
                  }}
                >
                  <span />
                  <small>{marker.name}</small>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="space-panel panel">
          <div className="panel-heading">
            <h2>Положения спутников в пространстве</h2>
            <p>3D-глобус показывает текущую геометрию и траектории орбит вокруг Земли.</p>
          </div>
          <div ref={globeContainerRef} className="globe-canvas" />
        </section>

        <section className="details-panel panel">
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
                  <dt>Следующий пролёт</dt>
                  <dd>
                    {selectedSatellite.nextPass?.time
                      ? formatDateTime(selectedSatellite.nextPass.time)
                      : 'Не найден в ближайшие 48 часов'}
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
                      value={observer.lat}
                      min={-90}
                      max={90}
                      step="0.1"
                      onChange={(event) =>
                        setObserver((prev) => ({ ...prev, lat: Number(event.target.value), label: 'Пользовательская точка' }))
                      }
                    />
                  </label>
                  <label>
                    Долгота
                    <input
                      type="number"
                      value={observer.lng}
                      min={-180}
                      max={180}
                      step="0.1"
                      onChange={(event) =>
                        setObserver((prev) => ({ ...prev, lng: Number(event.target.value), label: 'Пользовательская точка' }))
                      }
                    />
                  </label>
                </div>
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

        <section className="list-panel panel">
          <div className="panel-heading">
            <h2>Список спутников</h2>
            <p>{filteredTelemetry.length} объектов после применения фильтров и группировки.</p>
          </div>

          <div className="satellite-list">
            {groupedTelemetry.map((group) => (
              <section key={group.title} className="satellite-group">
                <div className="satellite-group__header">{group.title}</div>
                {group.items.map((satellite) => (
                  <article
                    key={satellite.id}
                    className={`satellite-card ${selectedSatellite?.id === satellite.id ? 'is-selected' : ''}`}
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
                    </dl>
                  </article>
                ))}
              </section>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
