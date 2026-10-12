import React, { useEffect, useState } from 'react'
import { api } from '../api.js'

const today = () => new Date().toISOString().slice(0, 10)
const inDays = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
const dateLabel = (value) => value ? new Date(value).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: value.includes('T') ? 'short' : undefined }) : '—'

export default function LearningTools({ role, studentId }) {
  const [tab, setTab] = useState('calendar')
  const [events, setEvents] = useState([])
  const [notifications, setNotifications] = useState([])
  const [report, setReport] = useState(null)
  const [audit, setAudit] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function loadNotifications() {
    try { setNotifications(await api.notifications()) } catch (e) { setError(e.message) }
  }
  async function loadCalendar() {
    setLoading(true); setError('')
    try { setEvents(await api.myCalendar(today(), inDays(30))) } catch (e) { setError(e.message) } finally { setLoading(false) }
  }
  async function loadReport() {
    if (!studentId) return
    setLoading(true); setError('')
    try { setReport(await api.studentReport(studentId)) } catch (e) { setError(e.message) } finally { setLoading(false) }
  }
  async function loadAudit() {
    setLoading(true); setError('')
    try { setAudit(await api.auditLogs(100)) } catch (e) { setError(e.message) } finally { setLoading(false) }
  }

  useEffect(() => { loadNotifications(); loadCalendar() }, [])
  useEffect(() => { if (tab === 'report' && studentId) loadReport(); if (tab === 'audit' && role === 'admin') loadAudit() }, [tab, studentId])

  async function markRead(item) {
    try {
      await api.markNotificationRead(item.id)
      setNotifications((prev) => prev.map((n) => n.id === item.id ? { ...n, read_at: new Date().toISOString() } : n))
    } catch (e) { setError(e.message) }
  }
  async function markAllRead() {
    try { await api.markAllNotificationsRead(); setNotifications((prev) => prev.map((n) => ({ ...n, read_at: new Date().toISOString() }))) }
    catch (e) { setError(e.message) }
  }
  function exportReport() {
    if (!report) return
    const rows = [['Предмет', 'Средний балл', 'Количество оценок'], ...report.subjects.map(s => [s.subject, s.average, s.count])]
    rows.push([], ['Показатель', 'Значение'], ['Средний балл', report.summary.average_grade ?? '—'],
      ['Всего оценок', report.summary.grades_count], ['Заданий', report.summary.homework_total],
      ['Выполнено заданий', report.summary.homework_done], ['Просрочено', report.summary.homework_overdue],
      ['Посещаемость — всего', report.summary.attendance_total], ['Был', report.summary.attendance_present],
      ['Отсутствовал', report.summary.attendance_absent], ['Уважительная причина', report.summary.attendance_excused])
    const csv = '\ufeff' + rows.map(row => row.map(value => '"' + String(value ?? '').replace(/"/g, '""') + '"').join(';')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const link = document.createElement('a'); link.href = url; link.download = 'HomeLyceum7-otchet.csv'; link.click()
    URL.revokeObjectURL(url)
  }

  const tabs = [
    ['calendar', '📅 Календарь'],
    ['notifications', `🔔 Уведомления${notifications.some(n => !n.read_at) ? ` · ${notifications.filter(n => !n.read_at).length}` : ''}`],
    ...(studentId ? [['report', '📊 Отчёт']] : []),
    ...(role === 'admin' ? [['audit', '🛡️ Журнал действий']] : []),
  ]
  return (
    <section className="mt-6 bg-white rounded-2xl border border-gray-100 shadow-card p-4 sm:p-5">
      <h2 className="font-semibold text-gray-800 mb-3">Инструменты обучения</h2>
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 overflow-x-auto">
        {tabs.map(([id, label]) => <button key={id} onClick={() => setTab(id)}
          className={`whitespace-nowrap px-3 py-2 rounded-md text-xs sm:text-sm font-medium ${tab === id ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500'}`}>{label}</button>)}
      </div>
      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg p-2 mb-3">{error}</p>}
      {tab === 'calendar' && <>
        <div className="flex items-center justify-between gap-2 mb-3">
          <p className="text-xs text-gray-500">Ближайшие 30 дней · уроки и сроки заданий</p>
          <button onClick={loadCalendar} className="text-xs text-brand-700 underline">Обновить</button>
        </div>
        {loading && !events.length ? <p className="text-sm text-gray-400">Загрузка календаря…</p> : events.length === 0 ?
          <p className="text-sm text-gray-500">В ближайшие 30 дней событий нет.</p> :
          <div className="space-y-2 max-h-96 overflow-y-auto">{events.map(event => <div key={event.id} className="flex gap-3 border border-gray-100 rounded-lg p-3">
            <div className="w-24 shrink-0"><p className="text-xs font-semibold text-gray-800">{dateLabel(event.date)}</p>
              {event.end && <p className="text-[11px] text-gray-400">{new Date(event.end).toLocaleTimeString('ru-RU', {hour:'2-digit',minute:'2-digit'})}</p>}</div>
            <div className="min-w-0"><p className="text-sm font-medium text-gray-800">{event.event_type === 'lesson' ? '📘 ' : '📝 '}{event.title}</p>
              <p className="text-xs text-gray-500">{event.class_name}{event.room ? ` · Кабинет ${event.room}` : ''}{event.status === 'submitted' ? ' · Сдано' : event.status === 'overdue' ? ' · Просрочено' : ''}</p>
              {event.description && <p className="text-xs text-gray-500 mt-1">{event.description}</p>}</div>
          </div>)}</div>}
      </>}
      {tab === 'notifications' && <>
        <div className="flex justify-between items-center mb-3"><p className="text-xs text-gray-500">Изменения заданий, новые работы, оценки и сроки сдачи</p>
          {notifications.some(n => !n.read_at) && <button onClick={markAllRead} className="text-xs text-brand-700 underline">Прочитать все</button>}</div>
        {!notifications.length ? <p className="text-sm text-gray-500">Уведомлений пока нет.</p> :
          <div className="space-y-2 max-h-96 overflow-y-auto">{notifications.map(n => <div key={n.id} className={`rounded-lg border p-3 ${n.read_at ? 'border-gray-100 bg-white' : 'border-brand-100 bg-brand-50/50'}`}>
            <div className="flex items-start justify-between gap-2"><p className="text-sm font-medium text-gray-800">{n.title}</p>
              {!n.read_at && <button onClick={() => markRead(n)} className="text-xs text-brand-700 underline shrink-0">Прочитано</button>}</div>
            <p className="text-xs text-gray-600 mt-1">{n.message}</p><p className="text-[11px] text-gray-400 mt-2">{dateLabel(n.created_at)}</p>
          </div>)}</div>}
      </>}
      {tab === 'report' && studentId && <>
        {!report ? <p className="text-sm text-gray-500">{loading ? 'Считаем показатели…' : 'Отчёт пока не загружен.'}</p> : <>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3"><p className="text-sm text-gray-500">Успеваемость, сдача заданий и посещаемость</p>
            <button onClick={exportReport} className="rounded-lg bg-brand-600 text-white px-3 py-2 text-xs font-medium">Экспорт CSV</button></div>
          <p className="text-sm font-semibold text-gray-800 mb-3">{report.student.full_name}</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
            {[
              ['Средний балл', report.summary.average_grade ?? '—'],
              ['Оценок', report.summary.grades_count],
              ['Выполнено', `${report.summary.homework_done}/${report.summary.homework_total}`],
              ['Просрочено', report.summary.homework_overdue],
              ['Выполнение', `${report.summary.completion_percent}%`],
              ['Всего отметок посещаемости', report.summary.attendance_total],
              ['Был', report.summary.attendance_present],
              ['Уважительная причина', report.summary.attendance_excused],
            ].map(([label, value]) => <div key={label} className="rounded-lg border border-gray-100 bg-gray-50 p-3"><p className="text-[11px] text-gray-500">{label}</p><p className="text-xl font-semibold text-gray-800 mt-1">{value}</p></div>)}
          </div>
          <h3 className="text-sm font-semibold mb-2">По предметам</h3>
          {report.subjects.length ? <div className="space-y-2">{report.subjects.map(s => <div key={s.subject} className="flex justify-between gap-3 border-b border-gray-100 py-2 text-sm"><span>{s.subject}</span><span className="font-medium">{s.average}/10 · {s.count} оценок</span></div>)}</div> : <p className="text-sm text-gray-500">Оценок пока нет.</p>}
          <h3 className="text-sm font-semibold mt-4 mb-2">История классов</h3>
          {report.history.map((h, i) => <div key={`${h.class_id}-${i}`} className="text-xs text-gray-600 py-1">{h.class_name} · {dateLabel(h.joined_at)} — {h.left_at ? dateLabel(h.left_at) : 'текущий класс'}</div>)}
        </>}
      </>}
      {tab === 'audit' && role === 'admin' && <>
        <p className="text-xs text-gray-500 mb-3">Последние 100 действий в системе. Доступно только администратору.</p>
        {!audit.length ? <p className="text-sm text-gray-500">{loading ? 'Загрузка…' : 'Записей пока нет.'}</p> :
          <div className="space-y-2 max-h-96 overflow-y-auto">{audit.map(row => <div key={row.id} className="border border-gray-100 rounded-lg p-3">
            <div className="flex flex-wrap justify-between gap-2"><p className="text-sm font-medium">{row.actor_name} · {row.action}</p><span className="text-[11px] text-gray-400">{dateLabel(row.created_at)}</span></div>
            <p className="text-xs text-gray-600 mt-1">{row.details || `${row.entity_type} #${row.entity_id}`}</p>
          </div>)}</div>}
      </>}
    </section>
  )
}
