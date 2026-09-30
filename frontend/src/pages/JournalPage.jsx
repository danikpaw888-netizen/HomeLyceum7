import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.js'
import { useAuth } from '../context/AuthContext.jsx'
import StudentGradesView from '../components/StudentGradesView.jsx'
import GradeJournalTable from '../components/GradeJournalTable.jsx'
import { gradeColor } from '../utils/grades.js'
import { todayStr } from '../utils/dates.js'

const ATTENDANCE_LABELS = {
  present: { label: 'Был', icon: '✅', className: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  absent: { label: 'Отсутствовал', icon: '❌', className: 'text-red-700 bg-red-50 border-red-200' },
  excused: { label: 'Уважительная причина', icon: '📄', className: 'text-brand-700 bg-brand-50 border-brand-200' },
}

const HOMESCHOOL_DOC_TYPES = [
  ['order', 'Приказ о переводе'],
  ['medical', 'Медицинская справка / заключение'],
  ['parent_letter', 'Заявление / письмо родителя'],
  ['plan', 'Индивидуальный учебный план'],
  ['consent', 'Согласие / заявление'],
  ['other', 'Другой документ'],
]

export default function JournalPage() {
  const { user } = useAuth()
  if (user.role === 'parent') return <ParentJournal />
  return <TeacherAdminJournal />
}

function ParentJournal() {
  const [children, setChildren] = useState([])
  const [selectedChild, setSelectedChild] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.myChildren()
      .then((data) => {
        setChildren(data)
        if (data.length) setSelectedChild(data[0].id)
      })
      .catch((err) => setError(err.message))
  }, [])

  return (
    <div className="p-6 max-w-5xl mx-auto animate-fade-in">
      <h1 className="text-2xl font-bold mb-6 text-gray-800">📘 Журнал оценок</h1>
      {error && (
        <p className="text-red-600 text-sm mb-3 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
      )}

      {children.length === 0 ? (
        <p className="text-gray-500 text-sm">
          Пока ни один ребёнок не привязан к вашему аккаунту — обратитесь к администратору школы.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 mb-5">
            {children.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedChild(c.id)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition active:scale-95 ${
                  selectedChild === c.id
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {c.full_name}
              </button>
            ))}
          </div>

          <StudentGradesView studentId={selectedChild} />
        </>
      )}
    </div>
  )
}

