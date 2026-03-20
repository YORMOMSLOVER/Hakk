const EARTH_RADIUS_KM = 6371
const EARTH_MU = 398600.4418

function normalizeAngle(angle) {
  const twoPi = Math.PI * 2
  return ((angle % twoPi) + twoPi) % twoPi
}

function parseEpoch(year, dayOfYear) {
  const fullYear = year < 57 ? 2000 + year : 1900 + year
  const start = Date.UTC(fullYear, 0, 1)
  return new Date(start + (dayOfYear - 1) * 86400000)
}

function solveKepler(meanAnomaly, eccentricity, iterations = 8) {
  let eccentricAnomaly = meanAnomaly
  for (let i = 0; i < iterations; i += 1) {
    eccentricAnomaly -=
      (eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - meanAnomaly) /
      (1 - eccentricity * Math.cos(eccentricAnomaly))
  }
  return eccentricAnomaly
}

function julianDate(date) {
  return date.getTime() / 86400000 + 2440587.5
}

function gmst(date) {
  const jd = julianDate(date)
  const t = (jd - 2451545.0) / 36525
  const thetaDegrees =
    280.46061837 +
    360.98564736629 * (jd - 2451545) +
    0.000387933 * t * t -
    (t * t * t) / 38710000

  return normalizeAngle((thetaDegrees * Math.PI) / 180)
}

export function parseTle({ name, line1, line2, color }) {
  const epochYear = Number.parseInt(line1.slice(18, 20), 10)
  const epochDay = Number.parseFloat(line1.slice(20, 32))
  const inclination = Number.parseFloat(line2.slice(8, 16))
  const raan = Number.parseFloat(line2.slice(17, 25))
  const eccentricity = Number.parseFloat(`0.${line2.slice(26, 33).trim()}`)
  const argumentOfPerigee = Number.parseFloat(line2.slice(34, 42))
  const meanAnomaly = Number.parseFloat(line2.slice(43, 51))
  const meanMotion = Number.parseFloat(line2.slice(52, 63))

  return {
    name,
    color,
    line1,
    line2,
    epoch: parseEpoch(epochYear, epochDay),
    inclination: (inclination * Math.PI) / 180,
    raan: (raan * Math.PI) / 180,
    eccentricity,
    argumentOfPerigee: (argumentOfPerigee * Math.PI) / 180,
    meanAnomaly: (meanAnomaly * Math.PI) / 180,
    meanMotion,
  }
}

export function propagateSatellite(satellite, date) {
  const deltaSeconds = (date.getTime() - satellite.epoch.getTime()) / 1000
  const meanMotionRad = (satellite.meanMotion * Math.PI * 2) / 86400
  const semiMajorAxis = Math.cbrt(EARTH_MU / (meanMotionRad * meanMotionRad))
  const meanAnomaly = normalizeAngle(satellite.meanAnomaly + meanMotionRad * deltaSeconds)
  const eccentricAnomaly = solveKepler(meanAnomaly, satellite.eccentricity)

  const xOrbital = semiMajorAxis * (Math.cos(eccentricAnomaly) - satellite.eccentricity)
  const yOrbital =
    semiMajorAxis * Math.sqrt(1 - satellite.eccentricity ** 2) * Math.sin(eccentricAnomaly)

  const cosO = Math.cos(satellite.raan)
  const sinO = Math.sin(satellite.raan)
  const cosI = Math.cos(satellite.inclination)
  const sinI = Math.sin(satellite.inclination)
  const cosW = Math.cos(satellite.argumentOfPerigee)
  const sinW = Math.sin(satellite.argumentOfPerigee)

  const x1 = xOrbital * cosW - yOrbital * sinW
  const y1 = xOrbital * sinW + yOrbital * cosW

  const xEci = x1 * cosO - y1 * cosI * sinO
  const yEci = x1 * sinO + y1 * cosI * cosO
  const zEci = y1 * sinI

  const theta = gmst(date)
  const cosTheta = Math.cos(theta)
  const sinTheta = Math.sin(theta)

  const xEcef = xEci * cosTheta + yEci * sinTheta
  const yEcef = -xEci * sinTheta + yEci * cosTheta
  const zEcef = zEci

  const radius = Math.sqrt(xEcef ** 2 + yEcef ** 2 + zEcef ** 2)
  const latitude = Math.atan2(zEcef, Math.sqrt(xEcef ** 2 + yEcef ** 2))
  const longitude = Math.atan2(yEcef, xEcef)
  const altitude = radius - EARTH_RADIUS_KM
  const speedKmS = Math.sqrt(EARTH_MU * ((2 / radius) - 1 / semiMajorAxis))

  return {
    lat: (latitude * 180) / Math.PI,
    lng: (longitude * 180) / Math.PI,
    altitudeKm: altitude,
    altitudeRatio: Math.max(0.035, altitude / EARTH_RADIUS_KM),
    speedKmS,
  }
}

export function orbitPath(satellite, date, stepMinutes = 4, samples = 45) {
  const points = []
  const half = Math.floor(samples / 2)

  for (let offset = -half; offset <= half; offset += 1) {
    const pointDate = new Date(date.getTime() + offset * stepMinutes * 60000)
    const point = propagateSatellite(satellite, pointDate)
    points.push({
      lat: point.lat,
      lng: point.lng,
      altitude: point.altitudeRatio,
    })
  }

  return points
}

export const DEFAULT_TLES = [
  {
    name: 'ISS (ZARYA)',
    color: '#ff6b6b',
    line1: '1 25544U 98067A   26079.51782528  .00010580  00000+0  19412-3 0  9998',
    line2: '2 25544  51.6334 287.1253 0004235 188.8597 244.1967 15.49893145547103',
  },
  {
    name: 'HUBBLE',
    color: '#4ecdc4',
    line1: '1 20580U 90037B   26079.51606152  .00000831  00000+0  36032-4 0  9996',
    line2: '2 20580  28.4682 217.9334 0002141 315.5657  44.4935 15.25293767872488',
  },
  {
    name: 'NOAA 15',
    color: '#ffd166',
    line1: '1 25338U 98030A   26079.48933830  .00000095  00000+0  74181-4 0  9997',
    line2: '2 25338  98.5313  62.4244 0010997 271.1088  88.8755 14.26414398444880',
  },
]
