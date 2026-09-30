import React, { useMemo, useState } from 'react'
import MonthNav from './MonthNav.jsx'
import { fmtDate, isWeekend, monthFromDate, monthKey, todayStr, utcIsoToLocalDate, weekdayShort } from '../utils/dates.js'
import { ATT_META, avg, fmtAvg, gradeCellClass, normSubject } from '../utils/grades.js'

const GENERAL = '__general__'

function Tile({ label, value, tone = 'text-gray-800' }) {
  return (
    <div className="bg-white rounded-xl shadow-card px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`text-xl font-bold mt-0.5 ${tone}`}>{value}</p>
    </div>
  )
}

export default function StudentGradeTable({ items, attendance }) {
  const grades = useMemo(
    () =>
      items.map((it) => {
        const subject = (it.subject || 'Без предмета').trim()
        return {
          subject,
          key: normSubject(subject),
          grade: it.grade,
          // оценки из журнала — «чистая» дата, за задания — время в UTC
          date: it.source === 'assignment' ? utcIsoToLocalDate(it.date) : String(it.date).slice(0, 10),
          label: it.label,
          comment: it.comment,
          source: it.source,
        }
      }),
    [items],
  )

  const marks = useMemo(
    () =>
      attendance
        .filter((a) => a.status === 'absent' || a.status === 'excused')
        .map((a) => ({
          key: a.subject ? normSubject(a.subject) : GENERAL,
          subject: (a.subject || '').trim(),
          date: String(a.date).slice(0, 10),
          status: a.status,
          note: a.note,
        })),
    [attendance],
  )

  const rows = useMemo(() => {
    const map = new Map()
    grades.forEach((g) => !map.has(g.key) && map.set(g.key, g.subject))
    marks.forEach((a) => a.key !== GENERAL && !map.has(a.key) && map.set(a.key, a.subject))
    const list = [...map.entries()]
      .map(([key, name]) => ({ key, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    if (marks.some((a) => a.key === GENERAL)) list.push({ key: GENERAL, name: 'Посещаемость (весь день)' })
    return list
  }, [grades, marks])

  const latestDate = useMemo(() => {
    const all = [...grades.map((g) => g.date), ...marks.map((a) => a.date)].sort()
    return all.length ? all[all.length - 1] : todayStr()
  }, [grades, marks])

  const [month, setMonth] = useState(() => monthFromDate(latestDate))
  const [selected, setSelected] = useState(null)
  const mKey = monthKey(month)

  const gradeMap = useMemo(() => {
    const m = new Map()
    grades.forEach((g) => {
      const id = `${g.key}|${g.date}`
      if (!m.has(id)) m.set(id, [])
      m.get(id).push(g)
    })
    return m
  }, [grades])

  const markMap = useMemo(() => {
    const m = new Map()
    marks.forEach((a) => m.set(`${a.key}|${a.date}`, a))
    return m
  }, [marks])

  const dates = useMemo(() => {
    const set = new Set()
    grades.forEach((g) => g.date.startsWith(mKey) && set.add(g.date))
    marks.forEach((a) => a.date.startsWith(mKey) && set.add(a.date))
    return [...set].sort()
  }, [grades, marks, mKey])

  const monthGrades = grades.filter((g) => g.date.startsWith(mKey)).map((g) => g.grade)
  const monthAbsent = marks.filter((a) => a.date.startsWith(mKey) && a.status === 'absent').length
  const today = todayStr()

  if (rows.length === 0) {
    return <p className="text-gray-400 text-sm italic">Оценок пока нет.</p>
  }

  const selRow = selected && rows.find((r) => r.key === selected.key)
  const selGrades = selected ? gradeMap.get(`${selected.key}|${selected.date}`) || [] : []
  const selMark = selected ? markMap.get(`${selected.key}|${selected.date}`) : null

  return (
    <div className="animate-fade-in">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <Tile label="Средний балл (месяц)" value={fmtAvg(avg(monthGrades))} tone="text-brand-700" />
        <Tile label="Оценок за месяц" value={monthGrades.length} />
        <Tile
          label="Пропусков"
          value={monthAbsent}
          tone={monthAbsent ? 'text-red-600' : 'text-gray-800'}
        />
        <Tile label="Средний балл (всего)" value={fmtAvg(avg(grades.map((g) => g.grade)))} />
      </div>

      <div className="mb-3">
        <MonthNav
          month={month}
          onChange={(m) => {
            setMonth(m)
            setSelected(null)
          }}
        />
      </div>

      {dates.length === 0 ? (
        <p className="text-gray-400 text-sm italic bg-white rounded-xl shadow-card px-4 py-6 text-center">
          В этом месяце записей нет — переключите месяц стрелками.
        </p>
      ) : (
        <div className="bg-white rounded-xl shadow-card overflow-auto isolate">
          <table className="min-w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50">
                <th className="sticky left-0 z-10 bg-gray-50 text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase border-b border-r border-gray-100 min-w-[9rem]">
                  Предмет
                </th>
                {dates.map((d) => (
                  <th
                    key={d}
                    className={`px-1.5 py-1.5 text-center border-b border-gray-100 min-w-[2.75rem] ${
                      d === today ? 'bg-brand-50 text-brand-700' : isWeekend(d) ? 'text-gray-400' : 'text-gray-700'
                    }`}
                  >
                    <div className="font-semibold leading-none">{d.slice(8)}</div>
                    <div className="text-[10px] uppercase text-gray-400 mt-0.5">{weekdayShort(d)}</div>
                  </th>
                ))}
                <th className="px-2 py-2 text-center text-[11px] font-semibold text-gray-500 uppercase border-b border-l border-gray-100">
                  Ср. мес.
                </th>
                <th className="px-2 py-2 text-center text-[11px] font-semibold text-gray-500 uppercase border-b border-gray-100">
                  Ср. всего
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const rowGrades = grades.filter((g) => g.key === r.key)
                const mAvg = avg(rowGrades.filter((g) => g.date.startsWith(mKey)).map((g) => g.grade))
                const allAvg = avg(rowGrades.map((g) => g.grade))
                return (
                  <tr key={r.key} className="group">
                    <td className="sticky left-0 z-10 bg-white group-hover:bg-gray-50 px-3 py-2 font-medium text-gray-800 border-b border-r border-gray-100">
                      {r.name}
                    </td>
                    {dates.map((d) => {
                      const gs = gradeMap.get(`${r.key}|${d}`) || []
                      const mk = markMap.get(`${r.key}|${d}`)
                      const has = gs.length > 0 || mk
                      const isSel = selected && selected.key === r.key && selected.date === d
                      return (
                        <td
                          key={d}
                          onClick={() => has && setSelected(isSel ? null : { key: r.key, date: d })}
                          className={`px-1 py-1.5 text-center border-b border-gray-100 group-hover:bg-gray-50 ${
                            has ? 'cursor-pointer' : ''
                          } ${isSel ? 'ring-2 ring-inset ring-brand-500' : ''} ${d === today ? 'bg-brand-50/40' : ''}`}
                        >
                          <div className="flex items-center justify-center gap-1 flex-wrap">
                            {gs.map((g, i) => (
                              <span
                                key={i}
                                className={`inline-flex min-w-[1.6rem] justify-center px-1.5 py-0.5 rounded-md text-xs font-bold ${gradeCellClass(g.grade)}`}
                              >
                                {g.grade}
                              </span>
                            ))}
                            {mk && ATT_META[mk.status] && (
                              <span className={`inline-flex px-1.5 py-0.5 rounded-md text-[11px] font-bold ${ATT_META[mk.status].cls}`}>
                                {ATT_META[mk.status].short}
                              </span>
                            )}
                          </div>
                        </td>
                      )
                    })}
                    <td className="px-2 py-2 text-center font-semibold text-gray-700 border-b border-l border-gray-100 group-hover:bg-gray-50">
                      {fmtAvg(mAvg)}
                    </td>
                    <td className="px-2 py-2 text-center text-gray-500 border-b border-gray-100 group-hover:bg-gray-50">
                      {fmtAvg(allAvg)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && (selGrades.length > 0 || selMark) && (
        <div className="mt-3 bg-white rounded-xl shadow-card p-4 text-sm animate-fade-in">
          <div className="flex justify-between items-start mb-2">
            <p className="font-semibold text-gray-800">
              {selRow?.name} · {fmtDate(selected.date)}
            </p>
            <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-xs">
              ✕
            </button>
          </div>
          <div className="flex flex-col gap-1.5">
            {selGrades.map((g, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className={`inline-flex min-w-[2rem] justify-center px-1.5 py-0.5 rounded-md text-xs font-bold ${gradeCellClass(g.grade)}`}>
                  {g.grade}/10
                </span>
                <div>
                  <p className="text-gray-700">
                    {g.source === 'assignment' ? '📝 За задание: ' : '📘 '}
                    {g.label}
                  </p>
                  {g.comment && g.comment !== g.label && <p className="text-xs text-gray-500 italic">{g.comment}</p>}
                </div>
              </div>
            ))}
            {selMark && (
              <p className="text-gray-600">
                <span className={`inline-flex px-1.5 py-0.5 rounded-md text-[11px] font-bold mr-2 ${ATT_META[selMark.status].cls}`}>
                  {ATT_META[selMark.status].short}
                </span>
                {ATT_META[selMark.status].label}
                {selMark.note && <span className="text-gray-400 italic"> — {selMark.note}</span>}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-gray-500">
        <span className="flex items-center gap-1"><i className="w-3 h-3 rounded bg-emerald-100 inline-block" /> 9–10</span>
        <span className="flex items-center gap-1"><i className="w-3 h-3 rounded bg-brand-100 inline-block" /> 7–8</span>
        <span className="flex items-center gap-1"><i className="w-3 h-3 rounded bg-amber-100 inline-block" /> 5–6</span>
        <span className="flex items-center gap-1"><i className="w-3 h-3 rounded bg-red-100 inline-block" /> 1–4</span>
        <span><b>н</b> — не был</span>
        <span><b>ув</b> — уважительная причина</span>
        <span>Нажмите на клетку, чтобы увидеть подробности</span>
      </div>
    </div>
  )
}
