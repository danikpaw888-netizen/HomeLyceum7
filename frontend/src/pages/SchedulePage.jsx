import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { useAuth } from '../context/AuthContext.jsx'
import { currentWeekType, isoWeekNumber } from '../utils/dates.js'

const DAYS = [
  { value: 1, label: 'Понедельник' },
  { value: 2, label: 'Вторник' },
  { value: 3, label: 'Среда' },
  { value: 4, label: 'Четверг' },
  { value: 5, label: 'Пятница' },
  { value: 6, label: 'Суббота' },
  { value: 7, label: 'Воскресенье' },
]

const WEEK_LABELS = {
  all: 'Каждую неделю',
  even: 'Чётная неделя',
  odd: 'Нечётная неделя',
}

const WEEK_BADGES = {
  all: 'bg-gray-100 text-gray-600',
  even: 'bg-blue-50 text-blue-700',
  odd: 'bg-violet-50 text-violet-700',
}

const emptyForm = {
  subject: '',
  teacher_id: '',
  day_of_week: 1,
  start_time: '08:30',
  end_time: '09:15',
  week_type: currentWeekType(),
  room: '',
  note: '',
}

export default function SchedulePage() {
  const { user } = useAuth()
  const isAdmin = user.role === 'admin'
  const weekNow = currentWeekType()
  const weekNumber = isoWeekNumber()

  const [classes, setClasses] = useState([])
  const [selectedClass, setSelectedClass] = useState(null)
  const [lessons, setLessons] = useState([])
  const [teachers, setTeachers] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [weekView, setWeekView] = useState(weekNow)

  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)

  useEffect(() => {
    const classesRequest = user.role === 'teacher' ? api.journalClasses() : api.listClasses()
    classesRequest
      .then((data) => {
        setClasses(data)
        if (data.length) setSelectedClass(data[0].id)
        else setLoading(false)
      })
      .catch((err) => {
        setError(err.message)
        setLoading(false)
      })
    if (isAdmin) {
      api.listUsers('teacher').then(setTeachers).catch(() => {})
    }
  }, [isAdmin, user.role])

  useEffect(() => {
    if (!selectedClass) return
    setLoading(true)
    api.classSchedule(selectedClass)
      .then(setLessons)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [selectedClass])

  function resetForm() {
    setForm({ ...emptyForm, week_type: weekView === 'all' ? weekNow : weekView })
    setEditingId(null)
    setFormOpen(false)
  }

  function startEdit(lesson) {
    setForm({
      subject: lesson.subject,
      teacher_id: lesson.teacher_id || '',
      day_of_week: lesson.day_of_week,
      start_time: lesson.start_time,
      end_time: lesson.end_time,
      week_type: lesson.week_type || 'all',
      room: lesson.room || '',
      note: lesson.note || '',
    })
    setEditingId(lesson.id)
    setFormOpen(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    const payload = {
      class_id: selectedClass,
      subject: form.subject.trim(),
      teacher_id: form.teacher_id ? Number(form.teacher_id) : null,
      day_of_week: Number(form.day_of_week),
      start_time: form.start_time,
      end_time: form.end_time,
      week_type: form.week_type,
      room: form.room.trim(),
      note: form.note.trim(),
    }
    try {
      if (editingId) {
        const updated = await api.updateLesson(editingId, payload)
        setLessons((prev) => prev.map((l) => (l.id === editingId ? updated : l)))
      } else {
        const created = await api.createLesson(payload)
        setLessons((prev) => [...prev, created])
      }
      resetForm()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleDelete(lessonId) {
    try {
      await api.deleteLesson(lessonId)
      setLessons((prev) => prev.filter((l) => l.id !== lessonId))
    } catch (err) {
      setError(err.message)
    }
  }

  function teacherName(id) {
    const t = teachers.find((t) => t.id === id)
    return t ? t.full_name : null
  }

  const visibleLessons = useMemo(() => {
    if (weekView === 'all') return lessons
    return lessons.filter((l) => !l.week_type || l.week_type === 'all' || l.week_type === weekView)
  }, [lessons, weekView])

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-5">
        <div>
          <p className="text-xs uppercase tracking-wider text-brand-600 font-semibold">Учебное расписание</p>
          <h1 className="text-2xl font-bold text-gray-800">🗓️ Расписание</h1>
          <p className="text-sm text-gray-500 mt-1">Сейчас неделя №{weekNumber} — <b>{weekNow === 'even' ? 'чётная' : 'нечётная'}</b>.</p>
        </div>
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
          {[['even', 'Чётная'], ['odd', 'Нечётная'], ['all', 'Обе']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setWeekView(key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${weekView === key ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="text-red-600 text-sm mb-3 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
      )}

      {classes.length === 0 ? (
        <p className="text-gray-500 text-sm">У вас пока нет доступных классов.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 mb-5">
            {classes.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedClass(c.id)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition active:scale-95 ${
                  selectedClass === c.id
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {c.name}
              </button>
            ))}
            {isAdmin && selectedClass && (
              <button
                onClick={() => {
                  if (formOpen) resetForm()
                  else { setForm({ ...emptyForm, week_type: weekView === 'all' ? weekNow : weekView }); setFormOpen(true) }
                }}
                className="ml-auto px-3 py-1.5 rounded-full text-sm font-medium bg-brand-50 text-brand-700 hover:bg-brand-100 transition active:scale-95"
              >
                {formOpen ? '✕ Закрыть форму' : '+ Добавить урок'}
              </button>
            )}
          </div>

          {isAdmin && formOpen && (
            <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-card p-4 mb-5 grid sm:grid-cols-2 gap-2 animate-scale-in">
              <input
                placeholder="Предмет"
                value={form.subject}
                onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                required
                className="field"
              />
              <select value={form.teacher_id} onChange={(e) => setForm((f) => ({ ...f, teacher_id: e.target.value }))} className="field">
                <option value="">Без учителя</option>
                {teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
              </select>
              <select value={form.day_of_week} onChange={(e) => setForm((f) => ({ ...f, day_of_week: e.target.value }))} className="field">
                {DAYS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
              <select
                value={form.week_type}
                onChange={(e) => setForm((f) => ({ ...f, week_type: e.target.value }))}
                className="field"
              >
                {Object.entries(WEEK_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
              <input type="time" value={form.start_time} onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))} required className="field" />
              <input type="time" value={form.end_time} onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))} required className="field" />
              <input placeholder="Кабинет" value={form.room} onChange={(e) => setForm((f) => ({ ...f, room: e.target.value }))} className="field" />
              <input placeholder="Заметка (необязательно)" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} className="field" />
              <button className="bg-brand-600 text-white px-4 py-2 rounded-md text-sm hover:bg-brand-700 active:scale-[0.98] transition sm:col-span-2 shadow-sm">
                {editingId ? 'Сохранить изменения' : 'Добавить урок'}
              </button>
            </form>
          )}

          <div className="bg-brand-50 border border-brand-100 rounded-xl px-4 py-3 mb-5 text-sm text-gray-700 flex flex-wrap items-center gap-x-5 gap-y-2">
            <span><b>Чётная</b> — можно задать отдельные уроки.</span>
            <span><b>Нечётная</b> — можно задать другой набор.</span>
            <span><b>Обе</b> — урок повторяется каждую неделю.</span>
          </div>

          {loading ? (
            <div className="skeleton animate-shimmer h-40 rounded-xl" />
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {DAYS.map((day) => {
                const dayLessons = visibleLessons
                  .filter((l) => l.day_of_week === day.value)
                  .sort((a, b) => a.start_time.localeCompare(b.start_time))
                return (
                  <div key={day.value} className="bg-white rounded-xl shadow-card p-4 animate-fade-in-up">
                    <h3 className="font-semibold text-gray-800 mb-2.5 text-sm">{day.label}</h3>
                    {dayLessons.length === 0 ? (
                      <p className="text-gray-400 text-xs italic">Уроков нет</p>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {dayLessons.map((l) => (
                          <div key={l.id} className="bg-brand-50 rounded-lg p-2.5 text-sm group relative">
                            <div className="flex justify-between items-start gap-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <p className="font-medium text-gray-800">{l.subject}</p>
                                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${WEEK_BADGES[l.week_type || 'all']}`}>
                                    {WEEK_LABELS[l.week_type || 'all']}
                                  </span>
                                </div>
                                <p className="text-xs text-gray-500">
                                  {l.start_time}–{l.end_time}
                                  {l.room && ` · каб. ${l.room}`}
                                </p>
                                {teacherName(l.teacher_id) && <p className="text-xs text-gray-500">{teacherName(l.teacher_id)}</p>}
                                {l.note && <p className="text-xs text-gray-500 mt-1 italic">💬 {l.note}</p>}
                              </div>
                              {isAdmin && (
                                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition shrink-0">
                                  <button onClick={() => startEdit(l)} className="text-xs text-brand-600 hover:text-brand-700" title="Редактировать">✏️</button>
                                  <button onClick={() => handleDelete(l.id)} className="text-xs text-red-500 hover:text-red-600" title="Удалить">🗑️</button>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
