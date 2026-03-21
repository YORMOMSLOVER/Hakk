const EARTH_RADIUS_KM = 6371
const EARTH_MU = 398600.4418
const TWO_PI = Math.PI * 2

function normalizeAngle(angle) {
  return ((angle % TWO_PI) + TWO_PI) % TWO_PI
}

function normalizeLongitude(lng) {
  return ((lng + 540) % 360) - 180
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

function formatMetadata(source) {
  return {
    country: source.country ?? 'Неизвестно',
    operator: source.operator ?? 'Неизвестно',
    mission: source.mission ?? 'Не указано',
  }
}

export function classifyOrbit(altitudeKm) {
  if (altitudeKm >= 35786 - 1500 && altitudeKm <= 35786 + 1500) return 'GEO'
  if (altitudeKm >= 2000) return 'MEO'
  if (altitudeKm < 2000) return 'LEO'
  return 'HEO'
}

export function visibilityRadiusKm(altitudeKm, paddingKm = 0) {
  const safeAltitude = Math.max(0, altitudeKm)
  const horizonAngle = Math.acos(EARTH_RADIUS_KM / (EARTH_RADIUS_KM + safeAltitude))
  return EARTH_RADIUS_KM * horizonAngle + paddingKm
}

export function footprintPath(position, samples = 72) {
  const angularDistance = Math.acos(EARTH_RADIUS_KM / (EARTH_RADIUS_KM + Math.max(0, position.altitudeKm)))
  const latRad = (position.lat * Math.PI) / 180
  const lngRad = (position.lng * Math.PI) / 180
  const points = []

  for (let index = 0; index <= samples; index += 1) {
    const bearing = (index / samples) * TWO_PI
    const footprintLat = Math.asin(
      Math.sin(latRad) * Math.cos(angularDistance) +
        Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearing),
    )
    const footprintLng =
      lngRad +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latRad),
        Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(footprintLat),
      )

    points.push({
      lat: (footprintLat * 180) / Math.PI,
      lng: normalizeLongitude((footprintLng * 180) / Math.PI),
    })
  }

  return points
}

export function parseTle(source, index = 0) {
  const { name, line1, line2 } = source
  const epochYear = Number.parseInt(line1.slice(18, 20), 10)
  const epochDay = Number.parseFloat(line1.slice(20, 32))
  const inclination = Number.parseFloat(line2.slice(8, 16))
  const raan = Number.parseFloat(line2.slice(17, 25))
  const eccentricity = Number.parseFloat(`0.${line2.slice(26, 33).trim()}`)
  const argumentOfPerigee = Number.parseFloat(line2.slice(34, 42))
  const meanAnomaly = Number.parseFloat(line2.slice(43, 51))
  const meanMotion = Number.parseFloat(line2.slice(52, 63))
  const color = source.color ?? DEFAULT_COLORS[index % DEFAULT_COLORS.length]
  const metadata = formatMetadata(source)

  return {
    id: source.id ?? `${name}-${line1.slice(2, 7).trim()}-${index}`,
    name,
    color,
    line1,
    line2,
    epoch: parseEpoch(epochYear, epochDay),
    inclination: (inclination * Math.PI) / 180,
    inclinationDeg: inclination,
    raan: (raan * Math.PI) / 180,
    eccentricity,
    argumentOfPerigee: (argumentOfPerigee * Math.PI) / 180,
    meanAnomaly: (meanAnomaly * Math.PI) / 180,
    meanMotion,
    metadata,
  }
}

