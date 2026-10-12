import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import StudentGradesView from '../components/StudentGradesView.jsx'
import LearningTools from '../components/LearningTools.jsx'
import ProtectedFileLink from '../components/ProtectedFileLink.jsx'

export default function ParentDashboard() {
  const [children, setChildren] = useState([])
  const [selectedChild, setSelectedChild] = useState(null)
  const [homeschool, setHomeschool] = useState(null)
  const [classHistory, setClassHistory] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    api.myChildren()
      .then((data) => {
        setChildren(data)
        if (data.length) setSelectedChild(data[0].id)
      })
      .catch((err) => setError(err.message))
  }, [])

  useEffect(() => {
    if (!selectedChild) return
    setHomeschool(null)
    setClassHistory([])
    api.homeschoolRecords(selectedChild)
      .then((hs) => setHomeschool(hs.find((r) => !r.end_date) || null))
      .catch(() => setHomeschool(null))
    api.studentClassHistory(selectedChild)
      .then(setClassHistory)
      .catch(() => setClassHistory([]))
  }, [selectedChild])

  return (
    <div className="p-6 max-w-5xl mx-auto animate-fade-in">
      <h1 className="text-2xl font-bold mb-6 text-gray-800">👨‍👩‍👧 Кабинет родителя</h1>
      {error && (
        <p className="text-red-600 text-sm mb-3 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
      )}

      {children.length === 0 ? (
        <p className="text-gray-500 text-sm">
          Пока ни один ребёнок не привязан к вашему аккаунту — обратитесь к администратору школы.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 mb-4">
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


          {classHistory.length > 0 && (
            <div className="bg-white border border-gray-100 rounded-xl shadow-card p-4 mb-5">
              <p className="font-semibold text-gray-800">📚 История обучения</p>
              <p className="text-xs text-gray-500 mt-0.5 mb-3">Все прошлые классы и связанные с ними оценки и посещаемость сохраняются.</p>
              <div className="flex flex-wrap gap-2">
                {classHistory.map((item) => (
                  <div key={item.id} className="bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 min-w-[160px]">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-800">{item.class_name}</span>
                      {!item.left_at && <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full">ТЕКУЩИЙ</span>}
                    </div>
                    <p className="text-[11px] text-gray-500 mt-1">Оценок: {item.grades_count} · Посещаемость: {item.attendance_count}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {homeschool && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5 text-sm animate-fade-in-up">
              <p className="font-medium text-amber-800">🏠 Ребёнок переведён на домашнее обучение</p>
              <p className="text-amber-700 text-xs mt-1">С {homeschool.start_date} · {homeschool.reason}</p>
          {homeschool.documents?.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {homeschool.documents.map((doc) => (
                <ProtectedFileLink key={doc.id} path={doc.file_path}
                  className="bg-white/70 border border-amber-200 rounded-lg px-2.5 py-1.5 text-xs text-amber-800 hover:bg-white">
                  📎 {doc.title}
                </ProtectedFileLink>
              ))}
            </div>
          )}
            </div>
          )}

          <StudentGradesView studentId={selectedChild} />
          <LearningTools role="parent" studentId={selectedChild} />
        </>
      )}
    </div>
  )
}
