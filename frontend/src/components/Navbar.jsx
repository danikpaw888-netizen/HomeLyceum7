import React from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

const ROLE_LABELS = {
  student: 'Ученик',
  teacher: 'Учитель',
  parent: 'Родитель',
  admin: 'Администратор',
}

const ROLE_ICONS = {
  student: '🎓',
  teacher: '🧑‍🏫',
  parent: '👨‍👩‍👧',
  admin: '🛠️',
}

export default function Navbar() {
  const { user, logout } = useAuth()
  const canSeeJournal = ['teacher', 'admin', 'parent'].includes(user.role)

  const tabClass = ({ isActive }) =>
    `px-3 py-1.5 rounded-md text-sm font-medium transition ${
      isActive ? 'bg-white/20 text-white' : 'text-white/70 hover:text-white hover:bg-white/10'
    }`

  return (
    <div className="sticky top-0 z-20 bg-gradient-to-r from-brand-700 via-brand-600 to-brand-500 text-white shadow-md">
      <nav className="px-4 sm:px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img
            src="/logo.png"
            alt="HomeLyceum7"
            className="w-9 h-9 rounded-full bg-white/90 p-0.5 shadow-sm object-contain"
          />
          <div>
            <div className="font-bold text-base sm:text-lg tracking-tight leading-none">HomeLyceum7</div>
            <div className="text-[11px] text-white/70 leading-none mt-0.5 hidden sm:block">
              Платформа домашнего обучения
            </div>
          </div>
        </div>
        {user && (
          <div className="flex items-center gap-3 sm:gap-4 text-sm">
            <span className="hidden sm:flex items-center gap-1.5 bg-white/10 px-3 py-1.5 rounded-full">
              <span>{ROLE_ICONS[user.role] || '👤'}</span>
              <span className="font-medium">{user.full_name}</span>
              <span className="opacity-70">· {ROLE_LABELS[user.role] || user.role}</span>
            </span>
            <button
              onClick={logout}
              className="bg-white/15 hover:bg-white/25 active:scale-95 transition px-3 py-1.5 rounded-md font-medium"
            >
              Выйти
            </button>
          </div>
        )}
      </nav>
      {user && (
        <div className="px-4 sm:px-6 pb-2 flex gap-1 overflow-x-auto">
          <NavLink to="/" end className={tabClass}>
            🏠 Кабинет
          </NavLink>
          <NavLink to="/schedule" className={tabClass}>
            🗓️ Расписание
          </NavLink>
          {canSeeJournal && (
            <NavLink to="/journal" className={tabClass}>
              📘 Журнал
            </NavLink>
          )}
        </div>
      )}
    </div>
  )
}
