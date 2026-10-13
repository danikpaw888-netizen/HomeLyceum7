import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import ClassManager from '../components/ClassManager.jsx'
import LearningTools from '../components/LearningTools.jsx'
import ProtectedFileLink from '../components/ProtectedFileLink.jsx'

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
  const [accounts, setAccounts] = useState([])
  const [parents, setParents] = useState([])
  const [students, setStudents] = useState([])
  const [parentId, setParentId] = useState('')
  const [studentId, setStudentId] = useState('')
  const [records, setRecords] = useState([])
  const [selectedStudent, setSelectedStudent] = useState('')
  const [allAssignments, setAllAssignments] = useState([])
  const [assignmentSearch, setAssignmentSearch] = useState('')
  const [assignmentClassFilter, setAssignmentClassFilter] = useState('all')
  const [assignmentTeacherFilter, setAssignmentTeacherFilter] = useState('all')
  const [assignmentStatusFilter, setAssignmentStatusFilter] = useState('all')
  const [openAssignmentId, setOpenAssignmentId] = useState(null)
  const [submissionsByAssignment, setSubmissionsByAssignment] = useState({})
  const [loadingAssignmentId, setLoadingAssignmentId] = useState(null)
  const [replacingAttachmentKey, setReplacingAttachmentKey] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [temporaryPasswords, setTemporaryPasswords] = useState({})
  const [resettingAccountId, setResettingAccountId] = useState(null)

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

  async function loadAccounts() {
    try {
      setAccounts(await api.adminAccounts())
    } catch (err) {
      setError(err.message)
    }
  }

  async function resetAccountPassword(account) {
    const confirmed = window.confirm(`Сбросить пароль для «${account.full_name}» (${account.email})? Старый пароль перестанет работать.`)
    if (!confirmed) return
    setError(''); setMessage(''); setResettingAccountId(account.id)
    setTemporaryPasswords((prev) => { const next = { ...prev }; delete next[account.id]; return next })
    try {
      const result = await api.resetUserPassword(account.id)
      setTemporaryPasswords((prev) => ({ ...prev, [account.id]: result.temporary_password }))
      setMessage(`Для ${account.email} создан временный пароль. Скопируйте и передайте его пользователю безопасным способом.`)
    } catch (err) { setError(err.message) }
    finally { setResettingAccountId(null) }
  }

  async function deactivateAccount(account) {
    const confirmed = window.confirm(
      `Отключить аккаунт «${account.full_name}» (${account.email})? Вход будет запрещён. Учебная история и оценки сохранятся.`
    )
    if (!confirmed) return
    setError('')
    setMessage('')
    try {
      await api.deactivateAccount(account.id)
      setAccounts((prev) => prev.filter((item) => item.id !== account.id))
      setPending((prev) => prev.filter((item) => item.id !== account.id))
      setParents((prev) => prev.filter((item) => item.id !== account.id))
      setStudents((prev) => prev.filter((item) => item.id !== account.id))
      setMessage('Аккаунт отключён. Учебная история сохранена.')
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    loadCore()
    loadPending()
    loadAccounts()
    const timer = setInterval(() => { loadPending(); loadAccounts() }, 5000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (tab === 'assignments') loadAllAssignments()
  }, [tab])

  const activeRecords = useMemo(
    () => records.filter((r) => !r.end_date),
    [records],
  )
  async function loadAllAssignments() {
    setError('')
    try {
      setAllAssignments(await api.adminAssignments())
    } catch (err) {
      setError(`Не удалось загрузить задания учителей: ${err.message}`)
    }
  }

  async function replaceAssignmentAttachment(assignment, attachment, file) {
    if (!file) return
    const key = `${assignment.id}-${attachment.id || 'legacy'}`
    setReplacingAttachmentKey(key)
    setError('')
    setMessage('')
    try {
      const updated = await api.replaceAssignmentAttachment(assignment.id, attachment.id || 0, file)
      setAllAssignments((prev) => prev.map((item) => {
        if (item.id !== assignment.id) return item
        const current = item.attachments || []
        const exists = attachment.id && current.some((entry) => entry.id === attachment.id)
        return {
          ...item,
          attachments: exists
            ? current.map((entry) => entry.id === attachment.id ? updated : entry)
            : [updated],
        }
      }))
      setMessage(`Вложение в задании «${assignment.title}» заменено на «${updated.original_filename}».`)
    } catch (err) {
      setError(`Не удалось заменить вложение: ${err.message}`)
    } finally {
      setReplacingAttachmentKey('')
    }
  }

  async function toggleAssignmentSubmissions(assignmentId) {
    if (openAssignmentId === assignmentId) {
      setOpenAssignmentId(null)
      return
    }
    setOpenAssignmentId(assignmentId)
    if (Object.prototype.hasOwnProperty.call(submissionsByAssignment, assignmentId)) return
    setLoadingAssignmentId(assignmentId)
    try {
      const submissions = await api.submissionsForAssignment(assignmentId)
      setSubmissionsByAssignment((prev) => ({ ...prev, [assignmentId]: submissions }))
    } catch (err) {
      setError(`Не удалось загрузить сданные работы: ${err.message}`)
    } finally {
      setLoadingAssignmentId(null)
    }
  }

  const assignmentClasses = useMemo(() => {
    const unique = new Map()
    allAssignments.forEach((item) => unique.set(String(item.class_id), {
      id: item.class_id,
      name: item.class_name || `Класс #${item.class_id}`,
    }))
    return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  }, [allAssignments])

  const assignmentTeachers = useMemo(() => {
    const unique = new Map()
    allAssignments.forEach((item) => unique.set(String(item.teacher_id), {
      id: item.teacher_id,
      name: item.teacher_name || `Учитель #${item.teacher_id}`,
    }))
    return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  }, [allAssignments])

  const visibleAssignments = useMemo(() => {
    const query = assignmentSearch.trim().toLocaleLowerCase('ru')
    return allAssignments.filter((item) => {
      const searchable = [
        item.title, item.subject, item.description, item.teacher_name,
        item.teacher_email, item.class_name,
      ].join(' ').toLocaleLowerCase('ru')
      const matchesQuery = !query || searchable.includes(query)
      const matchesClass = assignmentClassFilter === 'all' || String(item.class_id) === assignmentClassFilter
      const matchesTeacher = assignmentTeacherFilter === 'all' || String(item.teacher_id) === assignmentTeacherFilter
      const matchesStatus = assignmentStatusFilter === 'all'
        || (assignmentStatusFilter === 'active' ? item.is_active : !item.is_active)
      return matchesQuery && matchesClass && matchesTeacher && matchesStatus
    })
  }, [allAssignments, assignmentSearch, assignmentClassFilter, assignmentTeacherFilter, assignmentStatusFilter])


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
    const formElement = e.currentTarget
    const form = new FormData(formElement)
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
      formElement.reset()
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
    const formElement = e.currentTarget
    const form = new FormData(formElement)
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
      formElement.reset()
      setMessage('Документ добавлен в дело.')
    } catch (err) {
      setError(err.message)
    }
  }

  async function deleteHomeschoolDocument(recordId, doc) {
    const confirmed = window.confirm(
      `Удалить документ «${doc.title || doc.original_filename}» из дела домашнего обучения? Сам перевод и учебная история останутся.`
    )
    if (!confirmed) return
    setError('')
    setMessage('')
    try {
      await api.deleteHomeschoolDocument(recordId, doc.id)
      setRecords((prev) => prev.map((record) =>
        record.id === recordId
          ? { ...record, documents: (record.documents || []).filter((item) => item.id !== doc.id) }
          : record
      ))
      setMessage('Документ удалён из дела.')
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
    ['accounts', '👥 Аккаунты'],
    ['assignments', `📚 Задания учителей${allAssignments.length ? ` (${allAssignments.length})` : ''}`],
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
                onDeleteDocument={deleteHomeschoolDocument}
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

      {tab === 'accounts' && (
        <section className="bg-white rounded-2xl shadow-card p-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
            <div>
              <h2 className="font-semibold text-gray-800">Управление аккаунтами</h2>
              <p className="text-xs text-gray-500 mt-1">Отключение запрещает вход, но сохраняет оценки, работы и учебную историю.</p>
            </div>
            <button onClick={loadAccounts} className="border border-gray-200 rounded-lg px-3 py-2 text-sm hover:bg-gray-50">Обновить список</button>
          </div>
          {accounts.length === 0 ? <Empty text="Активных аккаунтов нет." /> : (
            <div className="space-y-2">
              {accounts.map((account) => (
                <div key={account.id} className="border border-gray-100 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-800">{account.full_name}</p>
                    <p className="text-sm text-gray-500 break-all">{account.email}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <span className="text-xs rounded-full bg-gray-100 px-2 py-1 text-gray-600">{roleName(account.role)}</span>
                      <span className={`text-xs rounded-full px-2 py-1 ${account.approval_status === 'approved' ? 'bg-emerald-50 text-emerald-700' : account.approval_status === 'pending' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>
                        {account.approval_status === 'approved' ? 'Активен' : account.approval_status === 'pending' ? 'Ожидает одобрения' : account.approval_status === 'rejected' ? 'Отклонён' : 'Отключён'}
                      </span>
                    </div>
                  </div>
                  {account.role !== 'admin' && account.approval_status !== 'deleted' && (
                    <div className="flex flex-wrap gap-2 self-start sm:self-auto shrink-0">
                      <button onClick={() => resetAccountPassword(account)} disabled={resettingAccountId === account.id} className="border border-blue-200 text-blue-700 hover:bg-blue-50 disabled:opacity-50 rounded-lg px-3 py-2 text-sm font-medium">
                        {resettingAccountId === account.id ? 'Сбрасываем…' : 'Сбросить пароль'}
                      </button>
                      <button onClick={() => deactivateAccount(account)} className="border border-red-200 text-red-600 hover:bg-red-50 rounded-lg px-3 py-2 text-sm font-medium">
                        Отключить аккаунт
                      </button>
                    </div>
                  )}
                  {temporaryPasswords[account.id] && (
                    <div className="basis-full rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <p className="text-sm font-semibold text-amber-900">Временный пароль — показывается только сейчас</p>
                      <p className="font-mono text-sm break-all my-2">{temporaryPasswords[account.id]}</p>
                      <button onClick={() => { navigator.clipboard?.writeText(temporaryPasswords[account.id]); setMessage('Временный пароль скопирован, если браузер разрешил копирование.') }} className="rounded-lg bg-amber-900 text-white px-3 py-2 text-sm">Копировать пароль</button>
                      <p className="text-xs text-amber-800 mt-2">При входе пользователь должен будет установить новый пароль. Не отправляйте пароль в общие чаты.</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === 'assignments' && (
        <section className="bg-white rounded-2xl shadow-card p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <div>
              <h2 className="font-semibold text-gray-800">Задания всех учителей</h2>
              <p className="text-xs text-gray-500 mt-1">Просмотр условий, материалов и сданных работ. Архивные задания тоже доступны.</p>
            </div>
            <button onClick={loadAllAssignments} className="border border-gray-200 rounded-lg px-3 py-2 text-sm hover:bg-gray-50">Обновить</button>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
            <input value={assignmentSearch} onChange={(e) => setAssignmentSearch(e.target.value)}
              placeholder="Поиск по заданию, предмету, учителю…" className="field sm:col-span-2" />
            <select value={assignmentClassFilter} onChange={(e) => setAssignmentClassFilter(e.target.value)} className="field">
              <option value="all">Все классы</option>
              {assignmentClasses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <select value={assignmentTeacherFilter} onChange={(e) => setAssignmentTeacherFilter(e.target.value)} className="field">
              <option value="all">Все учителя</option>
              {assignmentTeachers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <select value={assignmentStatusFilter} onChange={(e) => setAssignmentStatusFilter(e.target.value)} className="field">
              <option value="all">Активные и архивные</option>
              <option value="active">Только активные</option>
              <option value="archived">Только архивные</option>
            </select>
          </div>

          <div className="flex flex-wrap gap-2 text-xs text-gray-500 mb-4">
            <span className="rounded-full bg-gray-100 px-3 py-1.5">Всего заданий: {allAssignments.length}</span>
            <span className="rounded-full bg-emerald-50 text-emerald-700 px-3 py-1.5">Активных: {allAssignments.filter((a) => a.is_active).length}</span>
            <span className="rounded-full bg-gray-100 px-3 py-1.5">Сданных работ: {allAssignments.reduce((sum, a) => sum + (a.submissions_count || 0), 0)}</span>
          </div>

          {!allAssignments.length ? (
            <Empty text="Заданий пока нет или список ещё загружается. Нажми «Обновить», чтобы проверить ещё раз." />
          ) : !visibleAssignments.length ? (
            <Empty text="По выбранным фильтрам заданий нет." />
          ) : (
            <div className="space-y-3">
              {visibleAssignments.map((assignment) => {
                const attachments = assignment.attachments || []
                const submissions = submissionsByAssignment[assignment.id]
                const expanded = openAssignmentId === assignment.id
                return (
                  <article key={assignment.id} className="rounded-xl border border-gray-100 overflow-hidden">
                    <div className="p-4">
                      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <span className="text-xs font-semibold uppercase tracking-wide text-brand-700">{assignment.subject || 'Без предмета'}</span>
                            <span className="text-xs rounded-full bg-gray-100 text-gray-600 px-2 py-1">{assignment.class_name}</span>
                            <span className={`text-xs rounded-full px-2 py-1 ${assignment.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                              {assignment.is_active ? 'Активное задание' : 'Архив / удалено'}
                            </span>
                          </div>
                          <h3 className="font-semibold text-gray-800">{assignment.title}</h3>
                          {assignment.description && <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap">{assignment.description}</p>}
                          <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1 mt-3 text-xs text-gray-500">
                            <p><span className="font-medium text-gray-700">Учитель:</span> {assignment.teacher_name}{assignment.teacher_email ? ` · ${assignment.teacher_email}` : ''}</p>
                            <p><span className="font-medium text-gray-700">Класс:</span> {assignment.class_name}{assignment.class_is_active ? '' : ' (архивный)'}</p>
                            <p><span className="font-medium text-gray-700">Создано:</span> {assignment.created_at ? new Date(assignment.created_at).toLocaleString('ru-RU') : '—'}</p>
                            <p><span className="font-medium text-gray-700">Срок сдачи:</span> {assignment.deadline ? new Date(assignment.deadline).toLocaleString('ru-RU') : 'Без срока'}</p>
                            <p><span className="font-medium text-gray-700">Повторная сдача:</span> {assignment.allow_resubmission ? `до ${assignment.max_attempts || 1} попыток` : 'нет'}</p>
                            <p><span className="font-medium text-gray-700">Сдано работ:</span> {assignment.submissions_count || 0}</p>
                          </div>
                          {attachments.length > 0 && (
                            <div className="mt-3">
                              <p className="text-xs font-medium text-gray-600 mb-1.5">Материалы учителя</p>
                              <div className="space-y-2">
                                {attachments.map((file, index) => {
                                  const key = `${assignment.id}-${file.id || 'legacy'}`
                                  return (
                                    <div key={file.id || file.file_path || index} className="flex flex-wrap items-center gap-2">
                                      <ProtectedFileLink path={file.file_path}
                                        className="inline-flex items-center gap-1 rounded-lg border border-brand-100 bg-brand-50 px-2.5 py-1.5 text-xs text-brand-700 hover:bg-brand-100">
                                        📎 {file.original_filename || 'Вложение'}
                                      </ProtectedFileLink>
                                      <label className={`inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs cursor-pointer hover:bg-gray-50 ${replacingAttachmentKey === key ? 'opacity-60 pointer-events-none' : ''}`}>
                                        {replacingAttachmentKey === key ? 'Загрузка…' : 'Заменить файл'}
                                        <input
                                          type="file"
                                          accept=".pdf,.doc,.docx,.txt,.jpg,.jpeg,.png,.heic,.zip,.rar,.xlsx,.xls,.ppt,.pptx"
                                          className="hidden"
                                          disabled={!!replacingAttachmentKey}
                                          onChange={(event) => {
                                            const replacement = event.target.files?.[0]
                                            if (replacement) replaceAssignmentAttachment(assignment, file, replacement)
                                            event.target.value = ''
                                          }}
                                        />
                                      </label>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )}
                          {!attachments.length && <p className="text-xs text-gray-400 mt-2">Материалы не прикреплены.</p>}
                        </div>
                        <button onClick={() => toggleAssignmentSubmissions(assignment.id)}
                          className="shrink-0 rounded-lg border border-brand-100 bg-brand-50 text-brand-700 px-3 py-2 text-sm hover:bg-brand-100">
                          {loadingAssignmentId === assignment.id ? 'Загрузка…' : expanded ? 'Скрыть работы' : `Посмотреть работы (${assignment.submissions_count || 0})`}
                        </button>
                      </div>
                    </div>
                    {expanded && (
                      <div className="border-t border-gray-100 bg-gray-50/70 p-4">
                        <h4 className="text-sm font-semibold text-gray-800 mb-3">Работы учеников</h4>
                        {loadingAssignmentId === assignment.id && !submissions ? (
                          <p className="text-sm text-gray-500">Загружаем сданные работы…</p>
                        ) : !submissions?.length ? (
                          <p className="text-sm text-gray-500">Пока никто не сдал это задание.</p>
                        ) : (
                          <div className="space-y-3">
                            {submissions.map((submission) => {
                              const student = students.find((item) => item.id === submission.student_id)
                              const currentFiles = (submission.attachments || []).filter((file) => file.is_current)
                              const studentFiles = currentFiles.length ? currentFiles : (submission.file_path ? [{ file_path: submission.file_path, original_filename: submission.original_filename }] : [])
                              return (
                                <div key={submission.id} className="rounded-lg border border-gray-200 bg-white p-3">
                                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                                    <div>
                                      <p className="text-sm font-semibold text-gray-800">{student?.full_name || `Ученик #${submission.student_id}`}</p>
                                      <p className="text-xs text-gray-500 mt-1">
                                        Сдано: {submission.submitted_at ? new Date(submission.submitted_at).toLocaleString('ru-RU') : '—'}
                                        {' · '}Попытка: {submission.attempt_count || 1}
                                      </p>
                                      <p className="text-xs text-gray-600 mt-1">{submission.comment || 'Комментарий ученика отсутствует'}</p>
                                    </div>
                                    <span className={`self-start text-sm font-semibold rounded-lg px-3 py-1.5 ${submission.grade != null ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                                      {submission.grade != null ? `Оценка: ${submission.grade}/10` : 'Ожидает оценки'}
                                    </span>
                                  </div>
                                  {submission.teacher_feedback && <p className="text-xs text-gray-600 mt-2">Комментарий учителя: {submission.teacher_feedback}</p>}
                                  {studentFiles.length > 0 && (
                                    <div className="flex flex-wrap gap-2 mt-3">
                                      {studentFiles.map((file, index) => (
                                        <ProtectedFileLink key={file.id || file.file_path || index} path={file.file_path}
                                          className="text-xs text-brand-700 underline underline-offset-2">
                                          📎 {file.original_filename || 'Файл ученика'}
                                        </ProtectedFileLink>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          )}
        </section>
      )}

      <LearningTools role="admin" />
    </div>
  )
}

function HomeschoolCard({ record, student, onAddDocument, onDeleteDocument, onClose }) {
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
          <div key={doc.id} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
            <ProtectedFileLink path={doc.file_path}
              className="flex flex-1 min-w-0 items-center justify-between gap-2 text-xs hover:text-brand-700 text-left">
              <span className="truncate">📎 {doc.title}</span><span className="text-brand-600 shrink-0">Открыть</span>
            </ProtectedFileLink>
            <button type="button" onClick={() => onDeleteDocument(record.id, doc)}
              className="shrink-0 rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
              aria-label={`Удалить документ ${doc.title}`}
              title="Удалить документ">
              Удалить
            </button>
          </div>
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
