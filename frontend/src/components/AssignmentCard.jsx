import React, { useState } from 'react'
import { api } from '../api.js'

const dateLabel = iso => new Date(iso).toLocaleString('ru-RU', { dateStyle:'medium', timeStyle:'short' })
function gradeColor(grade) { if (grade>=9) return 'text-emerald-700 bg-emerald-50 border-emerald-200'; if (grade>=7) return 'text-brand-700 bg-brand-50 border-brand-200'; if (grade>=5) return 'text-amber-700 bg-amber-50 border-amber-200'; return 'text-red-700 bg-red-50 border-red-200' }

export default function AssignmentCard({ assignment, submission, onSubmitted }) {
 const [files,setFiles]=useState([]),[comment,setComment]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const overdue=new Date(assignment.deadline).getTime()<Date.now(), graded=submission?.grade!=null
 const attempts=submission?.attempt_count||1, maxAttempts=assignment.max_attempts||3
 const canResubmit=!!submission&&assignment.allow_resubmission!==false&&attempts<maxAttempts
 const activeFiles=(assignment.attachments||[]).filter(f=>f.is_active)
 const shownFiles=activeFiles.length?activeFiles:(assignment.file_path?[{file_path:assignment.file_path,original_filename:assignment.original_filename}]:[])
 async function submit(e){e.preventDefault();setError('');setBusy(true)
 try{const result=await api.submitHomework(assignment.id,{comment,files});onSubmitted?.(result);setFiles([]);setComment('')}
 catch(e){setError(e.message)}finally{setBusy(false)}}
 const submittedFiles=(submission?.attachments||[]).filter(f=>f.is_current)
 const shownSubmissionFiles=submittedFiles.length?submittedFiles:(submission?.file_path?[{file_path:submission.file_path,original_filename:submission.original_filename}]:[])
 return <article className="bg-white p-5 rounded-xl shadow-card border-l-4 border-brand-500">
 <div className="flex justify-between items-start gap-3 flex-wrap"><div>{assignment.subject&&<p className="text-xs font-bold text-brand-700 uppercase tracking-wide">{assignment.subject}</p>}<h2 className="font-semibold text-gray-800 mt-0.5">{assignment.title}</h2></div>
 <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${overdue?'text-red-600 bg-red-50 border-red-100':'text-amber-700 bg-amber-50 border-amber-100'}`}>{overdue?'⏰ Просрочено':'📅 Срок'} · {dateLabel(assignment.deadline)}</span></div>
 {assignment.description&&<p className="mt-3 text-gray-600 text-sm leading-relaxed whitespace-pre-wrap">{assignment.description}</p>}
 {shownFiles.length>0&&<div className="mt-3 flex flex-wrap gap-2">{shownFiles.map((f,i)=><a key={f.id||f.file_path||i} href={api.fileUrl(f.file_path)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 bg-brand-50 hover:bg-brand-100 px-2.5 py-1.5 rounded-md">📎 {f.original_filename||'Материал от учителя'}</a>)}</div>}
 {submission&&<div className="mt-4 bg-gray-50 rounded-lg p-3.5 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium text-gray-700">{graded?'✅ Проверено':'⏳ На проверке'} · Попытка {attempts}{assignment.allow_resubmission!==false? ` из ${maxAttempts}`:''}</p>{graded&&<span className={`font-bold px-2.5 py-1 rounded-md border ${gradeColor(submission.grade)}`}>{submission.grade}/10</span>}</div>
 <div className="flex flex-wrap gap-2 mt-2">{shownSubmissionFiles.map((f,i)=><a key={f.id||f.file_path||i} href={api.fileUrl(f.file_path)} target="_blank" rel="noreferrer" className="text-xs text-brand-600 underline">{f.original_filename||'Открыть мой файл'}</a>)}</div>
 {submission.comment&&<p className="text-xs text-gray-500 mt-2">Комментарий: {submission.comment}</p>}{submission.teacher_feedback&&<p className="text-xs text-gray-700 mt-2">Ответ учителя: {submission.teacher_feedback}</p>}
 {canResubmit&&<p className="text-xs text-gray-500 mt-2">Можно отправить исправленный вариант. Предыдущая попытка останется в истории.</p>}
 {submission&&!canResubmit&&assignment.allow_resubmission!==false&&<p className="text-xs text-gray-500 mt-2">Лимит попыток исчерпан.</p>}
 </div>}
 {(!submission||canResubmit)&&<form onSubmit={submit} className="mt-4 flex flex-col gap-2">
 <label className="text-xs font-medium text-gray-600">{submission?'Файлы для повторной сдачи':'Файлы решения'} (до 10 файлов, 20 МБ каждый)</label>
 <input type="file" multiple onChange={e=>setFiles(Array.from(e.target.files||[]).slice(0,10))} className="text-sm text-gray-500 file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-brand-50 file:text-brand-700"/>
 {files.length>0&&<p className="text-xs text-gray-500">{files.length} файлов: {files.map(f=>f.name).join(', ')}</p>}
 <input type="text" placeholder="Комментарий (необязательно)" value={comment} onChange={e=>setComment(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"/>
 {error&&<p className="text-red-600 text-xs bg-red-50 rounded-md px-2 py-1">{error}</p>}
 <button type="submit" disabled={busy} className="bg-brand-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-brand-700 transition w-full sm:w-auto disabled:opacity-60">{busy?'Отправка…':submission?'Отправить исправленный вариант':'Отправить решение'}</button>
 </form>}
 </article>
}
