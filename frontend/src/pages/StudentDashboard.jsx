import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { useAuth } from '../context/AuthContext.jsx'
import AssignmentCard from '../components/AssignmentCard.jsx'
import StudentGradesView from '../components/StudentGradesView.jsx'
import LearningTools from '../components/LearningTools.jsx'
import QuizCenter from '../components/QuizCenter.jsx'

export default function StudentDashboard() {
  const { user } = useAuth()
  const [assignments, setAssignments] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [homeschool, setHomeschool] = useState(null)
  const [classHistory, setClassHistory] = useState([])
  const [tab, setTab] = useState('assignments')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    try {
      const [feed, mySubs, hs, history] = await Promise.all([
        api.myFeed(),
        api.mySubmissions(),
        api.homeschoolRecords(user.id).catch(() => []),
        api.studentClassHistory(user.id).catch(() => []),
      ])
      setAssignments(feed)
      setSubmissions(mySubs)
      setHomeschool(hs.find((r) => !r.end_date) || null)
      setClassHistory(history)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  function submissionFor(assignmentId) {
    return submissions.find((s) => s.assignment_id === assignmentId)
  }

  return (
    <div className={`p-6 mx-auto animate-fade-in ${tab === 'grades' ? 'max-w-5xl' : 'max-w-2xl'}`}>
      <h1 className="text-2xl font-bold mb-4 text-gray-800">🏠 Мой учебный центр</h1>


      {classHistory.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-xl shadow-card p-4 mb-5 animate-fade-in-up">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <p className="font-semibold text-gray-800">📚 История обучения</p>
              <p className="text-xs text-gray-500 mt-0.5">Переход в другой класс не удаляет прошлые оценки и посещаемость.</p>
            </div>
            <span className="text-[11px] text-brand-700 bg-brand-50 px-2 py-1 rounded-full whitespace-nowrap">{classHistory.length} {classHistory.length === 1 ? 'класс' : 'класса/периода'}</span>
          </div>
          <div className="flex flex-col gap-2">
            {classHistory.map((item) => {
              const current = !item.left_at
              const from = new Date(item.joined_at).toLocaleDateString('ru-RU')
              const to = item.left_at ? new Date(item.left_at).toLocaleDateString('ru-RU') : 'сейчас'
              return (
                <div key={item.id} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-gray-800 text-sm">{item.class_name}</p>
                    {current && <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">ТЕКУЩИЙ</span>}
                  </div>
                  <p className="text-[11px] text-gray-500 mt-0.5">{from} — {to}</p>
                  <div className="flex flex-wrap gap-2 mt-2 text-[11px] text-gray-600">
                    <span className="bg-white border border-gray-100 rounded px-2 py-1">Оценок: {item.grades_count}</span>
                    <span className="bg-white border border-gray-100 rounded px-2 py-1">Посещаемость: {item.attendance_count}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {homeschool && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5 text-sm animate-fade-in-up">
          <p className="font-medium text-amber-800">🏠 Вы переведены на домашнее обучение</p>
          <p className="text-amber-700 text-xs mt-1">С {homeschool.start_date} · {homeschool.reason}</p>
        </div>
      )}

      <div className="flex gap-1 mb-5 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setTab('assignments')}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
            tab === 'assignments' ? 'bg-white shadow-sm text-brand-700' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Задания
        </button>
        <button
          onClick={() => setTab('grades')}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
            tab === 'grades' ? 'bg-white shadow-sm text-brand-700' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Мои оценки
        </button>
      </div>

      {loading && tab === 'assignments' && (
        <div className="flex flex-col gap-3">
          {[1, 2].map((i) => (
            <div key={i} className="skeleton animate-shimmer h-24 rounded-xl" />
          ))}
        </div>
      )}
      {error && (
        <p className="text-red-600 text-sm bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-3">{error}</p>
      )}

      {!loading && tab === 'assignments' && (
        <>
          {assignments.length === 0 && (
            <p className="text-gray-500 text-sm">Пока нет заданий — попросите учителя добавить вас в класс.</p>
          )}
          <div className="flex flex-col gap-4">
            {assignments.map((a) => (
              <AssignmentCard
                key={a.id}
                assignment={a}
                submission={submissionFor(a.id)}
                onSubmitted={(newSub) =>
                  setSubmissions((prev) => [...prev.filter((s) => s.assignment_id !== a.id), newSub])
                }
              />
            ))}
          </div>
        </>
      )}

      {tab === 'grades' && <StudentGradesView studentId={user.id} />}
      <QuizCenter role="student" />
      <LearningTools role="student" studentId={user.id} />
    </div>
  )
}
