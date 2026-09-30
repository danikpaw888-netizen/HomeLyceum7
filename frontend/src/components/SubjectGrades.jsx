import React, { useState } from 'react'

function gradeColor(grade) {
  if (grade >= 9) return 'text-emerald-700 bg-emerald-50 border-emerald-200'
  if (grade >= 7) return 'text-brand-700 bg-brand-50 border-brand-200'
  if (grade >= 5) return 'text-amber-700 bg-amber-50 border-amber-200'
  return 'text-red-700 bg-red-50 border-red-200'
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

export default function SubjectGrades({ items }) {
  const [openSubject, setOpenSubject] = useState(null)

  if (!items || items.length === 0) {
    return <p className="text-gray-400 text-sm italic">Оценок пока нет.</p>
  }

  const bySubject = {}
  for (const item of items) {
    const key = item.subject || 'Без предмета'
    if (!bySubject[key]) bySubject[key] = []
    bySubject[key].push(item)
  }

  const subjects = Object.entries(bySubject).sort((a, b) => a[0].localeCompare(b[0]))

  return (
    <div className="flex flex-col gap-2">
      {subjects.map(([subject, entries]) => {
        const avg = (entries.reduce((sum, e) => sum + e.grade, 0) / entries.length).toFixed(1)
        const isOpen = openSubject === subject
        return (
          <div key={subject} className="bg-white rounded-xl shadow-card overflow-hidden animate-fade-in-up">
            <button
              onClick={() => setOpenSubject(isOpen ? null : subject)}
              className="w-full flex justify-between items-center px-4 py-3 hover:bg-gray-50 transition text-left"
            >
              <span className="font-medium text-gray-800 text-sm">{subject}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">{entries.length} оц.</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-md border ${gradeColor(Math.round(avg))}`}>
                  ср. {avg}
                </span>
                <span className="text-gray-400 text-xs">{isOpen ? '▲' : '▼'}</span>
              </div>
            </button>
            {isOpen && (
              <div className="border-t border-gray-100 px-4 py-2.5 flex flex-col gap-1.5 animate-fade-in">
                {entries
                  .slice()
                  .sort((a, b) => new Date(b.date) - new Date(a.date))
                  .map((e, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className={`font-bold px-1.5 py-0.5 rounded border ${gradeColor(e.grade)}`}>{e.grade}/10</span>
                        <span className="text-gray-600">{e.label}</span>
                      </div>
                      <span className="text-gray-400">{formatDate(e.date)}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
