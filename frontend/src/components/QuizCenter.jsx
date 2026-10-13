import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { useAuth } from '../context/AuthContext.jsx'

const blankOption = () => ({ option_text: '', is_correct: false })
const blankQuestion = () => ({
  question_text: '',
  question_type: 'single',
  points: 1,
  options: [{ option_text: '', is_correct: true }, { option_text: '', is_correct: false }],
})
const blankForm = () => ({ title: '', subject: '', description: '', deadline: '', duration_minutes: 20, attempts_allowed: 1 })
const field = 'border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500'
const statusText = (status) => ({
  in_progress: 'Выполняется',
  submitted: 'Сдан · проверен автоматически',
  pending_review: 'На ручной проверке',
  graded: 'Проверен учителем',
  expired: 'Время истекло',
}[status] || status || 'Не начат')

function parseUtcDate(value) {
  if (!value) return null
  const text = String(value)
  // API timestamps without an offset come from datetime.utcnow() and are UTC.
  const hasTimezone = text.endsWith('Z') || /[+-][0-9]{2}:[0-9]{2}$/.test(text)
  return new Date(hasTimezone ? text : text + 'Z')
}
function formatDate(value) {
  if (!value) return 'Без срока'
  return parseUtcDate(value).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })
}
function durationLabel(seconds) {
  const total = Math.max(0, Math.floor(seconds))
  return `${Math.floor(total / 60).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`
}

export default function QuizCenter({ role, classId }) {
  return role === 'teacher'
    ? <TeacherQuizCenter classId={classId} />
    : <StudentQuizCenter />
}

