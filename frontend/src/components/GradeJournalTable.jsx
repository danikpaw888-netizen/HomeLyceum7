import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.js'
import MonthNav from './MonthNav.jsx'
import { daysOfMonth, fmtDate, isoDow, isWeekend, monthFromDate, monthKey, todayStr, weekdayShort, weekTypeForDate } from '../utils/dates.js'
import { ATT_META, avg, fmtAvg, gradeCellClass, gradeColor, normSubject } from '../utils/grades.js'

const POP_W = 288
const POP_H = 370

export default function GradeJournalTable({ classId, classInfo, students, lessons, user, onChanged }) {
  const isAdmin = user.role === 'admin'
  const unrestricted = isAdmin || (classInfo && classInfo.teacher_id === user.id)

  const [subjectKey, setSubjectKey] = useState(null)
  const [customSubjects, setCustomSubjects] = useState([])
  const [newSubject, setNewSubject] = useState('')
  const [month, setMonth] = useState(() => monthFromDate(todayStr()))
  const [extraDates, setExtraDates] = useState({})
  const [newDate, setNewDate] = useState(todayStr())
  const [editor, setEditor] = useState(null)
  const [addMode, setAddMode] = useState(false)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const popRef = useRef(null)

  const sortedStudents = useMemo(
    () => [...students].sort((a, b) => a.full_name.localeCompare(b.full_name, 'ru')),
    [students],
  )

  // Предметы: сначала «мои» (из расписания и те, что я уже ставил), затем остальные
  const subjectOptions = useMemo(() => {
    const mine = new Map()
    const others = new Map()
    const add = (map, name) => {
      const key = normSubject(name)
      if (key && !mine.has(key) && !map.has(key)) map.set(key, name.trim())
    }
    lessons.filter((l) => l.teacher_id === user.id).forEach((l) => add(mine, l.subject))
    if (unrestricted) {
      students.forEach((s) => s.grades.forEach((g) => g.teacher_id === user.id && add(mine, g.subject)))
      lessons.forEach((l) => add(others, l.subject))
      students.forEach((s) => {
        s.grades.forEach((g) => add(others, g.subject))
        s.attendance.forEach((a) => add(others, a.subject))
      })
      customSubjects.forEach((n) => add(others, n))
    }
    const rest = [...others.entries()].sort((a, b) => a[1].localeCompare(b[1], 'ru'))
    return [...mine.entries(), ...rest].map(([key, name]) => ({ key, name }))
  }, [lessons, students, customSubjects, unrestricted, user.id])

  const active = subjectOptions.find((o) => o.key === subjectKey) || subjectOptions[0] || null
  const k = active ? active.key : null
  const mKey = monthKey(month)
  const today = todayStr()

  const matchesSubject = (subject) => normSubject(subject) === k

  const dates = useMemo(() => {
    if (!active) return []
    const set = new Set()
    students.forEach((s) => {
      s.grades.forEach((g) => matchesSubject(g.subject) && g.date.startsWith(mKey) && set.add(g.date))
      s.attendance.forEach(
        (a) =>
          a.status !== 'present' &&
          (matchesSubject(a.subject) || !a.subject) &&
          a.date.startsWith(mKey) &&
          set.add(a.date),
      )
    })
    // даты уроков по расписанию
    const scheduled = lessons.filter((l) => normSubject(l.subject) === k && (unrestricted || l.teacher_id === user.id))
    if (scheduled.length) {
      daysOfMonth(month).forEach((d) => {
        const parity = weekTypeForDate(d)
        const applies = scheduled.some((l) =>
          l.day_of_week === isoDow(d) && (!l.week_type || l.week_type === 'all' || l.week_type === parity)
        )
        if (applies) set.add(d)
      })
    }
    ;(extraDates[k] || []).forEach((d) => d.startsWith(mKey) && set.add(d))
    return [...set].sort()
  }, [students, lessons, extraDates, k, mKey, unrestricted, user.id])

  function cell(student, date) {
    const gs = student.grades.filter((g) => matchesSubject(g.subject) && g.date === date)
    const specific = student.attendance.find((a) => matchesSubject(a.subject) && a.date === date) || null
    const general = student.attendance.find((a) => !a.subject && a.date === date) || null
    const att = specific || general
    return { gs, att: att && att.status !== 'present' ? att : null, specific }
  }

  function stats(student) {
    const sg = student.grades.filter((g) => matchesSubject(g.subject))
    const abs = student.attendance.filter(
      (a) => a.status === 'absent' && (matchesSubject(a.subject) || !a.subject) && a.date.startsWith(mKey),
    ).length
    return {
      month: avg(sg.filter((g) => g.date.startsWith(mKey)).map((g) => g.grade)),
      all: avg(sg.map((g) => g.grade)),
      abs,
    }
  }

  const allSubjectGrades = students.flatMap((s) => s.grades.filter((g) => matchesSubject(g.subject)))
  const colAvg = (d) => avg(allSubjectGrades.filter((g) => g.date === d).map((g) => g.grade))

  function addDate(ds) {
    if (!ds || !active) return
    setExtraDates((prev) => ({ ...prev, [k]: [...new Set([...(prev[k] || []), ds])] }))
    setMonth(monthFromDate(ds))
  }

  function addSubject(e) {
    e.preventDefault()
    const name = newSubject.trim()
    if (!name) return
    setCustomSubjects((prev) => [...prev, name])
    setSubjectKey(normSubject(name))
    setNewSubject('')
  }

  // ---------- окно редактирования клетки ----------
  function openEditor(e, student, date) {
    const rect = e.currentTarget.getBoundingClientRect()
    const w = Math.min(POP_W, window.innerWidth - 16)
    let left = rect.left + rect.width / 2 - w / 2
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8))
    let top = rect.bottom + 6
    if (top + POP_H > window.innerHeight - 8) top = rect.top - POP_H - 6
    top = Math.max(8, Math.min(top, window.innerHeight - POP_H - 8))
    setAddMode(false)
    setComment('')
    setError('')
    setEditor({ studentId: student.id, date, top, left, w })
  }

  useEffect(() => {
    if (!editor) return
    const close = () => setEditor(null)
    const onKey = (e) => e.key === 'Escape' && close()
    const onScroll = (e) => {
      if (popRef.current && popRef.current.contains(e.target)) return
      close()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
    }
  }, [editor])

  const edStudent = editor ? students.find((s) => s.id === editor.studentId) : null
  const edCell = edStudent ? cell(edStudent, editor.date) : null

  async function run(fn) {
    setBusy(true)
    setError('')
    try {
      await fn()
      await onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  function setGrade(n) {
    const { gs } = edCell
    return run(async () => {
      if (gs.length === 1 && !addMode) {
        await api.updateGrade(gs[0].id, { grade: n, comment: comment || null })
      } else {
        await api.addGrade({
          student_id: edStudent.id,
          class_id: classId,
          subject: active.name,
          grade: n,
          date: editor.date,
          comment,
        })
      }
      setEditor(null)
    })
  }

  function removeGrade(id) {
    return run(() => api.deleteGrade(id))
  }

  function setAttendance(status) {
    return run(async () => {
      await api.markAttendance({
        student_id: edStudent.id,
        class_id: classId,
        subject: active.name,
        date: editor.date,
        status,
        note: '',
      })
      setEditor(null)
    })
  }

  // ---------- экспорт в CSV (открывается в Excel) ----------
  function exportCsv() {
    const header = ['Ученик', ...dates.map(fmtDate), 'Н', 'Ср. мес.', 'Ср. всего']
    const rows = sortedStudents.map((s) => {
      const st = stats(s)
      return [
        s.full_name,
        ...dates.map((d) => {
          const c = cell(s, d)
          const parts = c.gs.map((g) => g.grade)
          if (c.att && ATT_META[c.att.status]) parts.push(ATT_META[c.att.status].short)
          return parts.join(' ')
        }),
        st.abs,
        fmtAvg(st.month),
        fmtAvg(st.all),
      ]
    })
    const csv = [header, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';'))
      .join('\r\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `journal_${classInfo ? classInfo.name : classId}_${active.name}_${mKey}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ---------- отрисовка ----------
  return (
    <div className="animate-fade-in">
      {/* Предметы */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {subjectOptions.map((o) => (
          <button
            key={o.key}
            onClick={() => setSubjectKey(o.key)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition active:scale-95 ${
              active && active.key === o.key
                ? 'bg-brand-600 text-white shadow-sm'
                : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
            }`}
          >
            {o.name}
          </button>
        ))}
        {unrestricted && (
          <form onSubmit={addSubject} className="flex items-center gap-1.5">
            <input
              value={newSubject}
              onChange={(e) => setNewSubject(e.target.value)}
              placeholder="+ Новый предмет"
              className="border border-dashed border-gray-300 rounded-full px-3 py-1.5 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition"
            />
            {newSubject.trim() && (
              <button className="text-sm bg-brand-50 text-brand-700 px-3 py-1.5 rounded-full hover:bg-brand-100 transition">
                Добавить
              </button>
            )}
          </form>
        )}
      </div>

      {!unrestricted && (
        <p className="text-xs text-gray-500 mb-3 bg-brand-50 border border-brand-100 rounded-lg px-3 py-2">
          Вы ведёте в этом классе только свои предметы — оценки можно ставить именно по ним.
        </p>
      )}

      {!active ? (
        <p className="text-gray-500 text-sm bg-white rounded-xl shadow-card px-4 py-6">
          {unrestricted
            ? 'Введите название предмета выше — и появится таблица оценок.'
            : 'Вас пока не назначили на уроки в этом классе. Попросите администратора добавить вас в расписание.'}
        </p>
      ) : students.length === 0 ? (
        <p className="text-gray-500 text-sm bg-white rounded-xl shadow-card px-4 py-6">
          В этом классе пока нет учеников — добавьте их в кабинете.
        </p>
      ) : (
        <>
          {/* Панель: месяц, даты, экспорт */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <MonthNav month={month} onChange={setMonth} />
            <div className="flex items-center gap-1.5 ml-auto flex-wrap">
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="border border-gray-200 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 transition"
              />
              <button
                onClick={() => addDate(newDate)}
                className="text-sm bg-brand-600 text-white px-3 py-1.5 rounded-md hover:bg-brand-700 active:scale-95 transition"
              >
                + Дата
              </button>
              <button
                onClick={() => addDate(todayStr())}
                className="text-sm bg-white border border-gray-200 text-gray-700 px-3 py-1.5 rounded-md hover:bg-gray-50 active:scale-95 transition"
              >
                Сегодня
              </button>
              <button
                onClick={exportCsv}
                disabled={dates.length === 0}
                className="text-sm bg-white border border-gray-200 text-gray-700 px-3 py-1.5 rounded-md hover:bg-gray-50 active:scale-95 transition disabled:opacity-50"
                title="Скачать таблицу для Excel"
              >
                ⬇ CSV
              </button>
            </div>
          </div>

          {dates.length === 0 ? (
            <p className="text-gray-500 text-sm bg-white rounded-xl shadow-card px-4 py-6 text-center">
              В этом месяце по предмету «{active.name}» ещё нет столбцов с датами. Нажмите «Сегодня» или выберите
              дату и нажмите «+ Дата».
            </p>
          ) : (
            <div className="bg-white rounded-xl shadow-card overflow-auto max-h-[70vh] isolate">
              <table className="min-w-full text-sm border-collapse">
                <thead>
                  <tr>
                    <th className="sticky top-0 left-0 z-30 bg-gray-50 text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase border-b border-r border-gray-100 min-w-[11rem]">
                      Ученик
                    </th>
                    {dates.map((d) => (
                      <th
                        key={d}
                        className={`sticky top-0 z-20 px-1.5 py-1.5 text-center border-b border-gray-100 min-w-[2.9rem] ${
                          d === today
                            ? 'bg-brand-50 text-brand-700'
                            : isWeekend(d)
                              ? 'bg-gray-50 text-gray-400'
                              : 'bg-gray-50 text-gray-700'
                        }`}
                      >
                        <div className="font-semibold leading-none">{d.slice(8)}</div>
                        <div className="text-[10px] uppercase text-gray-400 mt-0.5">{weekdayShort(d)}</div>
                      </th>
                    ))}
                    <th className="sticky top-0 z-20 bg-gray-50 px-2 py-2 text-center text-[11px] font-semibold text-gray-500 uppercase border-b border-l border-gray-100">
                      Н
                    </th>
                    <th className="sticky top-0 z-20 bg-gray-50 px-2 py-2 text-center text-[11px] font-semibold text-gray-500 uppercase border-b border-gray-100">
                      Ср. мес.
                    </th>
                    <th className="sticky top-0 z-20 bg-gray-50 px-2 py-2 text-center text-[11px] font-semibold text-gray-500 uppercase border-b border-gray-100">
                      Ср. всего
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedStudents.map((s, idx) => {
                    const st = stats(s)
                    return (
                      <tr key={s.id} className="group">
                        <td className="sticky left-0 z-10 bg-white group-hover:bg-gray-50 px-3 py-1.5 border-b border-r border-gray-100 max-w-[14rem]">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-gray-400 w-4 text-right shrink-0">{idx + 1}</span>
                            <span className="truncate font-medium text-gray-800" title={s.full_name}>
                              {s.full_name}
                            </span>
                            {s.on_homeschool && <span title="На домашнем обучении">🏠</span>}
                          </div>
                        </td>
                        {dates.map((d) => {
                          const c = cell(s, d)
                          const isOpen = editor && editor.studentId === s.id && editor.date === d
                          return (
                            <td
                              key={d}
                              onClick={(e) => openEditor(e, s, d)}
                              className={`px-1 py-1 text-center border-b border-gray-100 cursor-pointer hover:bg-brand-50 ${
                                isOpen ? 'bg-brand-50 ring-2 ring-inset ring-brand-500' : d === today ? 'bg-brand-50/40' : ''
                              }`}
                            >
                              <div className="min-h-[1.9rem] flex items-center justify-center gap-1 flex-wrap">
                                {c.gs.map((g) => (
                                  <span
                                    key={g.id}
                                    className={`inline-flex min-w-[1.6rem] justify-center px-1.5 py-0.5 rounded-md text-xs font-bold ${gradeCellClass(g.grade)}`}
                                  >
                                    {g.grade}
                                  </span>
                                ))}
                                {c.att && ATT_META[c.att.status] && (
                                  <span className={`inline-flex px-1.5 py-0.5 rounded-md text-[11px] font-bold ${ATT_META[c.att.status].cls}`}>
                                    {ATT_META[c.att.status].short}
                                  </span>
                                )}
                              </div>
                            </td>
                          )
                        })}
                        <td className={`px-2 py-1.5 text-center border-b border-l border-gray-100 group-hover:bg-gray-50 ${st.abs ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>
                          {st.abs || '—'}
                        </td>
                        <td className="px-2 py-1.5 text-center font-semibold text-gray-700 border-b border-gray-100 group-hover:bg-gray-50">
                          {fmtAvg(st.month)}
                        </td>
                        <td className="px-2 py-1.5 text-center text-gray-500 border-b border-gray-100 group-hover:bg-gray-50">
                          {fmtAvg(st.all)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50">
                    <td className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-500 uppercase border-r border-gray-100">
                      Средний по классу
                    </td>
                    {dates.map((d) => (
                      <td key={d} className="px-1 py-2 text-center text-xs text-gray-500">
                        {fmtAvg(colAvg(d))}
                      </td>
                    ))}
                    <td className="border-l border-gray-100" />
                    <td className="px-2 py-2 text-center text-xs font-semibold text-gray-600">
                      {fmtAvg(avg(allSubjectGrades.filter((g) => g.date.startsWith(mKey)).map((g) => g.grade)))}
                    </td>
                    <td className="px-2 py-2 text-center text-xs text-gray-500">
                      {fmtAvg(avg(allSubjectGrades.map((g) => g.grade)))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-gray-500">
            <span>Нажмите на клетку — поставить оценку или отметить посещаемость</span>
            <span><b>н</b> — не был</span>
                <span><b>ув</b> — уважительная</span>
            <span>Столбцы дат добавляются автоматически по расписанию</span>
          </div>
        </>
      )}

      {/* Окно редактирования */}
      {editor && edStudent && edCell && active && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setEditor(null)} />
          <div
            ref={popRef}
            style={{ top: editor.top, left: editor.left, width: editor.w, maxHeight: window.innerHeight - 16 }}
            className="fixed z-50 bg-white rounded-xl shadow-2xl border border-gray-100 p-3 overflow-y-auto animate-scale-in"
          >
            <div className="flex items-start justify-between mb-2.5">
              <div>
                <p className="text-sm font-semibold text-gray-800 leading-tight">{edStudent.full_name}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {active.name} · {fmtDate(editor.date)}
                </p>
              </div>
              <button onClick={() => setEditor(null)} className="text-gray-400 hover:text-gray-600 text-sm px-1">
                ✕
              </button>
            </div>

            {edCell.gs.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2.5">
                {edCell.gs.map((g) => (
                  <span
                    key={g.id}
                    className={`inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-0.5 rounded-full text-sm font-bold ${gradeCellClass(g.grade)}`}
                  >
                    {g.grade}
                    <button
                      disabled={busy}
                      onClick={() => removeGrade(g.id)}
                      className="text-xs opacity-60 hover:opacity-100"
                      title="Удалить оценку"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}

            <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">
              {edCell.gs.length === 1 && !addMode ? 'Изменить оценку' : 'Поставить оценку'}
            </p>
            <div className="grid grid-cols-5 gap-1.5 mb-1.5">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <button
                  key={n}
                  disabled={busy}
                  onClick={() => setGrade(n)}
                  className={`py-1.5 rounded-md text-sm font-bold border hover:brightness-95 active:scale-95 transition disabled:opacity-50 ${gradeColor(n)}`}
                >
                  {n}
                </button>
              ))}
            </div>
            {edCell.gs.length === 1 && !addMode && (
              <button onClick={() => setAddMode(true)} className="text-xs text-brand-600 hover:underline mb-1.5">
                + добавить ещё одну оценку за этот день
              </button>
            )}
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Комментарий (необязательно)"
              className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs mt-1 focus:outline-none focus:ring-2 focus:ring-brand-500 transition"
            />

            <p className="text-[11px] uppercase tracking-wide text-gray-400 mt-3 mb-1">Посещаемость</p>
            <div className="grid grid-cols-3 gap-1.5">
              {[
                ['absent', 'н', 'Не был'],
                ['excused', 'ув', 'Уважительная причина'],
                ['present', '✓', 'Был — снять отметку'],
              ].map(([status, label, title]) => {
                const current = edCell.specific && edCell.specific.status === status
                const meta = ATT_META[status]
                return (
                  <button
                    key={status}
                    disabled={busy}
                    title={title}
                    onClick={() => setAttendance(status)}
                    className={`py-1.5 rounded-md text-sm font-bold border transition active:scale-95 disabled:opacity-50 ${
                      meta ? `${meta.cls} border-transparent` : 'bg-gray-50 text-gray-600 border-gray-200'
                    } ${current ? 'ring-2 ring-brand-500' : ''}`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            {!edCell.specific && edCell.att && (
              <p className="text-[11px] text-gray-400 mt-1.5">
                Сейчас действует отметка «{ATT_META[edCell.att.status]?.label}» за весь день.
              </p>
            )}
            {error && <p className="text-red-600 text-xs mt-2 bg-red-50 rounded-md px-2 py-1">{error}</p>}
          </div>
        </>
      )}
    </div>
  )
}
