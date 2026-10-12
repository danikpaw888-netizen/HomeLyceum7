import React, { useState } from 'react'
import { api } from '../api.js'

/**
 * Open a protected upload in a new tab using the current auth token.
 * Native href navigation cannot attach the Bearer header required by /files.
 */
export default function ProtectedFileLink({ path, children, className = '' }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleOpen() {
    setLoading(true)
    setError('')
    try {
      await api.openFile(path)
    } catch (err) {
      setError(err?.message || 'Не удалось открыть файл')
    } finally {
      setLoading(false)
    }
  }

  return (
    <span className="inline-flex min-w-0 flex-col">
      <button type="button" onClick={handleOpen} disabled={loading}
        className={`${className} disabled:opacity-60`}>
        {loading ? 'Открываем документ…' : children}
      </button>
      {error && <span role="alert" className="mt-1 text-xs text-red-600">{error}</span>}
    </span>
  )
}
