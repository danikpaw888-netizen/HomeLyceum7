import React, { useEffect, useState } from 'react'
import { api } from '../api.js'

export default function ClassManager({ onSelectClass }) {
  const [classes, setClasses] = useState([])
  const [selectedClass, setSelectedClass] = useState(null)
  const [roster, setRoster] = useState([])
  const [unassigned, setUnassigned] = useState([])
  const [newClassName, setNewClassName] = useState('')
  const [enrollId, setEnrollId] = useState('')
  const [editingClassId, setEditingClassId] = useState(null)
  const [editingClassName, setEditingClassName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadClasses()
  }, [])

  useEffect(() => {
    if (selectedClass) {
      loadRoster(selectedClass)
      onSelectClass && onSelectClass(selectedClass)
    }
  }, [selectedClass])

  async function loadClasses() {
    try {
      const data = await api.listClasses()
      setClasses(data)
      if (data.length) setSelectedClass(data[0].id)
      else setLoading(false)
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }

  async function loadRoster(classId) {
    setLoading(true)
    try {
      const [rosterData, unassignedData] = await Promise.all([
        api.classStudents(classId),
        api.studentCandidates(classId),
      ])
      setRoster(rosterData)
      setUnassigned(unassignedData)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateClass(e) {
    e.preventDefault()
    setError('')
    try {
      const created = await api.createClass(newClassName)
      setNewClassName('')
      setClasses((prev) => [...prev, created])
      setSelectedClass(created.id)
    } catch (err) {
      setError(err.message)
    }
  }

  function startEditClass(classItem) {
    setError('')
    setEditingClassId(classItem.id)
    setEditingClassName(classItem.name)
  }

  function cancelEditClass() {
    setEditingClassId(null)
    setEditingClassName('')
  }

  async function handleUpdateClass(e) {
    e.preventDefault()
    if (!editingClassId || !editingClassName.trim()) return
    setError('')
    try {
      const updated = await api.updateClass(editingClassId, editingClassName.trim())
      setClasses((prev) => prev.map((c) => c.id === updated.id ? updated : c))
      cancelEditClass()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleDeleteClass() {
    if (!selectedClass) return
    const classItem = classes.find((c) => c.id === selectedClass)
    if (!classItem) return
    const confirmed = window.confirm(`Удалить класс «${classItem.name}»?\n\nКласс исчезнет из активного списка, но его оценки, посещаемость, расписание, задания и работы учеников останутся в системе. Ученики будут автоматически освобождены и их история обучения сохранится.`)
    if (!confirmed) return
    setError('')
    try {
      await api.deleteClass(selectedClass)
      const remaining = classes.filter((c) => c.id !== selectedClass)
      setClasses(remaining)
      setSelectedClass(remaining.length ? remaining[0].id : null)
      cancelEditClass()
      setRoster([])
      setUnassigned([])
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleEnroll(e) {
    e.preventDefault()
    if (!enrollId) return
    setError('')
    try {
      await api.enrollStudent(selectedClass, Number(enrollId))
      setEnrollId('')
      loadRoster(selectedClass)
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleUnenroll(studentId) {
    setError('')
    try {
      await api.unenrollStudent(selectedClass, studentId)
      loadRoster(selectedClass)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-card p-4 animate-fade-in-up">
      <h2 className="font-semibold text-gray-800 mb-1">🏫 Классы и ученики</h2>
      <p className="text-xs text-gray-400 mb-3">Удалённые классы архивируются: история оценок и посещаемости учеников не теряется.</p>
      {error && <p className="text-red-600 text-xs mb-2 bg-red-50 rounded-md px-2 py-1.5">{error}</p>}

      {classes.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {classes.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedClass(c.id)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition active:scale-95 ${
                selectedClass === c.id
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={handleCreateClass} className="flex flex-col sm:flex-row gap-2 mb-4">
        <input
          value={newClassName}
          onChange={(e) => setNewClassName(e.target.value)}
          placeholder="Новый класс, напр. 9А"
          required
          className="border border-gray-200 rounded-md px-2 py-1.5 text-sm flex-1 min-w-0 focus:outline-none focus:ring-2 focus:ring-brand-500 transition"
        />
        <button className="bg-brand-600 text-white px-3 py-1.5 rounded-md text-sm hover:bg-brand-700 active:scale-95 transition shrink-0 whitespace-nowrap">
          + Класс
        </button>
      </form>

      {selectedClass && (
        <div className="flex flex-wrap items-center gap-2 mb-4 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
          <span className="text-xs text-gray-500 mr-auto">Управление выбранным классом · удаление убирает его из активных списков, история обучения сохраняется</span>
          {editingClassId === selectedClass ? (
            <form onSubmit={handleUpdateClass} className="flex items-center gap-2">
              <input
                value={editingClassName}
                onChange={(e) => setEditingClassName(e.target.value)}
                maxLength={10}
                required
                autoFocus
                className="border border-gray-200 rounded-md px-2 py-1.5 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <button className="bg-brand-600 text-white px-3 py-1.5 rounded-md text-xs font-medium">Сохранить</button>
              <button type="button" onClick={cancelEditClass} className="px-3 py-1.5 rounded-md text-xs text-gray-600 hover:bg-gray-200">Отмена</button>
            </form>
          ) : (
            <>
              <button
                onClick={() => startEditClass(classes.find((c) => c.id === selectedClass))}
                className="px-3 py-1.5 rounded-md text-xs font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-100"
              >
                ✏️ Изменить название
              </button>
              <button
                onClick={handleDeleteClass}
                className="px-3 py-1.5 rounded-md text-xs font-medium text-red-600 bg-white border border-red-100 hover:bg-red-50"
              >
                🗑 Удалить класс
              </button>
            </>
          )}
        </div>
      )}

      {selectedClass && (
        <>
          <div className="border-t border-gray-100 pt-3 mb-3">
            <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Ученики класса</h3>
            {loading ? (
              <div className="skeleton animate-shimmer h-14 rounded-lg" />
            ) : roster.length === 0 ? (
              <p className="text-gray-400 text-sm italic">В этом классе пока нет учеников.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {roster.map((s) => (
                  <div key={s.id} className="flex items-center justify-between bg-gray-50 rounded-md px-3 py-1.5 text-sm animate-fade-in">
                    <span className="text-gray-700">{s.full_name}</span>
                    <button
                      onClick={() => handleUnenroll(s.id)}
                      className="text-gray-300 hover:text-red-500 transition text-xs"
                      title="Убрать из класса"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Добавить ученика</h3>
            {!loading && unassigned.length === 0 ? (
              <p className="text-gray-400 text-xs italic">Все доступные ученики уже состоят в выбранном классе.</p>
            ) : (
              <form onSubmit={handleEnroll} className="flex flex-col sm:flex-row gap-2">
                <select
                  value={enrollId}
                  onChange={(e) => setEnrollId(e.target.value)}
                  className="border border-gray-200 rounded-md px-2 py-1.5 text-sm flex-1 min-w-0 w-full sm:w-auto focus:outline-none focus:ring-2 focus:ring-brand-500 transition"
                >
                  <option value="">Выберите ученика</option>
                  {unassigned.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name}{s.current_class_name ? ` · сейчас ${s.current_class_name}` : ' · без класса'}
                    </option>
                  ))}
                </select>
                <button className="bg-brand-600 text-white px-3 py-1.5 rounded-md text-sm hover:bg-brand-700 active:scale-95 transition shrink-0 whitespace-nowrap">
                  Добавить в класс
                </button>
              </form>
            )}
          </div>
          <p className="text-[11px] text-gray-400 mt-2">Если ученик уже в другом классе, для администратора добавление автоматически оформит перевод: старый класс попадёт в историю, оценки и посещаемость останутся.</p>
        </>
      )}
    </div>
  )
}
