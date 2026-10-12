import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import ClassManager from '../components/ClassManager.jsx'
import LearningTools from '../components/LearningTools.jsx'

const empty = () => ({subject:'', title:'', description:'', deadline:'', allow_resubmission:true, max_attempts:3})
const field = 'border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500'
const localDateTime = value => { const d = new Date(value); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16) }

export default function TeacherDashboard() {
 const [selectedClass,setSelectedClass]=useState(null), [assignments,setAssignments]=useState([]), [students,setStudents]=useState([])
 const [error,setError]=useState(''), [notice,setNotice]=useState(''), [form,setForm]=useState(empty), [files,setFiles]=useState([])
 const [editingId,setEditingId]=useState(null), [keepIds,setKeepIds]=useState([]), [expanded,setExpanded]=useState(null), [subs,setSubs]=useState({})
 useEffect(()=>{api.listStudents().then(setStudents).catch(e=>setError(e.message))},[])
 useEffect(()=>{if(selectedClass)api.listClassAssignments(selectedClass).then(setAssignments).catch(e=>setError(e.message));else setAssignments([]);setExpanded(null);setSubs({});cancelEdit()},[selectedClass])
 function cancelEdit(){setEditingId(null);setForm(empty());setFiles([]);setKeepIds([])}
 function edit(a){setEditingId(a.id);setForm({subject:a.subject||'',title:a.title,description:a.description||'',deadline:localDateTime(a.deadline),allow_resubmission:a.allow_resubmission!==false,max_attempts:a.max_attempts||3});setFiles([]);setKeepIds((a.attachments||[]).filter(x=>x.is_active).map(x=>x.id));setError('');setNotice('')}
 async function save(e){e.preventDefault();setError('');setNotice('');if(files.length+keepIds.length>10){setError('Можно оставить и добавить не более 10 файлов.');return}
 try{const payload={...form,deadline:new Date(form.deadline).toISOString(),max_attempts:Number(form.max_attempts),files}
 if(editingId){const result=await api.updateAssignment(editingId,{...payload,keep_attachment_ids:keepIds});setAssignments(prev=>prev.map(a=>a.id===result.id?result:a));setNotice('Задание обновлено. Ученики и родители уведомлены.')}
 else{const result=await api.createAssignment({...payload,class_id:selectedClass});setAssignments(prev=>[...prev,result].sort((a,b)=>new Date(a.deadline)-new Date(b.deadline)));setNotice('Задание создано. Ученики и родители уведомлены.')}
 cancelEdit()
 }catch(e){setError(e.message)}}
 async function remove(a){if(!window.confirm(`Убрать задание «${a.title}» из активного списка? История сдач сохранится.`))return
 try{await api.deleteAssignment(a.id);setAssignments(prev=>prev.filter(x=>x.id!==a.id));if(editingId===a.id)cancelEdit();setNotice('Задание скрыто; история сдач сохранена.')}catch(e){setError(e.message)}}
 async function toggleSubs(id){if(expanded===id){setExpanded(null);return}setExpanded(id);if(!subs[id]){try{const data=await api.submissionsForAssignment(id);setSubs(prev=>({...prev,[id]:data}))}catch(e){setError(e.message)}}}
 async function grade(submissionId,assignmentId,value,feedback){try{const updated=await api.gradeSubmission(submissionId,Number(value),feedback);setSubs(prev=>({...prev,[assignmentId]:(prev[assignmentId]||[]).map(s=>s.id===submissionId?updated:s)}));setNotice('Оценка сохранена, ученик и родитель уведомлены.')}catch(e){setError(e.message)}}
 const studentName=id=>students.find(s=>s.id===id)?.full_name||`Ученик #${id}`
 return <div className="p-4 sm:p-6 max-w-6xl mx-auto animate-fade-in">
 <h1 className="text-2xl font-bold text-gray-800 mb-5">🧑‍🏫 Кабинет учителя</h1>
 {error&&<p className="text-red-600 text-sm mb-3 bg-red-50 border border-red-100 rounded-lg p-3">{error}</p>}{notice&&<p className="text-emerald-700 text-sm mb-3 bg-emerald-50 border border-emerald-100 rounded-lg p-3">{notice}</p>}
 <div className="grid md:grid-cols-3 gap-5"><ClassManager onSelectClass={setSelectedClass}/><div className="md:col-span-2 flex flex-col gap-4">
 {selectedClass&&<section className="bg-white rounded-xl shadow-card p-4"><h2 className="font-semibold mb-3">{editingId?'✏️ Редактирование задания':'✏️ Новое задание'}</h2>
 <form onSubmit={save} className="grid sm:grid-cols-2 gap-3">
 <input className={field} placeholder="Предмет" value={form.subject} onChange={e=>setForm(f=>({...f,subject:e.target.value}))}/>
 <input className={field} type="datetime-local" required value={form.deadline} onChange={e=>setForm(f=>({...f,deadline:e.target.value}))}/>
 <input className={field+' sm:col-span-2'} placeholder="Название задания" required value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))}/>
 <textarea className={field+' sm:col-span-2'} rows={3} placeholder="Описание" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}/>
 {editingId&&<div className="sm:col-span-2 border rounded-lg p-3"><p className="text-sm font-medium mb-2">Сохранить текущие вложения</p>
 {(assignments.find(a=>a.id===editingId)?.attachments||[]).filter(a=>a.is_active).map(a=><label key={a.id} className="flex gap-2 py-1 text-sm"><input type="checkbox" checked={keepIds.includes(a.id)} onChange={e=>setKeepIds(ids=>e.target.checked?[...ids,a.id]:ids.filter(id=>id!==a.id))}/>{a.original_filename}</label>)}</div>}
 <div className="sm:col-span-2"><label className="block text-sm font-medium mb-1">Вложения — до 10 файлов, до 20 МБ каждый</label><input type="file" multiple onChange={e=>setFiles(Array.from(e.target.files||[]).slice(0,10))} className="text-sm w-full"/>
 {files.length>0&&<p className="text-xs text-gray-500 mt-1">{files.length} новых: {files.map(f=>f.name).join(', ')}</p>}</div>
 <label className="sm:col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={form.allow_resubmission} onChange={e=>setForm(f=>({...f,allow_resubmission:e.target.checked}))}/>Разрешить повторную сдачу</label>
 <label className="flex items-center gap-2 text-sm">Попыток <select className={field} disabled={!form.allow_resubmission} value={form.max_attempts} onChange={e=>setForm(f=>({...f,max_attempts:Number(e.target.value)}))}>{[2,3,4,5,10,20].map(n=><option key={n}>{n}</option>)}</select></label>
 <div className="sm:col-span-2 flex gap-2"><button className="bg-brand-600 text-white rounded-lg px-4 py-2 text-sm">{editingId?'Сохранить изменения':'Создать задание'}</button>{editingId&&<button type="button" onClick={cancelEdit} className="border rounded-lg px-4 py-2 text-sm">Отмена</button>}</div>
 </form></section>}
 {assignments.map(a=>{const active=(a.attachments||[]).filter(x=>x.is_active);const filesToShow=active.length?active:(a.file_path?[{file_path:a.file_path,original_filename:a.original_filename}]:[]);const work=subs[a.id]||[]
 return <article key={a.id} className="bg-white rounded-xl shadow-card p-4"><div className="flex flex-col sm:flex-row sm:justify-between gap-3"><div className="min-w-0"><p className="text-xs uppercase text-brand-700 font-semibold">{a.subject||'Без предмета'}</p><h3 className="font-semibold text-gray-800">{a.title}</h3>{a.description&&<p className="text-sm text-gray-500 mt-1 whitespace-pre-wrap">{a.description}</p>}
 <p className="text-xs text-gray-400 mt-1">Срок: {new Date(a.deadline).toLocaleString('ru-RU')} · {a.allow_resubmission===false?'Без повторной сдачи':`Попыток: ${a.max_attempts||3}`}</p><div className="flex flex-wrap gap-2 mt-2">{filesToShow.map((f,i)=><a key={f.id||f.file_path||i} href={api.fileUrl(f.file_path)} target="_blank" rel="noreferrer" className="text-xs text-brand-700 underline">📎 {f.original_filename||'Вложение'}</a>)}</div></div>
 <div className="flex flex-wrap gap-2 shrink-0"><button onClick={()=>edit(a)} className="border rounded-lg px-3 py-2 text-xs">✏️ Изменить</button><button onClick={()=>remove(a)} className="border border-red-100 text-red-600 rounded-lg px-3 py-2 text-xs">Удалить</button><button onClick={()=>toggleSubs(a.id)} className="bg-brand-50 text-brand-700 rounded-lg px-3 py-2 text-xs">{expanded===a.id?'Скрыть работы':`Работы · ${work.length||'проверить'}`}</button></div></div>
 {expanded===a.id&&<div className="border-t mt-3 pt-3 space-y-2">{work.length===0&&<p className="text-sm text-gray-500">Пока никто не сдал работу.</p>}{work.map(s=><SubmissionRow key={s.id} submission={s} studentName={studentName(s.student_id)} onGrade={(g,f)=>grade(s.id,a.id,g,f)}/>)}</div>}
 </article>})}
 {!selectedClass&&<p className="bg-white rounded-xl p-5 text-sm text-gray-500">Выберите класс для управления заданиями.</p>}
 {selectedClass&&assignments.length===0&&<p className="bg-white rounded-xl p-5 text-sm text-gray-500">В этом классе пока нет заданий.</p>}
 </div></div><LearningTools role="teacher"/>
 </div>
}
function SubmissionRow({submission,studentName,onGrade}){
 const [value,setValue]=useState(submission.grade||''),[feedback,setFeedback]=useState(submission.teacher_feedback||'')
 const current=(submission.attachments||[]).filter(a=>a.is_current);const files=current.length?current:(submission.file_path?[{file_path:submission.file_path,original_filename:submission.original_filename}]:[])
 return <div className="bg-gray-50 rounded-lg p-3 text-sm"><div className="flex flex-col sm:flex-row sm:justify-between gap-2"><div><p className="font-medium">{studentName} · {submission.grade!=null?`Оценка ${submission.grade}/10`:'На проверке'}</p><p className="text-xs text-gray-400">Попытка {submission.attempt_count||1} · {new Date(submission.submitted_at).toLocaleString('ru-RU')}</p><div className="flex flex-wrap gap-2 mt-1">{files.map((f,i)=><a key={f.id||f.file_path||i} href={api.fileUrl(f.file_path)} target="_blank" rel="noreferrer" className="text-xs text-brand-700 underline">{f.original_filename||'Файл ученика'}</a>)}</div>{submission.comment&&<p className="text-xs text-gray-500 mt-1">💬 {submission.comment}</p>}</div><div className="flex flex-wrap gap-2 items-center"><select value={value} onChange={e=>setValue(e.target.value)} className="border rounded px-2 py-1"><option value="">—</option>{[1,2,3,4,5,6,7,8,9,10].map(n=><option key={n}>{n}</option>)}</select><input placeholder="Комментарий" value={feedback} onChange={e=>setFeedback(e.target.value)} className="border rounded px-2 py-1 min-w-28"/><button disabled={!value} onClick={()=>onGrade(value,feedback)} className="bg-brand-600 text-white rounded px-3 py-1.5 text-xs disabled:opacity-50">Сохранить</button></div></div></div>
}