function TeacherAdminJournal() {
  const { user } = useAuth()
  const isAdmin = user.role === 'admin'

  const [classes, setClasses] = useState([])
  const [selectedClass, setSelectedClass] = useState(null)
  const [roster, setRoster] = useState(null)
  const [lessons, setLessons] = useState([])
  const [view, setView] = useState('table')
  const [expandedStudent, setExpandedStudent] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const latestClass = useRef(null)

  useEffect(() => {
    api.journalClasses()
      .then((data) => {
        setClasses(data)
        if (data.length) setSelectedClass(data[0].id)
        else setLoading(false)
      })
      .catch((err) => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  // silent = true — обновить данные «тихо», без мигания скелетона (после правки клетки)
  function loadRoster(classId, silent = false) {
    if (!silent) setLoading(true)
    return api.classRoster(classId)
      .then((r) => latestClass.current === classId && setRoster(r))
      .catch((err) => setError(err.message))
      .finally(() => {
        if (!silent) setLoading(false)
      })
  }

  useEffect(() => {
    if (!selectedClass) return
    latestClass.current = selectedClass
    setError('')
    setRoster(null)
    setLessons([])
    loadRoster(selectedClass)
    api.classSchedule(selectedClass)
      .then((l) => latestClass.current === selectedClass && setLessons(l))
      .catch(() => setLessons([]))
  }, [selectedClass])

  const classInfo = classes.find((c) => c.id === selectedClass)

  return (
    <div className={`p-6 mx-auto animate-fade-in ${view === 'table' ? 'max-w-6xl' : 'max-w-4xl'}`}>
      <h1 className="text-2xl font-bold mb-6 text-gray-800">📘 Журнал класса</h1>
      {error && (
        <p className="text-red-600 text-sm mb-3 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
      )}

      {classes.length === 0 ? (
        <p className="text-gray-500 text-sm">
          {isAdmin
            ? 'В системе пока нет классов.'
            : 'У вас пока нет классов — создайте класс в кабинете учителя или попросите администратора назначить вас на класс в расписании.'}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 mb-4">
            {classes.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setSelectedClass(c.id)
                  setExpandedStudent(null)
                }}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition active:scale-95 ${
                  selectedClass === c.id
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>

          <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
            {[
              ['table', '📊 Таблица оценок'],
              ['students', '👥 Ученики'],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setView(key)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                  view === key ? 'bg-white shadow-sm text-brand-700' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {loading && <div className="skeleton animate-shimmer h-40 rounded-xl" />}

          {!loading && roster && view === 'table' && (
            <GradeJournalTable
              key={selectedClass}
              classId={selectedClass}
              classInfo={classInfo}
              students={roster.students}
              lessons={lessons}
              user={user}
              onChanged={() => loadRoster(selectedClass, true)}
            />
          )}

          {!loading && roster && view === 'students' && roster.students.length === 0 && (
            <p className="text-gray-500 text-sm">В этом классе пока нет учеников.</p>
          )}

          {!loading && roster && view === 'students' && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-gray-500">
                Здесь — посещаемость и домашнее обучение по каждому ученику. Оценки удобнее ставить во вкладке
                «Таблица оценок».
              </p>
              {roster.students.map((s) => (
                <div key={s.id} className="bg-white rounded-xl shadow-card animate-fade-in-up overflow-hidden">
                  <button
                    onClick={() => setExpandedStudent(expandedStudent === s.id ? null : s.id)}
                    className="w-full flex justify-between items-center p-4 text-left hover:bg-gray-50 transition"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-sm font-bold">
                        {s.full_name.charAt(0)}
                      </span>
                      <div>
                        <p className="font-medium text-gray-800">{s.full_name}</p>
                        <p className="text-xs text-gray-500">{s.email}</p>
                      </div>
                      {s.on_homeschool && (
                        <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full ml-1">
                          🏠 На домашнем обучении
                        </span>
                      )}
                    </div>
                    <span className="text-gray-400 text-sm">{expandedStudent === s.id ? '▲' : '▼'}</span>
                  </button>

                  {expandedStudent === s.id && (
                    <StudentPanel
                      student={s}
                      classId={selectedClass}
                      isAdmin={isAdmin}
                      onChanged={() => loadRoster(selectedClass, true)}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function StudentPanel({ student, classId, isAdmin, onChanged }) {
  const [tab, setTab] = useState('grades')

  return (
    <div className="border-t border-gray-100 p-4 animate-fade-in">
      <div className="flex gap-1 mb-4 bg-gray-50 rounded-lg p-1 w-fit">
        {[
          ['grades', '📝 Оценки'],
          ['attendance', '📋 Посещаемость'],
          ['homeschool', '🏠 Домашнее обучение'],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
              tab === key ? 'bg-white shadow-sm text-brand-700' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'grades' && <GradesTab student={student} classId={classId} onChanged={onChanged} />}
      {tab === 'attendance' && <AttendanceTab student={student} classId={classId} onChanged={onChanged} />}
      {tab === 'homeschool' && <HomeschoolTab student={student} isAdmin={isAdmin} onHomeschoolChanged={onChanged} />}
    </div>
  )
}

function GradesTab({ student, classId, onChanged }) {
  const [subject, setSubject] = useState('')
  const [grade, setGrade] = useState('')
  const [date, setDate] = useState(todayStr())
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [docFiles, setDocFiles] = useState({})

  const subjectAverages = useMemo(() => {
    const map = {}
    for (const g of student.grades) {
      if (!map[g.subject]) map[g.subject] = []
      map[g.subject].push(g.grade)
    }
    return Object.entries(map)
      .map(([subj, grades]) => ({
        subject: subj,
        avg: (grades.reduce((a, b) => a + b, 0) / grades.length).toFixed(1),
        count: grades.length,
      }))
      .sort((a, b) => a.subject.localeCompare(b.subject))
  }, [student.grades])

  async function handleAdd(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await api.addGrade({
        student_id: student.id,
        class_id: classId,
        subject,
        grade: Number(grade),
        date,
        comment,
      })
      setSubject('')
      setGrade('')
      setComment('')
      onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(gradeId) {
    try {
      await api.deleteGrade(gradeId)
      onChanged()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div>
      <form onSubmit={handleAdd} className="grid sm:grid-cols-5 gap-2 mb-4">
        <input
          placeholder="Предмет"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          required
          className="border border-gray-200 rounded-md px-2 py-1.5 text-sm sm:col-span-2 focus:outline-none focus:ring-2 focus:ring-brand-500 transition"
        />
        <select
          value={grade}
          onChange={(e) => setGrade(e.target.value)}
          required
          className="border border-gray-200 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 transition"
        >
          <option value="">Оценка</option>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="border border-gray-200 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 transition"
        />
        <button
          disabled={busy}
          className="bg-brand-600 text-white rounded-md text-sm px-3 py-1.5 hover:bg-brand-700 active:scale-95 transition disabled:opacity-60"
        >
          + Оценка
        </button>
        <input
          placeholder="Комментарий (необязательно)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          className="border border-gray-200 rounded-md px-2 py-1.5 text-sm sm:col-span-5 focus:outline-none focus:ring-2 focus:ring-brand-500 transition"
        />
      </form>
      {error && <p className="text-red-600 text-xs mb-2">{error}</p>}

      {subjectAverages.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1.5">📊 Успеваемость по предметам</h4>
          <div className="flex flex-wrap gap-2">
            {subjectAverages.map((s) => (
              <div key={s.subject} className={`rounded-lg px-3 py-1.5 text-xs border ${gradeColor(Math.round(s.avg))}`}>
                <span className="font-semibold">{s.subject}</span>
                <span className="opacity-75 ml-1.5">ср. {s.avg} · {s.count} оц.</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {student.grades.length === 0 ? (
        <p className="text-gray-400 text-sm italic">Оценок пока нет.</p>
      ) : (
        <>
          <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1.5">🕒 История оценок</h4>
          <div className="flex flex-col gap-1.5">
            {student.grades.map((g) => (
              <div key={g.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-sm">
                <div className="flex items-center gap-2.5">
                  <span className={`font-bold px-2 py-0.5 rounded-md border text-xs ${gradeColor(g.grade)}`}>{g.grade}/10</span>
                  <span className="text-gray-700 font-medium">{g.subject}</span>
                  <span className="text-gray-400 text-xs">{g.date}</span>
                  {g.comment && <span className="text-gray-500 text-xs italic">— {g.comment}</span>}
                </div>
                <button onClick={() => handleDelete(g.id)} className="text-gray-300 hover:text-red-500 transition text-xs">
                  🗑️
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function AttendanceTab({ student, classId, onChanged }) {
  const [subject, setSubject] = useState('')
  const [date, setDate] = useState(todayStr())
  const [status, setStatus] = useState('present')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [docFiles, setDocFiles] = useState({})

  async function handleMark(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await api.markAttendance({
        student_id: student.id,
        class_id: classId,
        subject,
        date,
        status,
        note,
      })
      setNote('')
      onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <form onSubmit={handleMark} className="grid sm:grid-cols-5 gap-2 mb-4">
        <input
          placeholder="Предмет (необязательно)"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="border border-gray-200 rounded-md px-2 py-1.5 text-sm sm:col-span-2 focus:outline-none focus:ring-2 focus:ring-brand-500 transition"
        />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="border border-gray-200 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 transition"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="border border-gray-200 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 transition"
        >
          {Object.entries(ATTENDANCE_LABELS).map(([key, v]) => (
            <option key={key} value={key}>{v.icon} {v.label}</option>
          ))}
        </select>
        <button
          disabled={busy}
          className="bg-brand-600 text-white rounded-md text-sm px-3 py-1.5 hover:bg-brand-700 active:scale-95 transition disabled:opacity-60"
        >
          Отметить
        </button>
        <input
          placeholder="Заметка (необязательно)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="border border-gray-200 rounded-md px-2 py-1.5 text-sm sm:col-span-5 focus:outline-none focus:ring-2 focus:ring-brand-500 transition"
        />
      </form>
      {error && <p className="text-red-600 text-xs mb-2">{error}</p>}

      {student.attendance.length === 0 ? (
        <p className="text-gray-400 text-sm italic">Записей о посещаемости пока нет.</p>
      ) : (
        <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
          {student.attendance.map((a) => {
            const meta = ATTENDANCE_LABELS[a.status] || ATTENDANCE_LABELS.present
            return (
              <div key={a.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-sm">
                <div className="flex items-center gap-2.5">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-md border ${meta.className}`}>
                    {meta.icon} {meta.label}
                  </span>
                  {a.subject && <span className="text-gray-700">{a.subject}</span>}
                  <span className="text-gray-400 text-xs">{a.date}</span>
                  {a.note && <span className="text-gray-500 text-xs italic">— {a.note}</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function HomeschoolTab({ student, isAdmin, onHomeschoolChanged }) {
  const [records, setRecords] = useState(null)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [reason, setReason] = useState('')
  const [startDate, setStartDate] = useState(todayStr())
  const [busy, setBusy] = useState(false)
  const [docFiles, setDocFiles] = useState({})

  const [closingId, setClosingId] = useState(null)
  const [endDate, setEndDate] = useState(todayStr())
  const [topics, setTopics] = useState('')
  const [closeNotes, setCloseNotes] = useState('')

  function load() {
    api.homeschoolRecords(student.id).then(setRecords).catch((err) => setError(err.message))
  }

  useEffect(() => {
    load()
  }, [])

  async function handleCreate(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const documents = HOMESCHOOL_DOC_TYPES
        .map(([id, label]) => ({
          document_type: id,
          title: label,
          file: docFiles[id],
        }))
        .filter((item) => item.file)

      const record = await api.createHomeschoolRecord({
        student_id: student.id,
        reason: reason.trim(),
        start_date: startDate,
        documents,
      })
      setShowCreate(false)
      setReason('')
      setDocFiles({})
      load()
      onHomeschoolChanged()
      if (record.uploadErrors?.length) {
        setError(`Перевод оформлен, но не удалось прикрепить: ${record.uploadErrors.map((x) => x.title).join(', ')}`)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleClose(recordId) {
    setError('')
    setBusy(true)
    try {
      await api.closeHomeschoolRecord(recordId, { end_date: endDate, topics_covered: topics, notes: closeNotes })
      setClosingId(null)
      setTopics('')
      setCloseNotes('')
      load()
      onHomeschoolChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const activeRecord = records?.find((r) => !r.end_date)

  return (
    <div>
      {error && <p className="text-red-600 text-xs mb-2">{error}</p>}

      {isAdmin && !activeRecord && (
        <div className="mb-4">
          {!showCreate ? (
            <button
              onClick={() => setShowCreate(true)}
              className="text-sm bg-amber-50 text-amber-700 border border-amber-200 px-3 py-1.5 rounded-md hover:bg-amber-100 transition"
            >
              🏠 Перевести на домашнее обучение
            </button>
          ) : (
            <form onSubmit={handleCreate} className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex flex-col gap-2 animate-scale-in">
              <textarea
                placeholder="Причина / основание перевода: укажите всё в одном поле (например, состояние здоровья, заявление родителя, номер приказа и т.д.)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                rows="3"
                className="border border-gray-200 rounded-md px-2 py-1.5 text-sm"
              />
              <div className="flex gap-2 items-center flex-wrap">
                <label className="text-xs text-gray-600">Дата начала:</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="border border-gray-200 rounded-md px-2 py-1.5 text-sm"
                />
              </div>
              <div className="rounded-md border border-amber-200 bg-white/70 p-3">
                <p className="text-xs font-semibold text-gray-700">📎 Прикрепить документы</p>
                <p className="text-[11px] text-gray-500 mt-0.5 mb-2">Можно выбрать документы сразу или добавить их позже.</p>
                <div className="grid sm:grid-cols-2 gap-2">
                  {HOMESCHOOL_DOC_TYPES.map(([id, label]) => (
                    <label key={id} className="block border border-gray-100 rounded-md p-2 bg-gray-50">
                      <span className="block text-[11px] text-gray-600 mb-1">{label}</span>
                      <input
                        type="file"
                        accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
                        onChange={(e) => setDocFiles((prev) => ({ ...prev, [id]: e.target.files[0] || null }))}
                        className="text-[11px] w-full file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-amber-100 file:text-amber-800"
                      />
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  disabled={busy}
                  className="bg-amber-600 text-white text-sm px-3 py-1.5 rounded-md hover:bg-amber-700 transition disabled:opacity-60"
                >
                  Сохранить
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="text-sm text-gray-500 px-3 py-1.5"
                >
                  Отмена
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {!records ? (
        <p className="text-gray-400 text-sm italic">Загрузка...</p>
      ) : records.length === 0 ? (
        <p className="text-gray-400 text-sm italic">Ученик никогда не переводился на домашнее обучение.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {records.map((r) => (
            <div
              key={r.id}
              className={`rounded-lg p-3 text-sm border ${
                r.end_date ? 'bg-gray-50 border-gray-100' : 'bg-amber-50 border-amber-200'
              }`}
            >
              <div className="flex justify-between items-start flex-wrap gap-2">
                <div>
                  <p className="font-medium text-gray-800">{r.reason}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    С {r.start_date} {r.end_date ? `по ${r.end_date}` : '— по настоящее время'}
                  </p>
                  {r.documents?.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {r.documents.map((doc) => (
                        <a
                          key={doc.id}
                          href={api.fileUrl(doc.file_path)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-full bg-white border border-amber-200 px-2 py-1 text-[11px] text-brand-700 hover:bg-amber-100"
                        >
                          📎 {doc.title}
                        </a>
                      ))}
                    </div>
                  )}
                  {r.topics_covered && (
                    <p className="text-xs text-gray-600 mt-1.5">
                      <span className="font-medium">Пройденные темы:</span> {r.topics_covered}
                    </p>
                  )}
                  {r.notes && <p className="text-xs text-gray-500 mt-0.5 italic">{r.notes}</p>}
                </div>
                {!r.end_date && (
                  <span className="text-xs font-medium text-amber-700 bg-white border border-amber-200 px-2 py-0.5 rounded-full">
                    Активно
                  </span>
                )}
              </div>

              {isAdmin && !r.end_date && (
                <div className="mt-3 border-t border-amber-200 pt-3">
                  {closingId !== r.id ? (
                    <button
                      onClick={() => setClosingId(r.id)}
                      className="text-xs bg-white border border-amber-300 text-amber-700 px-2.5 py-1 rounded-md hover:bg-amber-100 transition"
                    >
                      Вернуть на обычное обучение
                    </button>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <div className="flex gap-2 items-center flex-wrap">
                        <label className="text-xs text-gray-600">Дата возврата:</label>
                        <input
                          type="date"
                          value={endDate}
                          onChange={(e) => setEndDate(e.target.value)}
                          className="border border-gray-200 rounded-md px-2 py-1 text-xs"
                        />
                      </div>
                      <textarea
                        placeholder="Какие темы ученик прошёл самостоятельно за этот период"
                        value={topics}
                        onChange={(e) => setTopics(e.target.value)}
                        rows={2}
                        className="border border-gray-200 rounded-md px-2 py-1.5 text-xs"
                      />
                      <input
                        placeholder="Дополнительные заметки (необязательно)"
                        value={closeNotes}
                        onChange={(e) => setCloseNotes(e.target.value)}
                        className="border border-gray-200 rounded-md px-2 py-1.5 text-xs"
                      />
                      <div className="flex gap-2">
                        <button
                          disabled={busy}
                          onClick={() => handleClose(r.id)}
                          className="bg-brand-600 text-white text-xs px-3 py-1.5 rounded-md hover:bg-brand-700 transition disabled:opacity-60"
                        >
                          Подтвердить возврат
                        </button>
                        <button onClick={() => setClosingId(null)} className="text-xs text-gray-500 px-2 py-1.5">
                          Отмена
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