function TeacherQuizCenter({ classId }) {
  const { user } = useAuth()
  const [classSubjects, setClassSubjects] = useState([])
  const [subjectsLoading, setSubjectsLoading] = useState(false)
  const [quizzes, setQuizzes] = useState([])
  const [form, setForm] = useState(blankForm)
  const [questions, setQuestions] = useState([blankQuestion()])
  const [attempts, setAttempts] = useState({})
  const [expanded, setExpanded] = useState(null)
  const [gradeDrafts, setGradeDrafts] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function load() {
    if (!classId) { setQuizzes([]); return }
    try { setQuizzes(await api.classQuizzes(classId)) } catch (e) { setError(e.message) }
  }
  useEffect(() => { load(); setExpanded(null); setAttempts({}) }, [classId])
  useEffect(() => {
    if (!classId || !user?.id) { setClassSubjects([]); setSubjectsLoading(false); return }
    let cancelled = false
    setSubjectsLoading(true)
    api.classSchedule(classId).then(lessons => {
      if (cancelled) return
      const subjects = [...new Set(lessons.filter(lesson => lesson.teacher_id === user.id && lesson.subject?.trim()).map(lesson => lesson.subject.trim()))].sort((a, b) => a.localeCompare(b, 'ru'))
      setClassSubjects(subjects)
      setForm(prev => ({ ...prev, subject: subjects.includes(prev.subject) ? prev.subject : (subjects[0] || '') }))
    }).catch(e => { if (!cancelled) setError(e.message) }).finally(() => { if (!cancelled) setSubjectsLoading(false) })
    return () => { cancelled = true }
  }, [classId, user?.id])

  function updateQuestion(index, changes) {
    setQuestions(prev => prev.map((q, i) => i === index ? { ...q, ...changes } : q))
  }
  function updateOption(qIndex, optionIndex, changes) {
    setQuestions(prev => prev.map((q, i) => {
      if (i !== qIndex) return q
      return { ...q, options: q.options.map((opt, oi) => {
        if (oi !== optionIndex) return q.question_type === 'single' && changes.is_correct ? { ...opt, is_correct: false } : opt
        return { ...opt, ...changes }
      }) }
    }))
  }
  async function createQuiz(e) {
    e.preventDefault(); setError(''); setNotice('')
    if (!classId) { setError('Сначала выберите класс.'); return }
    const payloadQuestions = questions.map(q => ({
      question_text: q.question_text.trim(),
      question_type: q.question_type,
      points: Number(q.points),
      options: q.question_type === 'text' ? [] : q.options.map(o => ({ option_text: o.option_text.trim() })),
      correct_option_indexes: q.question_type === 'text' ? [] : q.options.map((o, i) => o.is_correct ? i : -1).filter(i => i >= 0),
    }))
    for (let i = 0; i < payloadQuestions.length; i++) {
      const q = payloadQuestions[i]
      if (!q.question_text) { setError(`Заполни текст вопроса №${i + 1}.`); return }
      if (q.question_type !== 'text' && (q.options.length < 2 || q.options.some(o => !o.option_text))) { setError(`У вопроса №${i + 1} должно быть минимум два заполненных варианта.`); return }
      if (q.question_type !== 'text' && q.correct_option_indexes.length === 0) { setError(`Отметь правильный ответ у вопроса №${i + 1}.`); return }
      if (q.question_type === 'single' && q.correct_option_indexes.length !== 1) { setError(`У вопроса №${i + 1} должен быть ровно один правильный ответ.`); return }
    }
    setBusy(true)
    try {
      const created = await api.createQuiz({
        class_id: Number(classId), title: form.title, subject: form.subject,
        description: form.description, deadline: form.deadline ? new Date(form.deadline).toISOString() : null,
        duration_minutes: form.duration_minutes ? Number(form.duration_minutes) : null,
        attempts_allowed: Number(form.attempts_allowed), is_published: true, questions: payloadQuestions,
      })
      setQuizzes(prev => [created, ...prev])
      setForm({ ...blankForm(), subject: classSubjects[0] || '' }); setQuestions([blankQuestion()])
      setNotice('Тест опубликован. Ученикам класса пришло уведомление.')
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function toggleAttempts(quiz) {
    if (expanded === quiz.id) { setExpanded(null); return }
    setExpanded(quiz.id); setError('')
    try {
      const data = await api.quizAttempts(quiz.id)
      setAttempts(prev => ({ ...prev, [quiz.id]: data }))
      setGradeDrafts(prev => {
        const next = { ...prev }
        data.forEach(attempt => {
          if (!next[attempt.id]) {
            next[attempt.id] = {}
            attempt.answers.filter(a => a.question_type === 'text').forEach(answer => {
              next[attempt.id][answer.id] = { points_awarded: answer.points_awarded || 0, feedback: answer.feedback || '' }
            })
          }
        })
        return next
      })
    } catch (e) { setError(e.message) }
  }
  async function gradeAttempt(attempt) {
    setError(''); setNotice('')
    const textAnswers = attempt.answers.filter(a => a.question_type === 'text')
    const updates = textAnswers.map(answer => ({
      answer_id: answer.id,
      points_awarded: Number(gradeDrafts[attempt.id]?.[answer.id]?.points_awarded ?? answer.points_awarded ?? 0),
      feedback: gradeDrafts[attempt.id]?.[answer.id]?.feedback ?? answer.feedback ?? '',
    }))
    try {
      const result = await api.gradeQuizAttempt(attempt.id, updates)
      setAttempts(prev => ({ ...prev, [attempt.quiz_id]: (prev[attempt.quiz_id] || []).map(a => a.id === result.id ? result : a) }))
      setNotice('Результат сохранён. Ученик и родитель получили уведомление.')
    } catch (e) { setError(e.message) }
  }
  async function deactivate(quiz) {
    if (!window.confirm(`Скрыть тест «${quiz.title}»? Попытки и результаты останутся в истории.`)) return
    try {
      await api.deactivateQuiz(quiz.id)
      setQuizzes(prev => prev.filter(q => q.id !== quiz.id))
      setNotice('Тест скрыт. Результаты сохранены.')
    } catch (e) { setError(e.message) }
  }

  return <section className="mt-5 bg-white rounded-2xl border border-gray-100 shadow-card p-4 sm:p-5">
    <div className="flex items-center justify-between gap-2 mb-4">
      <div><h2 className="text-lg font-semibold text-gray-800">🧠 Онлайн-тесты и контрольные</h2><p className="text-xs text-gray-500 mt-1">Тесты с автоматической проверкой и текстовыми ответами для учителя.</p></div>
      <button onClick={load} className="text-xs border border-gray-200 rounded-lg px-3 py-2">Обновить</button>
    </div>
    {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3 mb-3">{error}</p>}
    {notice && <p className="text-sm text-emerald-700 bg-emerald-50 rounded-lg p-3 mb-3">{notice}</p>}
    {!classId ? <p className="text-sm text-gray-500">Выбери класс, чтобы создать тест.</p> : <>
      <form onSubmit={createQuiz} className="border border-gray-100 rounded-xl p-3 sm:p-4 space-y-3 mb-5">
        <h3 className="font-semibold text-gray-800">Создать тест</h3>
        <div className="grid sm:grid-cols-2 gap-2">
          <input className={field} required placeholder="Название контрольной" value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))}/>
          <select className={field} required value={form.subject} disabled={subjectsLoading||classSubjects.length===0} onChange={e=>setForm(f=>({...f,subject:e.target.value}))}>
            <option value="" disabled>{subjectsLoading ? 'Загружаем предметы…' : classSubjects.length ? 'Выберите свой предмет' : 'Нет назначенных предметов'}</option>
            {classSubjects.map(subject => <option key={subject} value={subject}>{subject}</option>)}
          </select>
          <textarea className={field+' sm:col-span-2'} rows={2} placeholder="Описание / инструкции" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}/>
          <label className="text-xs text-gray-600">Срок (необязательно)<input type="datetime-local" className={field+' block w-full mt-1'} value={form.deadline} onChange={e=>setForm(f=>({...f,deadline:e.target.value}))}/></label>
          <label className="text-xs text-gray-600">Лимит времени в минутах<input type="number" min="1" max="180" className={field+' block w-full mt-1'} value={form.duration_minutes} onChange={e=>setForm(f=>({...f,duration_minutes:e.target.value}))}/></label>
          <label className="text-xs text-gray-600">Количество попыток<select className={field+' block w-full mt-1'} value={form.attempts_allowed} onChange={e=>setForm(f=>({...f,attempts_allowed:Number(e.target.value)}))}>{[1,2,3,4,5,10].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
        </div>
        <div className="space-y-3">
          {questions.map((q, qi)=><div key={qi} className="rounded-xl border border-gray-200 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold">Вопрос {qi+1}</p>{questions.length>1&&<button type="button" onClick={()=>setQuestions(prev=>prev.filter((_,i)=>i!==qi))} className="text-xs text-red-600">Удалить вопрос</button>}</div>
            <textarea required className={field+' w-full'} rows={2} placeholder="Текст вопроса" value={q.question_text} onChange={e=>updateQuestion(qi,{question_text:e.target.value})}/>
            <div className="flex flex-wrap gap-3 items-center">
              <label className="text-xs text-gray-600">Тип ответа <select className={field+' ml-1'} value={q.question_type} onChange={e=>updateQuestion(qi,{question_type:e.target.value,options:e.target.value==='text'?[]:(q.options.length?q.options:[blankOption(),blankOption()])})}><option value="single">Один вариант</option><option value="multiple">Несколько вариантов</option><option value="text">Текстовый ответ</option></select></label>
              <label className="text-xs text-gray-600">Баллы <input type="number" min="1" max="100" className={field+' ml-1 w-20'} value={q.points} onChange={e=>updateQuestion(qi,{points:Number(e.target.value)})}/></label>
            </div>
            {q.question_type!=='text'&&<div className="space-y-2">
              <p className="text-xs text-gray-500">Отметь правильный ответ или ответы.</p>
              {q.options.map((opt, oi)=><div key={oi} className="flex items-center gap-2">
                <input type={q.question_type==='single'?'radio':'checkbox'} checked={opt.is_correct} onChange={e=>updateOption(qi,oi,{is_correct:e.target.checked})} name={`correct-${qi}`}/>
                <input className={field+' flex-1 min-w-0'} required placeholder={`Вариант ${oi+1}`} value={opt.option_text} onChange={e=>updateOption(qi,oi,{option_text:e.target.value})}/>
                {q.options.length>2&&<button type="button" onClick={()=>updateQuestion(qi,{options:q.options.filter((_,i)=>i!==oi)})} className="text-xs text-red-500">×</button>}
              </div>)}
              <button type="button" onClick={()=>updateQuestion(qi,{options:[...q.options,blankOption()]})} className="text-xs text-brand-700 underline">+ Вариант ответа</button>
            </div>}
          </div>)}
          <button type="button" onClick={()=>setQuestions(prev=>[...prev,blankQuestion()])} disabled={questions.length>=100} className="text-sm border border-dashed border-gray-300 rounded-lg px-3 py-2">+ Добавить вопрос</button>
        </div>
        {!subjectsLoading && classSubjects.length===0 && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-2">В расписании этого класса вам не назначен предмет. Попросите администратора привязать вас к предмету, чтобы создавать тесты.</p>}
        <button disabled={busy||subjectsLoading||!classSubjects.length||!form.subject} className="bg-brand-600 text-white rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-60">{busy?'Публикация…':'Опубликовать тест'}</button>
      </form>
      <h3 className="font-semibold text-gray-800 mb-2">Тесты класса</h3>
      {quizzes.length===0?<p className="text-sm text-gray-500">В этом классе пока нет тестов.</p>:<div className="space-y-3">
        {quizzes.map(quiz=><div key={quiz.id} className="border border-gray-100 rounded-xl p-3">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div><p className="font-semibold text-gray-800">{quiz.title}</p><p className="text-xs text-gray-500 mt-1">{quiz.subject||'Без предмета'} · {quiz.questions.length} вопросов · {quiz.duration_minutes?quiz.duration_minutes+' мин.':'Без таймера'} · Срок: {formatDate(quiz.deadline)}</p>
              {quiz.description&&<p className="text-xs text-gray-500 mt-1">{quiz.description}</p>}</div>
            <div className="flex flex-wrap gap-2"><button onClick={()=>toggleAttempts(quiz)} className="border rounded-lg px-3 py-2 text-xs">Ответы учеников</button><button onClick={()=>deactivate(quiz)} className="border border-red-100 text-red-600 rounded-lg px-3 py-2 text-xs">Скрыть</button></div>
          </div>
          {expanded===quiz.id&&<div className="mt-3 border-t pt-3 space-y-3">
            {(attempts[quiz.id]||[]).length===0&&<p className="text-sm text-gray-500">Попыток пока нет.</p>}
            {(attempts[quiz.id]||[]).map(attempt=><div key={attempt.id} className="bg-gray-50 rounded-lg p-3">
              <div className="flex flex-wrap justify-between gap-2"><div><p className="text-sm font-medium">{attempt.student_name||'Ученик'} · попытка {attempt.attempt_number}</p><p className="text-xs text-gray-500">{statusText(attempt.status)} · {formatDate(attempt.submitted_at||attempt.started_at)}</p></div><span className="text-sm font-semibold">{attempt.score}/{attempt.max_score}</span></div>
              <div className="mt-2 space-y-2">{attempt.answers.map(answer=><div key={answer.id} className="border-t border-gray-200 pt-2 text-sm">
                <p className="font-medium">{answer.question_text} <span className="text-xs text-gray-400">({answer.points_available} б.)</span></p>
                {answer.question_type==='text'?<>
                  <p className="text-xs text-gray-600 mt-1 whitespace-pre-wrap">Ответ: {answer.text_answer||'Нет ответа'}</p>
                  <div className="flex flex-wrap gap-2 mt-2"><label className="text-xs">Баллы <input type="number" min="0" max={answer.points_available} className="border rounded px-2 py-1 w-20 ml-1" value={gradeDrafts[attempt.id]?.[answer.id]?.points_awarded??answer.points_awarded??0} onChange={e=>setGradeDrafts(prev=>({...prev,[attempt.id]:{...(prev[attempt.id]||{}),[answer.id]:{...(prev[attempt.id]?.[answer.id]||{}),points_awarded:e.target.value}}}))}/></label><input placeholder="Комментарий к ответу" className="border rounded px-2 py-1 text-xs flex-1 min-w-32" value={gradeDrafts[attempt.id]?.[answer.id]?.feedback??answer.feedback??''} onChange={e=>setGradeDrafts(prev=>({...prev,[attempt.id]:{...(prev[attempt.id]||{}),[answer.id]:{...(prev[attempt.id]?.[answer.id]||{}),feedback:e.target.value}}}))}/></div>
                </>:<p className="text-xs text-gray-600 mt-1">{answer.selected_options.join(', ')||'Ответ не выбран'} · {answer.is_correct?'Верно':'Неверно'} · {answer.points_awarded}/{answer.points_available} б.</p>}
              </div>)}</div>
              {attempt.answers.some(a=>a.question_type==='text')&&<button onClick={()=>gradeAttempt(attempt)} className="mt-3 bg-brand-600 text-white rounded-lg px-3 py-2 text-xs">Сохранить проверку</button>}
            </div>)}
          </div>}
        </div>)}
      </div>}
    </>}
  </section>
}

function StudentQuizCenter() {
  const [quizzes,setQuizzes]=useState([])
  const [activeQuiz,setActiveQuiz]=useState(null)
  const [activeAttempt,setActiveAttempt]=useState(null)
  const [answers,setAnswers]=useState({})
  const [lastResult,setLastResult]=useState(null)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [busy,setBusy]=useState(false)
  const [now,setNow]=useState(Date.now())
  const submitLock=useRef(false)
  const autoSubmitTriggered=useRef(false)

  async function load() { try { setQuizzes(await api.myQuizzes()) } catch (e) { setError(e.message) } }
  useEffect(()=>{load()},[])
  useEffect(()=>{
    if(!activeAttempt)return
    const timer=window.setInterval(()=>setNow(Date.now()),1000)
    return ()=>window.clearInterval(timer)
  },[activeAttempt?.id])
  useEffect(()=>{
    if(!activeAttempt)return
    try { window.localStorage.setItem(`homelyceum7-quiz-${activeAttempt.id}`, JSON.stringify(answers)) } catch (_) {}
  },[answers,activeAttempt?.id])
  const remaining = activeQuiz&&activeAttempt&&activeQuiz.duration_minutes
    ? Math.max(0,Math.ceil((parseUtcDate(activeAttempt.started_at).getTime()+activeQuiz.duration_minutes*60000-now)/1000))
    : null

  async function start(quiz) {
    setError('');setNotice('');setLastResult(null);setBusy(true)
    try{
      const attempt=await api.startQuiz(quiz.id)
      let savedAnswers = {}
      try { savedAnswers = JSON.parse(window.localStorage.getItem(`homelyceum7-quiz-${attempt.id}`) || '{}') } catch (_) {}
      setAnswers(savedAnswers && typeof savedAnswers === 'object' ? savedAnswers : {})
      setActiveQuiz(quiz);setActiveAttempt(attempt);submitLock.current=false;autoSubmitTriggered.current=false;setNow(Date.now())
    }catch(e){setError(e.message);await load()}finally{setBusy(false)}
  }
  async function submit(auto=false) {
    if(!activeAttempt||submitLock.current)return
    submitLock.current=true;setBusy(true);setError('')
    try{
      const payload=(activeQuiz.questions||[]).map(q=>({question_id:q.id,selected_option_ids:answers[q.id]?.selected_option_ids||[],text_answer:answers[q.id]?.text_answer||''}))
      const result=await api.submitQuizAttempt(activeAttempt.id,payload)
      try { window.localStorage.removeItem(`homelyceum7-quiz-${activeAttempt.id}`) } catch (_) {}
      setLastResult(result);setActiveQuiz(null);setActiveAttempt(null);setAnswers({})
      setNotice(auto?'Время закончилось — ответы отправлены.':'Тест отправлен.')
      await load()
    }catch(e){setError(e.message);submitLock.current=false}
    finally{setBusy(false)}
  }
  function choose(question,optionId) {
    setAnswers(prev=>{
      const old=prev[question.id]?.selected_option_ids||[]
      let ids
      if(question.question_type==='single')ids=[optionId]
      else ids=old.includes(optionId)?old.filter(id=>id!==optionId):[...old,optionId]
      return {...prev,[question.id]:{...(prev[question.id]||{}),selected_option_ids:ids}}
    })
  }
  useEffect(()=>{if(activeAttempt&&remaining===0&&!busy&&!submitLock.current&&!autoSubmitTriggered.current){autoSubmitTriggered.current=true;submit(true)}},[remaining,activeAttempt,busy])

  return <section className="mt-5 bg-white rounded-2xl border border-gray-100 shadow-card p-4 sm:p-5">
    <div className="flex items-center justify-between gap-2 mb-4"><div><h2 className="text-lg font-semibold text-gray-800">🧠 Онлайн-тесты и контрольные</h2><p className="text-xs text-gray-500 mt-1">Проходи тесты, следи за временем и смотри результаты.</p></div><button onClick={load} className="text-xs border rounded-lg px-3 py-2">Обновить</button></div>
    {error&&<p className="text-sm text-red-600 bg-red-50 rounded-lg p-3 mb-3">{error}</p>}{notice&&<p className="text-sm text-emerald-700 bg-emerald-50 rounded-lg p-3 mb-3">{notice}</p>}
    {lastResult&&<div className="rounded-xl border border-brand-100 bg-brand-50/40 p-4 mb-4"><p className="font-semibold text-gray-800">Результат последней попытки</p><p className="text-2xl font-bold text-brand-700 mt-1">{lastResult.score}/{lastResult.max_score} баллов</p><p className="text-xs text-gray-600 mt-1">{statusText(lastResult.status)}{lastResult.status==='pending_review'?' — результат уточнится после проверки текстовых ответов.':''}</p></div>}
    {activeQuiz&&activeAttempt?<div>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-4 border-b pb-3"><div><h3 className="font-semibold text-gray-800">{activeQuiz.title}</h3><p className="text-xs text-gray-500">{activeQuiz.subject} · Попытка {activeAttempt.attempt_number}</p><p className="text-xs text-gray-500 mt-1">{activeQuiz.description}</p></div>
      {remaining!==null&&<div className={`rounded-lg px-3 py-2 font-mono text-lg font-bold ${remaining<60?'bg-red-50 text-red-700':'bg-gray-100 text-gray-800'}`}>⏱ {durationLabel(remaining)}</div>}</div>
      <div className="space-y-4">{activeQuiz.questions.map((q,idx)=><div key={q.id} className="rounded-xl border border-gray-100 p-3 sm:p-4"><p className="text-xs text-gray-400 mb-1">Вопрос {idx+1} · {q.points} б.</p><p className="font-medium text-gray-800 whitespace-pre-wrap">{q.question_text}</p>
        {q.question_type==='text'?<textarea rows={4} className={field+' w-full mt-3'} placeholder="Введи развёрнутый ответ" value={answers[q.id]?.text_answer||''} onChange={e=>setAnswers(prev=>({...prev,[q.id]:{...(prev[q.id]||{}),text_answer:e.target.value}}))}/>:
        <div className="space-y-2 mt-3">{q.options.map(opt=><label key={opt.id} className="flex items-start gap-2 rounded-lg bg-gray-50 hover:bg-gray-100 p-3 text-sm cursor-pointer"><input className="mt-0.5" type={q.question_type==='single'?'radio':'checkbox'} name={`question-${q.id}`} checked={(answers[q.id]?.selected_option_ids||[]).includes(opt.id)} onChange={()=>choose(q,opt.id)}/><span>{opt.option_text}</span></label>)}</div>}
      </div>)}</div>
      <button disabled={busy} onClick={()=>submit(false)} className="mt-4 bg-brand-600 text-white rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-60">{busy?'Отправка…':'Сдать тест'}</button>
    </div>:quizzes.length===0?<p className="text-sm text-gray-500">Пока нет опубликованных тестов.</p>:<div className="space-y-3">
      {quizzes.map(quiz=><div key={quiz.id} className="border border-gray-100 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0"><p className="font-semibold text-gray-800">{quiz.title}</p><p className="text-xs text-gray-500 mt-1">{quiz.subject||'Без предмета'} · {quiz.questions.length} вопросов · {quiz.duration_minutes?quiz.duration_minutes+' мин.':'Без таймера'} · Срок: {formatDate(quiz.deadline)}</p>
          {quiz.description&&<p className="text-sm text-gray-600 mt-1">{quiz.description}</p>}
          {quiz.latest_attempt_status&&<p className="text-xs mt-2 text-gray-600">{statusText(quiz.latest_attempt_status)}{quiz.latest_score!==null&&quiz.latest_score!==undefined?` · ${quiz.latest_score}/${quiz.latest_max_score}`:''} · Попыток: {quiz.attempts_used}/{quiz.attempts_allowed}</p>}
        </div>
        <button disabled={!quiz.can_attempt||busy} onClick={()=>start(quiz)} className="shrink-0 bg-brand-600 text-white rounded-lg px-4 py-2 text-sm disabled:bg-gray-200 disabled:text-gray-400">{quiz.latest_attempt_status==='in_progress'?'Продолжить':'Начать тест'}</button>
      </div>)}
    </div>}
  </section>
}
