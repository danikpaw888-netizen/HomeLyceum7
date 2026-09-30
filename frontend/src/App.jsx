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
  const { user, loading } = useAuth()

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400 text-sm">Загрузка...</div>
  }

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
