import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email, password)
      navigate('/')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-50 via-white to-brand-50 px-4">
      <div className="w-full max-w-sm bg-white p-8 rounded-2xl shadow-card animate-scale-in">
        <div className="flex flex-col items-center mb-6">
          <img src="/logo.png" alt="HomeLyceum7" className="w-16 h-16 object-contain drop-shadow-sm mb-3" />
          <h1 className="text-xl font-bold text-gray-800">HomeLyceum7</h1>
          <p className="text-sm text-gray-500 mt-1">Вход в единую школьную платформу</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Email</label>
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Пароль</label>
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition"
            />
          </div>
          {error && (
            <p className="text-red-600 text-sm bg-red-50 border border-red-100 rounded-lg px-3 py-2 animate-fade-in">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="bg-brand-600 hover:bg-brand-700 active:scale-[0.98] transition text-white rounded-lg py-2.5 font-medium text-sm disabled:opacity-60 shadow-sm hover:shadow-card-hover mt-1"
          >
            {loading ? 'Входим...' : 'Войти'}
          </button>
        </form>

        <p className="text-sm text-gray-500 mt-5 text-center">
          Нет аккаунта? <Link to="/register" className="text-brand-600 font-medium hover:underline">Зарегистрироваться</Link>
        </p>
      </div>
    </div>
  )
}
