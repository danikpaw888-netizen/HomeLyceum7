import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext.jsx'
import Navbar from './components/Navbar.jsx'
import Landing from './pages/Landing.jsx'
import Login from './pages/Login.jsx'
import Register from './pages/Register.jsx'
import StudentDashboard from './pages/StudentDashboard.jsx'
import TeacherDashboard from './pages/TeacherDashboard.jsx'
import ParentDashboard from './pages/ParentDashboard.jsx'
import AdminDashboard from './pages/AdminDashboard.jsx'
import SchedulePage from './pages/SchedulePage.jsx'
import JournalPage from './pages/JournalPage.jsx'
import { api } from './api.js'
import { useState } from 'react'

function RoleDashboard() {
  const { user } = useAuth()
  switch (user.role) {
    case 'student':
      return <StudentDashboard />
    case 'teacher':
      return <TeacherDashboard />
    case 'parent':
      return <ParentDashboard />
    case 'admin':
      return <AdminDashboard />
    default:
      return <p className="p-6">Неизвестная роль</p>
  }
}

function RoleRoute({ roles, children }) {
  const { user } = useAuth()
  if (!roles.includes(user.role)) return <Navigate to="/" replace />
  return children
}

export default function App() {
  const { user, loading, logout } = useAuth()

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400 text-sm">Загрузка...</div>
  }

  if (user?.must_change_password) return <PasswordChangeScreen onDone={() => { logout(); window.location.href = '/login' }} />

  return (
    <div className="min-h-screen bg-gray-50">
      {user && <Navbar />}
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
        <Route path="/register" element={user ? <Navigate to="/" replace /> : <Register />} />
        <Route path="/" element={user ? <RoleDashboard /> : <Landing />} />
        <Route
          path="/schedule"
          element={user ? <SchedulePage /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/journal"
          element={
            user ? (
              <RoleRoute roles={['teacher', 'admin', 'parent']}>
                <JournalPage />
              </RoleRoute>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}


function PasswordChangeScreen({ onDone }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault(); setError('')
    if (newPassword.length < 8) return setError('Новый пароль должен содержать не менее 8 символов.')
    if (newPassword !== confirmPassword) return setError('Пароли не совпадают.')
    setBusy(true)
    try { await api.changePassword(currentPassword, newPassword); alert('Пароль изменён. Войдите с новым паролем.'); onDone() }
    catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }
  return <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4"><form onSubmit={submit} className="w-full max-w-md bg-white rounded-2xl shadow-card p-6 space-y-4"><h1 className="text-xl font-bold text-gray-800">Создайте новый пароль</h1><p className="text-sm text-gray-500">Администратор сбросил пароль. Для продолжения работы необходимо заменить временный пароль.</p><label className="block text-sm">Временный пароль<input type="password" autoComplete="current-password" required value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} className="field mt-1 w-full" /></label><label className="block text-sm">Новый пароль (минимум 8 символов)<input type="password" autoComplete="new-password" required minLength={8} value={newPassword} onChange={e=>setNewPassword(e.target.value)} className="field mt-1 w-full" /></label><label className="block text-sm">Повторите новый пароль<input type="password" autoComplete="new-password" required value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} className="field mt-1 w-full" /></label>{error && <p className="text-sm text-red-600">{error}</p>}<button disabled={busy} className="w-full rounded-lg bg-brand-600 text-white py-2.5 disabled:opacity-50">{busy ? 'Сохраняем…' : 'Сменить пароль'}</button></form></div>
}
