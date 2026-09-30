import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import ClassManager from '../components/ClassManager.jsx'

export default function TeacherDashboard() {
  const [selectedClass, setSelectedClass] = useState(null)
  const [assignments, setAssignments] = useState([])
  const [students, setStudents] = useState([])
  const [error, setError] = useState('')

  const [newAssignment, setNewAssignment] = useState({ subject: '', title: '', description: '', deadline: '' })
  const [newAssignmentFile, setNewAssignmentFile] = useState(null)
  const [expandedAssignment, setExpandedAssignment] = useState(null)
  const [submissionsByAssignment, setSubmissionsByAssignment] = useState({})

  async function loadStudents() {
    try {
      setStudents(await api.listStudents())
    } catch (err) {
      setError(err.message)
    }
  }

  async function loadAssignments(classId) {
    if (!classId) return
    try {
      setAssignments(await api.listClassAssignments(classId))
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    loadStudents()
  }, [])

  useEffect(() => {
    loadAssignments(selectedClass)
    setExpandedAssignment(null)
    setSubmissionsByAssignment({})
  }, [selectedClass])

  async function handleCreateAssignment(e) {
    e.preventDefault()
    try {
      const created = await api.createAssignment({
        class_id: selectedClass,
        subject: newAssignment.subject,
        title: newAssignment.title,
        description: newAssignment.description,
        deadline: new Date(newAssignment.deadline).toISOString(),
        file: newAssignmentFile,
      })
      setAssignments((prev) => [...prev, created])
      setNewAssignment({ subject: '', title: '', description: '', deadline: '' })
      setNewAssignmentFile(null)
    } catch (err) {
      setError(err.message)
    }
  }

  async function toggleSubmissions(assignmentId) {
    if (expandedAssignment === assignmentId) {
      setExpandedAssignment(null)
      return
    }
    setExpandedAssignment(assignmentId)
    if (!submissionsByAssignment[assignmentId]) {
      try {
        const subs = await api.submissionsForAssignment(assignmentId)
        setSubmissionsByAssignment((prev) => ({ ...prev, [assignmentId]: subs }))
      } catch (err) {
        setError(err.message)
      }
    }
  }

  async function handleGrade(submissionId, assignmentId, grade, feedback) {
    try {
      const updated = await api.gradeSubmission(submissionId, Number(grade), feedback)
      setSubmissionsByAssignment((prev) => ({
        ...prev,
        [assignmentId]: prev[assignmentId].map((s) => (s.id === submissionId ? updated : s)),
      }))
    } catch (err) {
      setError(err.message)
    }
  }

  function studentName(id) {
    const s = students.find((s) => s.id === id)
    return s ? s.full_name : `Ученик #${id}`
  }

  return (
    <div className="p-6 max-w-4xl mx-auto animate-fade-in">
      <div className="flex items-center gap-2 mb-6">
        <h1 className="text-2xl font-bold text-gray-800">🧑‍🏫 Кабинет учителя</h1>
      </div>
      {error && (
        <p className="text-red-600 text-sm mb-3 bg-red-50 border border-red-100 rounded-lg px-3 py-2 animate-fade-in">
          {error}
        </p>
      )}

      <div className="grid md:grid-cols-3 gap-6">
        <ClassManager onSelectClass={setSelectedClass} />

        {/* Задания */}
        <div className="md:col-span-2 flex flex-col gap-4">
          {selectedClass && (
            <div className="bg-white rounded-xl shadow-card p-4 animate-fade-in-up">
              <h2 className="font-semibold text-gray-800 mb-3">✏️ Новое задание</h2>
              <form onSubmit={handleCreateAssignment} className="grid sm:grid-cols-2 gap-2">
                <input
                  placeholder="Предмет"
                  value={newAssignment.subject}
                  onChange={(e) => setNewAssignment((f) => ({ ...f, subject: e.target.value }))}
                  className="border border-gray-200 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 transition"
                />
                <input
                  type="datetime-local"
                  value={newAssignment.deadline}
                  onChange={(e) => setNewAssignment((f) => ({ ...f, deadline: e.target.value }))}
                  required
                  className="border border-gray-200 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 transition"
                />
                <input
                  placeholder="Название задания"
                  value={newAssignment.title}
                  onChange={(e) => setNewAssignment((f) => ({ ...f, title: e.target.value }))}
                  required
                  className="border border-gray-200 rounded-md px-2 py-1.5 text-sm sm:col-span-2 focus:outline-none focus:ring-2 focus:ring-brand-500 transition"
                />
                <textarea
                  placeholder="Описание"
                  value={newAssignment.description}
                  onChange={(e) => setNewAssignment((f) => ({ ...f, description: e.target.value }))}
                  className="border border-gray-200 rounded-md px-2 py-1.5 text-sm sm:col-span-2 focus:outline-none focus:ring-2 focus:ring-brand-500 transition"
                  rows={2}
                />
                <div className="sm:col-span-2">
                  <input
                    type="file"
                    onChange={(e) => setNewAssignmentFile(e.target.files[0] || null)}
                    className="text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-brand-50 file:text-brand-700 hover:file:bg-brand-100 file:transition"
                  />
                  {newAssignmentFile && (
                    <p className="text-xs text-gray-500 mt-1 animate-fade-in">📎 Прикреплён: {newAssignmentFile.name}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-0.5">Необязательно — например, файл с заданием или методичка</p>
                </div>
                <button className="bg-brand-600 text-white px-4 py-2 rounded-md text-sm hover:bg-brand-700 active:scale-[0.98] transition sm:col-span-2 shadow-sm hover:shadow-card-hover">
                  Создать задание
                </button>
              </form>
            </div>
          )}

          <div className="flex flex-col gap-3">
            {assignments.map((a) => (
              <div key={a.id} className="bg-white rounded-xl shadow-card hover:shadow-card-hover transition-shadow p-4 animate-fade-in-up">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-xs text-brand-700 font-semibold uppercase">{a.subject}</p>
                    <p className="font-semibold text-gray-800">{a.title}</p>
                    {a.file_path && (
                      <a
                        href={api.fileUrl(a.file_path)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand-600 underline text-xs"
                      >
                        📎 {a.original_filename || 'Прикреплённый файл'}
                      </a>
                    )}
                  </div>
                  <button
                    onClick={() => toggleSubmissions(a.id)}
                    className="text-sm text-brand-600 hover:text-brand-700 font-medium underline transition"
                  >
                    {expandedAssignment === a.id ? 'Скрыть работы' : 'Проверить работы'}
                  </button>
                </div>

                {expandedAssignment === a.id && (
                  <div className="mt-3 border-t pt-3 flex flex-col gap-2">
                    {(submissionsByAssignment[a.id] || []).length === 0 && (
                      <p className="text-sm text-gray-500">Пока никто не сдал работу.</p>
                    )}
                    {(submissionsByAssignment[a.id] || []).map((s) => (
                      <SubmissionRow
                        key={s.id}
                        submission={s}
                        studentName={studentName(s.student_id)}
                        onGrade={(grade, feedback) => handleGrade(s.id, a.id, grade, feedback)}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function SubmissionRow({ submission, studentName, onGrade }) {
  const [grade, setGrade] = useState(submission.grade || '')
  const [feedback, setFeedback] = useState(submission.teacher_feedback || '')

  return (
    <div className="bg-gray-50 rounded-lg p-3 text-sm flex flex-col sm:flex-row sm:items-center gap-2 justify-between animate-fade-in">
      <div>
        <p className="font-medium text-gray-800">{studentName}</p>
        {submission.file_path && (
          <a
            href={api.fileUrl(submission.file_path)}
            target="_blank"
            rel="noreferrer"
            className="text-brand-600 underline text-xs"
          >
            {submission.original_filename || 'Открыть файл'}
          </a>
        )}
        {submission.comment && <p className="text-gray-500 text-xs mt-1">💬 {submission.comment}</p>}
      </div>
      <div className="flex items-center gap-2">
        <select
          value={grade}
          onChange={(e) => setGrade(e.target.value)}
          className="border border-gray-200 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 transition"
        >
          <option value="">—</option>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <input
          placeholder="Комментарий"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          className="border border-gray-200 rounded-md px-2 py-1 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-brand-500 transition"
        />
        <button
          disabled={!grade}
          onClick={() => onGrade(grade, feedback)}
          className="bg-brand-600 text-white px-3 py-1.5 rounded-md text-xs hover:bg-brand-700 active:scale-95 transition disabled:opacity-50"
        >
          Сохранить
        </button>
      </div>
    </div>
  )
}
