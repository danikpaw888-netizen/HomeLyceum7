import React from 'react'
import { MONTHS_RU, shiftMonth } from '../utils/dates.js'

export default function MonthNav({ month, onChange }) {
  return (
    <div className="inline-flex items-center gap-1 bg-white border border-gray-200 rounded-full px-1 py-1 shadow-sm">
      <button
        onClick={() => onChange(shiftMonth(month, -1))}
        className="w-8 h-8 rounded-full hover:bg-gray-100 active:scale-95 transition text-gray-600"
        title="Предыдущий месяц"
      >
        ‹
      </button>
      <span className="px-2 text-sm font-semibold text-gray-800 min-w-[9.5rem] text-center">
        {MONTHS_RU[month.m]} {month.y}
      </span>
      <button
        onClick={() => onChange(shiftMonth(month, 1))}
        className="w-8 h-8 rounded-full hover:bg-gray-100 active:scale-95 transition text-gray-600"
        title="Следующий месяц"
      >
        ›
      </button>
    </div>
  )
}