export function propagateSatellite(satellite, date) {
  const deltaSeconds = (date.getTime() - satellite.epoch.getTime()) / 1000
  const meanMotionRad = (satellite.meanMotion * TWO_PI) / 86400
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
  const orbitalPeriodMinutes = 1440 / satellite.meanMotion
  const orbitType = classifyOrbit(altitude)
  const groundVisibilityRadiusKm = visibilityRadiusKm(altitude)

  return {
    lat: (latitude * 180) / Math.PI,
    lng: (longitude * 180) / Math.PI,
    altitudeKm: altitude,
    altitudeRatio: Math.max(0.03, altitude / EARTH_RADIUS_KM),
    speedKmS,
    orbitalPeriodMinutes,
    orbitType,
    visibilityRadiusKm: groundVisibilityRadiusKm,
    ecef: { x: xEcef, y: yEcef, z: zEcef },
    eci: { x: xEci, y: yEci, z: zEci },
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

export function parseTleText(text, fallbackSetName = 'Импортированный набор') {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const satellites = []

  for (let index = 0; index < lines.length; ) {
    const current = lines[index]
    let name = `SAT-${satellites.length + 1}`
    let line1 = ''
    let line2 = ''

    if (current.startsWith('1 ')) {
      line1 = current
      line2 = lines[index + 1] ?? ''
      index += 2
    } else {
      name = current
      line1 = lines[index + 1] ?? ''
      line2 = lines[index + 2] ?? ''
      index += 3
    }

    if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) continue

    satellites.push({
      id: `${fallbackSetName}-${satellites.length}`,
      name,
      line1,
      line2,
      mission: 'Импорт TLE',
      operator: 'Пользовательский файл',
      country: 'Не указано',
    })
  }

  return satellites
}

function haversineDistanceKm(pointA, pointB) {
  const lat1 = (pointA.lat * Math.PI) / 180
  const lat2 = (pointB.lat * Math.PI) / 180
  const dLat = lat2 - lat1
  const dLng = ((pointB.lng - pointA.lng) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)))
}

export function estimateNextPass(satellite, observer, startDate, maxHoursAhead = 48) {
  const coarseStepMs = 2 * 60000
  const fineStepMs = 15000
  const maxDistancePaddingKm = 220
  const endTime = startDate.getTime() + maxHoursAhead * 3600000

  let coarseMatch = null

  for (let timestamp = startDate.getTime(); timestamp <= endTime; timestamp += coarseStepMs) {
    const sampleDate = new Date(timestamp)
    const position = propagateSatellite(satellite, sampleDate)
    const distanceKm = haversineDistanceKm(observer, position)

    if (distanceKm <= visibilityRadiusKm(position.altitudeKm, maxDistancePaddingKm)) {
      coarseMatch = { timestamp }
      break
    }
  }

  if (!coarseMatch) return null

  const fineWindowStart = Math.max(startDate.getTime(), coarseMatch.timestamp - coarseStepMs)

  for (
    let timestamp = fineWindowStart;
    timestamp <= coarseMatch.timestamp + coarseStepMs;
    timestamp += fineStepMs
  ) {
    const sampleDate = new Date(timestamp)
    const position = propagateSatellite(satellite, sampleDate)
    const distanceKm = haversineDistanceKm(observer, position)

    if (distanceKm <= visibilityRadiusKm(position.altitudeKm, maxDistancePaddingKm)) {
      return {
        time: sampleDate,
        distanceKm,
      }
    }
  }

  return {
    time: new Date(coarseMatch.timestamp),
    distanceKm: visibilityRadiusKm(propagateSatellite(satellite, new Date(coarseMatch.timestamp)).altitudeKm, maxDistancePaddingKm),
  }
}

export const DEFAULT_COLORS = ['#ff6b6b', '#4ecdc4', '#ffd166', '#7b8cff', '#9b5de5', '#00bbf9']

