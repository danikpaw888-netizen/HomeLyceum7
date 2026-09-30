export const MONTHS_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]
const WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

const pad = (n) => String(n).padStart(2, '0')

// Даты — всегда строки 'YYYY-MM-DD' по ЛОКАЛЬНОМУ времени (без сдвигов из-за UTC)
export function toISODate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function todayStr() {
  return toISODate(new Date())
}

export function parseISODate(s) {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function monthKey({ y, m }) {
  return `${y}-${pad(m + 1)}`
}

export function monthFromDate(dateStr) {
  return { y: Number(dateStr.slice(0, 4)), m: Number(dateStr.slice(5, 7)) - 1 }
}

export function shiftMonth({ y, m }, delta) {
  const d = new Date(y, m + delta, 1)
  return { y: d.getFullYear(), m: d.getMonth() }
}

export function daysOfMonth({ y, m }) {
  const count = new Date(y, m + 1, 0).getDate()
  return Array.from({ length: count }, (_, i) => `${y}-${pad(m + 1)}-${pad(i + 1)}`)
}

// 1 = Пн ... 7 = Вс (как в расписании)
export function isoDow(dateStr) {
  const d = parseISODate(dateStr).getDay()
  return d === 0 ? 7 : d
}

export function weekdayShort(dateStr) {
  return WEEKDAYS_SHORT[parseISODate(dateStr).getDay()]
}

export function isWeekend(dateStr) {
  const d = parseISODate(dateStr).getDay()
  return d === 0 || d === 6
}

export function fmtDate(dateStr) {
  return `${dateStr.slice(8, 10)}.${dateStr.slice(5, 7)}.${dateStr.slice(0, 4)}`
}

// Сервер отдаёт время без пояснения зоны — это UTC. Переводим в локальную дату.
export function utcIsoToLocalDate(iso) {
  const hasZone = /Z$|[+-]\d\d:\d\d$/.test(iso)
  return toISODate(new Date(hasZone ? iso : `${iso}Z`))
}


// ISO-неделя: используется для автоматического определения чётной/нечётной недели.
export function isoWeekNumber(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
}

export function currentWeekType(date = new Date()) {
  return isoWeekNumber(date) % 2 === 0 ? 'even' : 'odd'
}

export function weekTypeForDate(dateStr) {
  return currentWeekType(parseISODate(dateStr))
}
