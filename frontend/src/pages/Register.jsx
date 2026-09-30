import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

const ROLES = [
  { value: 'student', label: '🎓 Ученик' },
  { value: 'teacher', label: '🧑‍🏫 Учитель' },
  { value: 'parent', label: '👨‍👩‍👧 Родитель' },
]

export default function Register() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ full_name: '', email: '', password: '', role: 'student' })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSuccess('')
    setLoading(true)
    try {
      await register(form)
      navigate('/')
    } catch (err) {
      if (err.message.includes('заявка') || err.message.includes('одобрения')) {
        setSuccess(err.message)
      } else {
        setError(err.message)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-50 via-white to-brand-50 px-4 py-10">
      <div className="w-full max-w-sm bg-white p-8 rounded-2xl shadow-card animate-scale-in">
        <div className="flex flex-col items-center mb-6">
          <img src="/logo.png" alt="HomeLyceum7" className="w-16 h-16 object-contain drop-shadow-sm mb-3" />
          <h1 className="text-xl font-bold text-gray-800">Регистрация</h1>
          <p className="text-sm text-gray-500 mt-1 text-center">Заявка будет проверена администратором школы</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Полное имя</label>
            <input
              placeholder="Иванов Иван Иванович"
              value={form.full_name}
              onChange={(e) => update('full_name', e.target.value)}
              required
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Email</label>
            <input
              type="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={(e) => update('email', e.target.value)}
              required
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Пароль</label>
            <input
              type="password"
              placeholder="Минимум 6 символов"
              value={form.password}
              onChange={(e) => update('password', e.target.value)}
              required
              minLength={6}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Роль</label>
            <select
              value={form.role}
              onChange={(e) => update('role', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition bg-white"
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
          {success && (
            <p className="text-emerald-700 text-sm bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 animate-fade-in">
              ✓ {success}
            </p>
          )}
          {error && (
            <p className="text-red-600 text-sm bg-red-50 border border-red-100 rounded-lg px-3 py-2 animate-fade-in">
              {error}
            </p>
          )}
          <p className="text-xs text-gray-400 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
            После регистрации доступ к платформе появится только после одобрения администратора.
          </p>
          <button
            type="submit"
            disabled={loading}
            className="bg-brand-600 hover:bg-brand-700 active:scale-[0.98] transition text-white rounded-lg py-2.5 font-medium text-sm disabled:opacity-60 shadow-sm hover:shadow-card-hover mt-1"
          >
            {loading ? 'Создаём...' : 'Зарегистрироваться'}
          </button>
        </form>

        <p className="text-sm text-gray-500 mt-5 text-center">
          Уже есть аккаунт? <Link to="/login" className="text-brand-600 font-medium hover:underline">Войти</Link>
        </p>
      </div>
    </div>
  )
}