const ACTIVE_PAYLOAD_LIMIT = 200
const CULLABLE_NAME_PATTERNS = [/\bDEB\b/i, /\bR\/B\b/i, /\bOBJECT\b/i, /\bAKM\b/i]
const REMOTE_MISSION_RULES = [
  { mission: 'Пилотируемая станция', patterns: [/\bISS\b/i, /\bTIANGONG\b/i, /\bCSS\b/i] },
  { mission: 'Навигация', patterns: [/\bGPS\b/i, /\bGLONASS\b/i, /\bGALILEO\b/i, /\bBEIDOU\b/i, /\bQZS\b/i, /\bIRNSS\b/i, /\bNAVIC\b/i] },
  { mission: 'Погода', patterns: [/\bNOAA\b/i, /\bGOES\b/i, /\bMETEOR\b/i, /\bMETOP\b/i, /\bHIMAWARI\b/i, /\bFENGYUN\b/i, /\bJPSS\b/i, /\bGOMS\b/i] },
  { mission: 'Дистанционное зондирование', patterns: [/\bSENTINEL\b/i, /\bLANDSAT\b/i, /\bTERRA\b/i, /\bAQUA\b/i, /\bRESURS\b/i, /\bKANOPUS\b/i, /\bGAOFEN\b/i, /\bWORLDVIEW\b/i, /\bPLEIADES\b/i, /\bSKYSAT\b/i, /\bCARTOSAT\b/i, /\bKOMPSAT\b/i, /\bICEYE\b/i, /\bCAPELLA\b/i] },
  { mission: 'Научный', patterns: [/\bHUBBLE\b/i, /\bJWST\b/i, /\bIXPE\b/i, /\bTESS\b/i, /\bSWIFT\b/i, /\bFermi\b/i, /\bXMM\b/i, /\bCHANDRAYAAN\b/i] },
  { mission: 'Военный', patterns: [/\bNROL\b/i, /\bUSA\b/i, /\bAEHF\b/i, /\bSBIRS\b/i, /\bCOSMOS\b/i, /\bYAOGAN\b/i] },
  { mission: 'Связь', patterns: [/\bSTARLINK\b/i, /\bONEWEB\b/i, /\bIRIDIUM\b/i, /\bSES\b/i, /\bINTELSAT\b/i, /\bEUTELSAT\b/i, /\bINMARSAT\b/i, /\bVIASAT\b/i, /\bO3B\b/i, /\bGLOBALSTAR\b/i, /\bTDRS\b/i, /\bASTRA\b/i, /\bTELSTAR\b/i, /\bAMOS\b/i, /\bJCSAT\b/i, /\bEXPRESS\b/i, /\bMERIDIAN\b/i] },
]

export function inferRemoteMission(name, fallbackMission = 'Активные спутники') {
  const normalizedName = name.trim()

  for (const rule of REMOTE_MISSION_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(normalizedName))) {
      return rule.mission
    }
  }

  return fallbackMission
}

