export function gradeColor(grade) {
  if (grade >= 9) return 'text-emerald-700 bg-emerald-50 border-emerald-200'
  if (grade >= 7) return 'text-brand-700 bg-brand-50 border-brand-200'
  if (grade >= 5) return 'text-amber-700 bg-amber-50 border-amber-200'
  return 'text-red-700 bg-red-50 border-red-200'
}

// Более насыщенный цвет для оценок внутри клеток таблицы
export function gradeCellClass(grade) {
  if (grade >= 9) return 'bg-emerald-100 text-emerald-800'
  if (grade >= 7) return 'bg-brand-100 text-brand-700'
  if (grade >= 5) return 'bg-amber-100 text-amber-800'
  return 'bg-red-100 text-red-700'
}

export const ATT_META = {
  absent: { short: 'н', label: 'Не был', cls: 'bg-red-100 text-red-700' },
  excused: { short: 'ув', label: 'Уважительная причина', cls: 'bg-sky-100 text-sky-700' },
}

export const normSubject = (s) => (s || '').trim().toLowerCase()

export function avg(nums) {
  if (!nums.length) return null
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

export function fmtAvg(x) {
  return x == null ? '—' : x.toFixed(1)
}
