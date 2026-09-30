import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import StudentGradeTable from './StudentGradeTable.jsx'
import SubjectGrades from './SubjectGrades.jsx'

export default function StudentGradesView({ studentId }) {
  const [view, setView] = useState('table')
  const [items, setItems] = useState(null)
  const [attendance, setAttendance] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (!studentId) return
    setItems(null)
    setError('')
    Promise.all([api.studentGrades(studentId), api.studentAttendance(studentId).catch(() => [])])
      .then(([g, a]) => {
        setItems(g)
        setAttendance(a)
      })
      .catch((err) => setError(err.message))
  }, [studentId])

  return (
    <div>
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
        {[
          ['table', '📅 Таблица'],
          ['subjects', '📚 По предметам'],
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

      {error && (
        <p className="text-red-600 text-sm mb-3 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
      )}

      {!items && !error && <div className="skeleton animate-shimmer h-40 rounded-xl" />}

      {items && view === 'table' && <StudentGradeTable key={studentId} items={items} attendance={attendance} />}
      {items && view === 'subjects' && <SubjectGrades items={items} />}
    </div>
  )
}