const BASE_TLE_SETS = [
  {
    id: 'featured',
    name: 'Популярные миссии',
    satellites: [
      {
        name: 'ISS (ZARYA)',
        color: '#ff6b6b',
        country: 'Международная',
        operator: 'NASA / Roscosmos',
        mission: 'Пилотируемая станция',
        line1: '1 25544U 98067A   26079.51782528  .00010580  00000+0  19412-3 0  9998',
        line2: '2 25544  51.6334 287.1253 0004235 188.8597 244.1967 15.49893145547103',
      },
      {
        name: 'HUBBLE',
        color: '#4ecdc4',
        country: 'США',
        operator: 'NASA / ESA',
        mission: 'Научный',
        line1: '1 20580U 90037B   26079.51606152  .00000831  00000+0  36032-4 0  9996',
        line2: '2 20580  28.4682 217.9334 0002141 315.5657  44.4935 15.25293767872488',
      },
      {
        name: 'NOAA 15',
        color: '#ffd166',
        country: 'США',
        operator: 'NOAA',
        mission: 'Погода',
        line1: '1 25338U 98030A   26079.48933830  .00000095  00000+0  74181-4 0  9997',
        line2: '2 25338  98.5313  62.4244 0010997 271.1088  88.8755 14.26414398444880',
      },
    ],
  },
  {
    id: 'navigation',
    name: 'Навигация и связь',
    satellites: [
      {
        name: 'GPS BIIR-2  (PRN 13)',
        color: '#7b8cff',
        country: 'США',
        operator: 'USSF',
        mission: 'Навигация',
        line1: '1 24876U 97035A   26079.49727914 -.00000037  00000+0  00000+0 0  9990',
        line2: '2 24876  54.1214 196.4742 0153000  53.0324 308.3820  2.00564938209602',
      },
      {
        name: 'GALAXY 30 (G-30)',
        color: '#9b5de5',
        country: 'США',
        operator: 'Intelsat',
        mission: 'Связь',
        line1: '1 46114U 20038A   26079.25631167 -.00000113  00000+0  00000+0 0  9999',
        line2: '2 46114   0.0205 338.0798 0001065 246.7950 245.1217  1.00270866 20965',
      },
      {
        name: 'GLONASS 134',
        color: '#00bbf9',
        country: 'Россия',
        operator: 'Роскосмос',
        mission: 'Навигация',
        line1: '1 57517U 23096A   26079.46816895  .00000020  00000+0  00000+0 0  9992',
        line2: '2 57517  64.7897 238.5244 0007030 270.1465  89.8105  2.13104394 21025',
      },
    ],
  },
  {
    id: 'earth-observation',
    name: 'ДЗЗ и мониторинг',
    satellites: [
      {
        name: 'TERRA',
        color: '#f15bb5',
        country: 'США',
        operator: 'NASA',
        mission: 'Дистанционное зондирование',
        line1: '1 25994U 99068A   26079.56229178  .00000153  00000+0  40464-4 0  9999',
        line2: '2 25994  98.2099 134.2159 0001171  91.9194 268.2154 14.57112009399566',
      },
      {
        name: 'Sentinel-2A',
        color: '#fee440',
        country: 'ЕС',
        operator: 'ESA',
        mission: 'Дистанционное зондирование',
        line1: '1 40697U 15028A   26079.53143606  .00000134  00000+0  56095-4 0  9994',
        line2: '2 40697  98.5694 143.7317 0001253  90.4489 269.6813 14.30815680559840',
      },
      {
        name: 'METOP-B',
        color: '#00f5d4',
        country: 'ЕС',
        operator: 'EUMETSAT',
        mission: 'Погода',
        line1: '1 38771U 12049A   26079.28449614  .00000130  00000+0  71839-4 0  9990',
        line2: '2 38771  98.6872 144.7582 0001180 100.9387 259.1934 14.21483733698367',
      },
    ],
  },
]

export const REMOTE_TLE_SETS = [
  {
    id: 'active-200',
    name: '200 активных спутников (CelesTrak, live)',
    sourceUrl: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle',
    limit: ACTIVE_PAYLOAD_LIMIT,
    country: 'Международная',
    operator: 'CelesTrak / актуальный каталог',
    mission: 'Активные спутники',
    description: `Автоматическая загрузка первых ${ACTIVE_PAYLOAD_LIMIT} активных спутников из официальной группы Active Satellites без debris/objects.`,
  },
]

export async function loadRemoteTleSet(remoteSet) {
  if (!remoteSet?.sourceUrl) {
    throw new Error('Для удалённого набора не указан sourceUrl.')
  }

  const response = await fetch(remoteSet.sourceUrl)

  if (!response.ok) {
    throw new Error(`Не удалось загрузить TLE: HTTP ${response.status}`)
  }

  const rawText = await response.text()
  const parsed = parseTleText(rawText, remoteSet.name)
    .filter((satellite) => !CULLABLE_NAME_PATTERNS.some((pattern) => pattern.test(satellite.name)))
    .slice(0, remoteSet.limit ?? ACTIVE_PAYLOAD_LIMIT)
    .map((satellite, index) => ({
      ...satellite,
      id: `${remoteSet.id}-${index + 1}`,
      country: remoteSet.country,
      operator: remoteSet.operator,
      mission: inferRemoteMission(satellite.name, remoteSet.mission),
    }))

  if (parsed.length === 0) {
    throw new Error('Удалённый источник не вернул подходящих активных спутников.')
  }

  return parsed
}

export const DEFAULT_TLE_SETS = [...BASE_TLE_SETS, ...REMOTE_TLE_SETS]

export const DEFAULT_TLES = DEFAULT_TLE_SETS[0].satellites
