import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import ProtectedFileLink from './ProtectedFileLink.jsx'

const dateLabel = iso => iso ? new Date(iso).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }) : '—'

function gradeColor(grade) {
  if (grade >= 9) return 'text-emerald-700 bg-emerald-50 border-emerald-200'
  if (grade >= 7) return 'text-brand-700 bg-brand-50 border-brand-200'
  if (grade >= 5) return 'text-amber-700 bg-amber-50 border-amber-200'
  return 'text-red-700 bg-red-50 border-red-200'
}

export default function AssignmentCard({ assignment, submission, onSubmitted }) {
  const [files, setFiles] = useState([])
  const [comment, setComment] = useState(submission?.comment || '')
  const [clearFiles, setClearFiles] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const overdue = new Date(assignment.deadline).getTime() < Date.now()
  const hasSubmission = Boolean(submission)
  const isSubmitted = hasSubmission && submission.is_submitted !== false
  const graded = isSubmitted && submission?.grade != null
  const attempts = Math.max(0, submission?.attempt_count ?? 0)
  const maxAttempts = assignment.max_attempts || 3
  const activeFiles = (assignment.attachments || []).filter(f => f.is_active)
  const shownFiles = activeFiles.length
    ? activeFiles
    : assignment.file_path
      ? [{ file_path: assignment.file_path, original_filename: assignment.original_filename }]
      : []
  const currentFiles = (submission?.attachments || []).filter(f => f.is_current)
  const shownSubmissionFiles = currentFiles.length
    ? currentFiles
    : submission?.file_path
      ? [{ file_path: submission.file_path, original_filename: submission.original_filename }]
      : []

  useEffect(() => {
    setComment(submission?.comment || '')
    setFiles([])
    setClearFiles(false)
    setError('')
  }, [submission?.id, submission?.is_submitted])

  async function submit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      // Save files as a draft first, then explicitly turn the work in.
      const draft = await api.submitHomework(assignment.id, {
        comment,
        files,
        clear_files: clearFiles && files.length === 0,
      })
      onSubmitted?.(draft)
      const turnedIn = await api.turnInSubmission(draft.id)
      onSubmitted?.(turnedIn)
      setFiles([])
      setClearFiles(false)
      setComment(turnedIn.comment || '')
    } catch (err) {
      setError(err.message || 'Не удалось сохранить работу')
    } finally {
      setBusy(false)
    }
  }

  async function cancelTurnIn() {
    if (!submission?.id) return
    setError('')
    setBusy(true)
    try {
      const draft = await api.unsubmitHomework(submission.id)
      onSubmitted?.(draft)
      setComment(draft.comment || '')
      setFiles([])
      setClearFiles(false)
    } catch (err) {
      setError(err.message || 'Не удалось отменить сдачу')
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="bg-white p-5 rounded-xl shadow-card border-l-4 border-brand-500">
      <div className="flex justify-between items-start gap-3 flex-wrap">
        <div>
          {assignment.subject && <p className="text-xs font-bold text-brand-700 uppercase tracking-wide">{assignment.subject}</p>}
          <h2 className="font-semibold text-gray-800 mt-0.5">{assignment.title}</h2>
        </div>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${overdue ? 'text-red-600 bg-red-50 border-red-100' : 'text-amber-700 bg-amber-50 border-amber-100'}`}>
          {overdue ? '⏰ Просрочено' : '📅 Срок'} · {dateLabel(assignment.deadline)}
        </span>
      </div>

      {assignment.description && <p className="mt-3 text-gray-600 text-sm leading-relaxed whitespace-pre-wrap">{assignment.description}</p>}
      {overdue && !isSubmitted && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Срок сдачи истёк, но отправить домашнее задание всё ещё можно. Работа будет отмечена как сданная после срока.
        </p>
      )}

      {shownFiles.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {shownFiles.map((file, index) => (
            <ProtectedFileLink key={file.id || file.file_path || index} path={file.file_path}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 bg-brand-50 hover:bg-brand-100 px-2.5 py-1.5 rounded-md">
              📎 {file.original_filename || 'Материал от учителя'}
            </ProtectedFileLink>
          ))}
        </div>
      )}

      {hasSubmission && (
        <div className="mt-4 bg-gray-50 rounded-lg p-3.5 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-gray-700">
              {isSubmitted ? (graded ? '✅ Проверено' : '✅ Сдано') : '📝 Черновик — ещё не сдан'}
              {isSubmitted && attempts > 0 ? ` · Попытка ${attempts}${assignment.allow_resubmission !== false ? ` из ${maxAttempts}` : ''}` : ''}
            </p>
            {graded && <span className={`font-bold px-2.5 py-1 rounded-md border ${gradeColor(submission.grade)}`}>{submission.grade}/10</span>}
          </div>

          {shownSubmissionFiles.length > 0 && (
            <div className="flex flex-col items-start gap-2 mt-2">
              {shownSubmissionFiles.map((file, index) => (
                <ProtectedFileLink key={file.id || file.file_path || index} path={file.file_path}
                  className="text-xs text-brand-600 underline">
                  📎 {file.original_filename || 'Открыть мой файл'}
                </ProtectedFileLink>
              ))}
            </div>
          )}
          {submission.comment && <p className="text-xs text-gray-500 mt-2">Комментарий: {submission.comment}</p>}
          {isSubmitted && submission.submitted_at && <p className="text-xs text-gray-500 mt-2">Сдано: {dateLabel(submission.submitted_at)}</p>}
          {isSubmitted && submission.teacher_feedback && <p className="text-xs text-gray-700 mt-2">Ответ учителя: {submission.teacher_feedback}</p>}
          {!isSubmitted && <p className="text-xs text-gray-500 mt-2">Файлы сохранены. Можно изменить вложения и сдать работу заново.</p>}
        </div>
      )}

      {!isSubmitted && (
        <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
          <label className="text-xs font-medium text-gray-600">
            {hasSubmission ? 'Изменить прикреплённые файлы' : 'Прикрепить файлы решения'} (до 10 файлов, 20 МБ каждый)
          </label>
          <input type="file" multiple onChange={event => {
            setFiles(Array.from(event.target.files || []).slice(0, 10))
            if (event.target.files?.length) setClearFiles(false)
          }} className="text-sm text-gray-500 file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-brand-50 file:text-brand-700" />
          {files.length > 0 && (
            <p className="text-xs text-gray-500">
              Новые файлы ({files.length}) заменят текущие: {files.map(file => file.name).join(', ')}
            </p>
          )}
          {shownSubmissionFiles.length > 0 && files.length === 0 && !clearFiles && (
            <p className="text-xs text-gray-500">Текущие файлы останутся прикреплёнными, если не выбрать новые.</p>
          )}
          {shownSubmissionFiles.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <input type="checkbox" checked={clearFiles} onChange={event => setClearFiles(event.target.checked)} />
              Удалить все прикреплённые файлы
            </label>
          )}
          <input type="text" placeholder="Комментарий (необязательно)" value={comment}
            onChange={event => setComment(event.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          {error && <p className="text-red-600 text-xs bg-red-50 rounded-md px-2 py-1">{error}</p>}
          <button type="submit" disabled={busy}
            className="bg-brand-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-brand-700 transition w-full sm:w-auto disabled:opacity-60">
            {busy ? 'Сохранение…' : overdue ? 'Сдать с опозданием' : 'Сдать'}
          </button>
        </form>
      )}

      {isSubmitted && (
        <div className="mt-4">
          {error && <p className="text-red-600 text-xs bg-red-50 rounded-md px-2 py-1 mb-2">{error}</p>}
          <button type="button" disabled={busy} onClick={cancelTurnIn}
            className="border border-amber-300 bg-amber-50 text-amber-800 py-2 px-4 rounded-lg font-medium hover:bg-amber-100 transition w-full sm:w-auto disabled:opacity-60">
            {busy ? 'Отмена…' : 'Отменить сдачу'}
          </button>
          <p className="text-xs text-gray-500 mt-2">После отмены можно будет поменять файлы и снова сдать работу.</p>
        </div>
      )}
    </article>
  )
}
