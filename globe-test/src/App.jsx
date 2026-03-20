import { useEffect, useMemo, useRef, useState } from 'react'
import Globe from 'globe.gl'
import './App.css'
import { DEFAULT_TLES, orbitPath, parseTle, propagateSatellite } from './lib/tle'

const REFRESH_INTERVAL_MS = 1000

function formatNumber(value, digits = 0) {
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value)
}

export default function App() {
  const containerRef = useRef(null)
  const globeInstanceRef = useRef(null)
  const satellites = useMemo(() => DEFAULT_TLES.map(parseTle), [])
  const [telemetry, setTelemetry] = useState([])
  const [timestamp, setTimestamp] = useState(new Date())

  useEffect(() => {
    const containerElement = containerRef.current

    if (!containerElement || globeInstanceRef.current) return undefined

    const globe = Globe()(containerElement)
      .globeImageUrl('//unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
      .backgroundImageUrl('//unpkg.com/three-globe/example/img/night-sky.png')
      .showAtmosphere(true)
      .atmosphereColor('#6ea8ff')
      .atmosphereAltitude(0.18)
      .pointRadius(0.55)
      .pointResolution(18)
      .pointAltitude('altitude')
      .pointColor('color')
      .pathColor('color')
      .pathStroke(0.75)
      .pathPointLat((point) => point.lat)
      .pathPointLng((point) => point.lng)
      .pathPointAlt((point) => point.altitude)
      .labelLat('lat')
      .labelLng('lng')
      .labelAltitude('altitude')
      .labelText('text')
      .labelColor('color')
      .labelSize(1.4)
      .labelDotRadius(0.22)

    globe.controls().autoRotate = true
    globe.controls().autoRotateSpeed = 0.35
    globe.pointOfView({ lat: 20, lng: 15, altitude: 2.2 }, 0)

    globeInstanceRef.current = globe

    const updateSatellites = () => {
      const nextTimestamp = new Date()
      const nextTelemetry = satellites.map((satellite) => {
        const position = propagateSatellite(satellite, nextTimestamp)

        return {
          name: satellite.name,
          color: satellite.color,
          lat: position.lat,
          lng: position.lng,
          altitudeKm: position.altitudeKm,
          speedKmS: position.speedKmS,
          pointSize: 0.26,
          altitude: position.altitudeRatio,
          orbit: orbitPath(satellite, nextTimestamp),
          tle: `${satellite.line1}\n${satellite.line2}`,
        }
      })

      globe.pointsData(
        nextTelemetry.map((satellite) => ({
          lat: satellite.lat,
          lng: satellite.lng,
          altitude: satellite.altitude,
          size: satellite.pointSize,
          color: satellite.color,
          name: satellite.name,
        })),
      )

      globe.labelsData(
        nextTelemetry.map((satellite) => ({
          lat: satellite.lat,
          lng: satellite.lng,
          altitude: satellite.altitude + 0.02,
          text: satellite.name,
          color: satellite.color,
        })),
      )

      globe.pathsData(
        nextTelemetry.map((satellite) => ({
          color: satellite.color,
          points: satellite.orbit,
        })),
      )
      globe.pathPoints('points')

      setTelemetry(nextTelemetry)
      setTimestamp(nextTimestamp)
    }

    updateSatellites()
    const intervalId = window.setInterval(updateSatellites, REFRESH_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
      globe.controls().autoRotate = false
      containerElement.innerHTML = ''
      globeInstanceRef.current = null
    }
  }, [satellites])

  return (
    <div className="app-shell">
      <div ref={containerRef} className="globe-canvas" />

      <aside className="telemetry-panel">
        <div className="panel-header">
          <p className="eyebrow">3D orbit view</p>
          <h1>TLE спутники</h1>
          <p className="panel-copy">
            Позиции обновляются каждую секунду на основе встроенных TLE и упрощённого
            орбитального расчёта.
          </p>
        </div>

        <div className="timestamp">Обновлено: {timestamp.toLocaleTimeString('ru-RU')}</div>

        <div className="satellite-list">
          {telemetry.map((satellite) => (
            <article key={satellite.name} className="satellite-card">
              <div className="satellite-card__header">
                <span
                  className="satellite-card__swatch"
                  style={{ backgroundColor: satellite.color }}
                />
                <div>
                  <h2>{satellite.name}</h2>
                  <p>
                    {formatNumber(satellite.lat, 2)}°, {formatNumber(satellite.lng, 2)}°
                  </p>
                </div>
              </div>

              <dl className="satellite-card__stats">
                <div>
                  <dt>Высота</dt>
                  <dd>{formatNumber(satellite.altitudeKm, 0)} км</dd>
                </div>
                <div>
                  <dt>Скорость</dt>
                  <dd>{formatNumber(satellite.speedKmS, 2)} км/с</dd>
                </div>
              </dl>

              <details>
                <summary>TLE</summary>
                <pre>{satellite.tle}</pre>
              </details>
            </article>
          ))}
        </div>
      </aside>
    </div>
  )
}
