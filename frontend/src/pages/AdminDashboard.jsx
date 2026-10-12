import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import ClassManager from '../components/ClassManager.jsx'
import LearningTools from '../components/LearningTools.jsx'

const DOC_TYPES = [
  ['order', 'Приказ о переводе'],
  ['medical', 'Медицинская справка / заключение'],
  ['parent_letter', 'Заявление / письмо родителя'],
  ['plan', 'Индивидуальный учебный план'],
  ['consent', 'Согласие / заявление'],
  ['other', 'Другой документ'],
]

const today = () => new Date().toISOString().slice(0, 10)

export default function AdminDashboard() {
  const [tab, setTab] = useState('requests')
  const [pending, setPending] = useState([])
  const [parents, setParents] = useState([])
  const [students, setStudents] = useState([])
  const [parentId, setParentId] = useState('')
  const [studentId, setStudentId] = useState('')
  const [records, setRecords] = useState([])
  const [selectedStudent, setSelectedStudent] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function loadCore() {
    try {
      const [p, s, hs] = await Promise.all([
        api.listUsers('parent'),
        api.listUsers('student'),
        api.allHomeschoolRecords(),
      ])
      setParents(p)
      setStudents(s)
      setRecords(hs)
    } catch (err) {
      setError(err.message)
    }
  }

  async function loadPending() {
    try {
      setPending(await api.pendingUsers())
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    loadCore()
    loadPending()
    const timer = setInterval(loadPending, 3000)
    return () => clearInterval(timer)
  }, [])

  const activeRecords = useMemo(
    () => records.filter((r) => !r.end_date),
    [records],
  )

  async function approve(userId, approved) {
    setError('')
    try {
      await api.updateUserApproval(userId, approved)
      setPending((prev) => prev.filter((u) => u.id !== userId))
      setMessage(approved ? 'Учётная запись одобрена.' : 'Заявка отклонена.')
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleLink(e) {
    e.preventDefault()
    setMessage('')
    setError('')
    try {
      await api.linkParent(Number(parentId), Number(studentId))
      setMessage('Родитель успешно привязан к ученику')
    } catch (err) {
      setError(err.message)
    }
  }

  async function createHomeschool(e) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    try {
      const documents = DOC_TYPES.map(([id, label]) => ({
        document_type: id,
        title: label,
        file: form.get(`file_${id}`),
      })).filter((item) => item.file && item.file.name)

      const record = await api.createHomeschoolRecord({
        student_id: Number(form.get('student_id')),
        reason: form.get('reason'),
        start_date: form.get('start_date'),
        notes: form.get('notes'),
        documents,
      })
      setRecords((prev) => [record, ...prev])
      setSelectedStudent(String(record.student_id))
      e.currentTarget.reset()
      setMessage(record.uploadErrors?.length
        ? `Перевод оформлен. Не удалось прикрепить: ${record.uploadErrors.map((x) => x.title).join(', ')}. Остальные документы сохранены.`
        : documents.length
          ? `Перевод оформлен и прикреплено документов: ${record.documents?.length || documents.length}.`
          : 'Перевод оформлен. Документы можно прикрепить позже.'
      )
    } catch (err) {
      setError(err.message)
    }
  }

  async function addDocument(recordId, e) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const file = form.get('file')
    if (!file || !file.name) return
    try {
      const doc = await api.addHomeschoolDocument(recordId, {
        document_type: form.get('document_type'),
        title: form.get('title'),
        file,
      })
      setRecords((prev) => prev.map((r) =>
        r.id === recordId ? { ...r, documents: [...(r.documents || []), doc] } : r
      ))
      e.currentTarget.reset()
      setMessage('Документ добавлен в дело.')
    } catch (err) {
      setError(err.message)
    }
  }

  async function closeRecord(record) {
    const end = window.prompt('Дата возврата (ГГГГ-ММ-ДД):', today())
    if (!end) return
    const topics = window.prompt('Пройденные темы:', record.topics_covered || '') ?? ''
    const notes = window.prompt('Итоговая заметка:', record.notes || '') ?? ''
    try {
      const updated = await api.closeHomeschoolRecord(record.id, {
        end_date: end,
        topics_covered: topics,
        notes,
      })
      setRecords((prev) => prev.map((r) => r.id === updated.id ? updated : r))
      setMessage('Период домашнего обучения закрыт.')
    } catch (err) {
      setError(err.message)
    }
  }

  const tabs = [
    ['requests', `👤 Заявки${pending.length ? ` (${pending.length})` : ''}`],
    ['homeschool', '🏠 Домашнее обучение'],
    ['parents', '👨‍👩‍👧 Связи'],
    ['classes', '🏫 Классы'],
  ]

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-5">
        <div>
          <p className="text-xs uppercase tracking-wider text-brand-600 font-semibold">Панель управления</p>
          <h1 className="text-2xl font-bold text-gray-800">Администратор</h1>
          <p className="text-sm text-gray-500 mt-1">Контроль доступа, обучения и документов учеников.</p>
        </div>
        <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-100 px-3 py-1.5 rounded-full">
          ● Заявки обновляются автоматически
        </span>
      </div>

      <div className="flex gap-1 mb-5 bg-gray-100 rounded-xl p-1 overflow-x-auto">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`whitespace-nowrap px-3 py-2 rounded-lg text-sm font-medium ${
              tab === id ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {message && <Notice type="success">{message}</Notice>}
      {error && <Notice type="error">{error}</Notice>}

      {tab === 'requests' && (
        <section className="bg-white rounded-2xl shadow-card p-5">
          <div className="flex justify-between items-center gap-3 mb-4">
            <div>
              <h2 className="font-semibold text-gray-800">Новые аккаунты</h2>
              <p className="text-xs text-gray-500 mt-1">Только одобренные пользователи получают доступ к платформе.</p>
            </div>
            <span className="bg-amber-50 text-amber-700 text-xs font-semibold px-3 py-1.5 rounded-full">
              На проверке: {pending.length}
            </span>
          </div>

          {pending.length === 0 ? (
            <Empty text="Новых заявок нет." />
          ) : (
            <div className="space-y-3">
              {pending.map((u) => (
                <div key={u.id} className="border border-gray-100 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-gray-800">{u.full_name}</p>
                    <p className="text-sm text-gray-500">{u.email} · {roleName(u.role)}</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => approve(u.id, true)} className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700">
                      ✓ Одобрить
                    </button>
                    <button onClick={() => approve(u.id, false)} className="bg-white border border-red-200 text-red-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-50">
                      Отклонить
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === 'homeschool' && (
        <section className="space-y-5">
          <div className="bg-white rounded-2xl shadow-card p-5">
            <h2 className="font-semibold text-gray-800">Перевести ученика на домашнее обучение</h2>
            <p className="text-xs text-gray-500 mt-1 mb-4">Документы можно прикрепить прямо при оформлении перевода или добавить позже. Один файл — для каждого типа документа.</p>
            <form onSubmit={createHomeschool} className="grid md:grid-cols-2 gap-3">
              <select name="student_id" required className="field">
                <option value="">Выберите ученика</option>
                {students.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
              <input name="start_date" type="date" defaultValue={today()} required className="field" />
              <textarea
                name="reason"
                required
                rows="3"
                placeholder="Причина / основание перевода. Укажите всё в одном поле: состояние здоровья, заявление родителя, номер приказа, иные основания…"
                className="field md:col-span-2"
              />
              <textarea name="notes" placeholder="Примечание к делу" rows="3" className="field md:col-span-2" />
              <div className="md:col-span-2 rounded-xl border border-gray-100 bg-gray-50 p-4">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-800">📎 Документы к переводу</p>
                    <p className="text-xs text-gray-500 mt-0.5">Прикрепите нужные документы сразу. Поддерживаются PDF, Word, Excel и изображения, до 20 МБ каждый.</p>
                  </div>
                </div>
                <div className="grid md:grid-cols-2 gap-3">
                  {DOC_TYPES.map(([id, label]) => (
                    <label key={id} className="block bg-white border border-gray-200 rounded-lg p-3">
                      <span className="block text-xs font-medium text-gray-700 mb-1.5">{label}</span>
                      <input name={`file_${id}`} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png" className="text-xs w-full file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-brand-50 file:text-brand-700 hover:file:bg-brand-100" />
                    </label>
                  ))}
                </div>
              </div>
              <button className="bg-brand-600 text-white rounded-lg py-2.5 text-sm font-semibold md:col-span-2 hover:bg-brand-700">
                Оформить перевод и сохранить документы
              </button>
            </form>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            {activeRecords.map((record) => (
              <HomeschoolCard
                key={record.id}
                record={record}
                student={students.find((s) => s.id === record.student_id)}
                onAddDocument={addDocument}
                onClose={() => closeRecord(record)}
              />
            ))}
            {!activeRecords.length && <Empty text="Активных переводов на домашнее обучение нет." />}
          </div>
        </section>
      )}

      {tab === 'parents' && (
        <div className="bg-white rounded-2xl shadow-card p-5">
          <h2 className="font-semibold text-gray-800 mb-3">Привязать родителя к ученику</h2>
          <form onSubmit={handleLink} className="flex flex-col gap-3 max-w-xl">
            <select value={parentId} onChange={(e) => setParentId(e.target.value)} required className="field">
              <option value="">Родитель</option>
              {parents.map((p) => <option key={p.id} value={p.id}>{p.full_name} ({p.email})</option>)}
            </select>
            <select value={studentId} onChange={(e) => setStudentId(e.target.value)} required className="field">
              <option value="">Ученик</option>
              {students.map((s) => <option key={s.id} value={s.id}>{s.full_name} ({s.email})</option>)}
            </select>
            <button className="bg-brand-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium">Связать</button>
          </form>
        </div>
      )}

      {tab === 'classes' && <ClassManager />}
      <LearningTools role="admin" />
    </div>
  )
}

function HomeschoolCard({ record, student, onAddDocument, onClose }) {
  const [activeDocType, setActiveDocType] = useState(DOC_TYPES[0][0])
  const docs = record.documents || []

  return (
    <div className="bg-white rounded-2xl shadow-card p-5">
      <div className="flex justify-between gap-3 mb-4">
        <div>
          <p className="font-semibold text-gray-800">{student?.full_name || `Ученик #${record.student_id}`}</p>
          <p className="text-xs text-gray-500">Домашнее обучение с {record.start_date} · {record.reason}</p>
        </div>
        <button onClick={onClose} className="text-xs text-gray-500 hover:text-gray-800">Завершить</button>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-gray-100 mb-4">
        {DOC_TYPES.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setActiveDocType(id)}
            className={`whitespace-nowrap px-2.5 py-2 text-xs font-medium border-b-2 ${
              activeDocType === id ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-400'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <form onSubmit={(e) => onAddDocument(record.id, e)} className="space-y-2">
        <input type="hidden" name="document_type" value={activeDocType} />
        <input name="title" required placeholder={DOC_TYPES.find((x) => x[0] === activeDocType)?.[1]} className="field" />
        <input name="file" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png" required className="text-sm w-full" />
        <button className="w-full bg-gray-900 text-white rounded-lg py-2 text-sm font-medium hover:bg-black">
          + Добавить документ
        </button>
      </form>

      <div className="mt-4 space-y-2">
        {docs.length === 0 && <p className="text-xs text-gray-400">Документы ещё не добавлены.</p>}
        {docs.map((doc) => (
          <a key={doc.id} href={api.fileUrl(doc.file_path)} target="_blank" rel="noreferrer"
            className="flex items-center justify-between gap-2 bg-gray-50 rounded-lg px-3 py-2 text-xs hover:bg-gray-100">
            <span>📎 {doc.title}</span><span className="text-brand-600">Открыть</span>
          </a>
        ))}
      </div>
    </div>
  )
}

function Notice({ type, children }) {
  return <p className={`${type === 'success' ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-red-50 border-red-100 text-red-600'} border rounded-lg px-3 py-2 text-sm mb-3`}>{children}</p>
}
function Empty({ text }) { return <div className="py-10 text-center text-sm text-gray-400">{text}</div> }
function roleName(role) { return ({ student: 'Ученик', teacher: 'Учитель', parent: 'Родитель' }[role] || role) }
