import React, { useState } from 'react'
import { api } from '../api.js'

function formatDeadline(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function isOverdue(iso) {
  return new Date(iso).getTime() < Date.now()
}

function gradeColor(grade) {
  if (grade >= 9) return 'text-emerald-700 bg-emerald-50 border-emerald-200'
  if (grade >= 7) return 'text-brand-700 bg-brand-50 border-brand-200'
  if (grade >= 5) return 'text-amber-700 bg-amber-50 border-amber-200'
  return 'text-red-700 bg-red-50 border-red-200'
}

export default function AssignmentCard({ assignment, submission, onSubmitted }) {
  const [file, setFile] = useState(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const overdue = isOverdue(assignment.deadline)
  const graded = submission?.grade != null

  async function handleUpload(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const result = await api.submitHomework(assignment.id, { comment, file })
      onSubmitted && onSubmitted(result)
      setFile(null)
      setComment('')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-white p-5 rounded-xl shadow-card hover:shadow-card-hover transition-shadow border-l-4 border-brand-500 animate-fade-in-up">
      <div className="flex justify-between items-start gap-3 flex-wrap">
        <div>
          {assignment.subject && (
            <h2 className="text-xs font-bold text-brand-700 uppercase tracking-wide">{assignment.subject}</h2>
          )}
          <p className="text-md font-semibold text-gray-800 mt-0.5">{assignment.title}</p>
        </div>
        <span
          className={`text-xs font-medium px-2.5 py-1 rounded-full border ${
            overdue ? 'text-red-600 bg-red-50 border-red-100' : 'text-amber-700 bg-amber-50 border-amber-100'
          }`}
        >
          {overdue ? '⏰' : '📅'} {formatDeadline(assignment.deadline)}
        </span>
      </div>

      {assignment.description && <p className="mt-3 text-gray-600 text-sm leading-relaxed">{assignment.description}</p>}

      {assignment.file_path && (
        <a
          href={api.fileUrl(assignment.file_path)}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 bg-brand-50 hover:bg-brand-100 transition px-2.5 py-1.5 rounded-md"
        >
          📎 {assignment.original_filename || 'Материал от учителя'}
        </a>
      )}

      {submission ? (
        <div className="mt-4 bg-gray-50 rounded-lg p-3.5 text-sm animate-fade-in">
          <p className="text-gray-700 font-medium">
            ✅ Сдано{submission.original_filename ? `: ${submission.original_filename}` : ''}
          </p>
          {submission.file_path && (
            <a
              href={api.fileUrl(submission.file_path)}
              target="_blank"
              rel="noreferrer"
              className="text-brand-600 underline text-xs"
            >
              Открыть мой файл
            </a>
          )}
          {graded ? (
            <div className="mt-2.5 flex items-start gap-2">
              <span className={`font-bold text-sm px-2.5 py-1 rounded-md border ${gradeColor(submission.grade)}`}>
                {submission.grade}/10
              </span>
              {submission.teacher_feedback && (
                <span className="text-gray-600 text-xs pt-1.5">{submission.teacher_feedback}</span>
              )}
            </div>
          ) : (
            <p className="mt-2 text-gray-500 italic text-xs">⏳ Ожидает проверки учителя</p>
          )}
        </div>
      ) : (
        <form onSubmit={handleUpload} className="mt-4 flex flex-col gap-2">
          <input
            type="file"
            onChange={(e) => setFile(e.target.files[0])}
            className="text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-brand-50 file:text-brand-700 hover:file:bg-brand-100 file:transition"
          />
          <input
            type="text"
            placeholder="Комментарий (необязательно)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition"
          />
          {error && <p className="text-red-600 text-xs bg-red-50 rounded-md px-2 py-1">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="bg-brand-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-brand-700 active:scale-[0.98] transition w-full sm:w-auto disabled:opacity-60 shadow-sm hover:shadow-card-hover"
          >
            {busy ? 'Отправка...' : 'Отправить решение'}
          </button>
        </form>
      )}
    </div>
  )
}
