const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

function getToken() {
  return localStorage.getItem('token')
}

async function request(path, { method = 'GET', body, isForm = false } = {}) {
  const headers = {}
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (!isForm && body) headers['Content-Type'] = 'application/json'

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    let detail = 'Ошибка запроса'
    try {
      const data = await res.json()
      detail = data.detail || detail
    } catch (_) {}
    throw new Error(detail)
  }

  if (res.status === 204) return null
  return res.json()
}

export const api = {
  // --- auth ---
  async login(email, password) {
    const form = new URLSearchParams()
    form.append('username', email)
    form.append('password', password)
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.detail || 'Неверный email или пароль')
    }
    return res.json()
  },
  async register(payload) {
    const data = await request('/auth/register', { method: 'POST', body: payload })
    if (!data.access_token) throw new Error(data.message || 'Заявка отправлена на проверку администратору')
    return data
  },
  me() {
    return request('/users/me')
  },

  // --- classes ---
  listClasses() {
    return request('/classes/')
  },
  createClass(name) {
    return request('/classes/', { method: 'POST', body: { name } })
  },
  updateClass(classId, name) {
    return request(`/classes/${classId}`, { method: 'PUT', body: { name } })
  },
  deleteClass(classId) {
    return request(`/classes/${classId}`, { method: 'DELETE' })
  },
  enrollStudent(classId, studentId) {
    return request(`/classes/${classId}/enroll`, { method: 'POST', body: { student_id: studentId } })
  },
  listStudents() {
    return request('/users/?role=student')
  },
  studentsWithoutClass() {
    return request('/users/students-without-class')
  },
  classStudents(classId) {
    return request(`/classes/${classId}/students`)
  },
  studentCandidates(classId) {
    return request(`/classes/student-candidates?class_id=${classId}`)
  },
  studentClassHistory(studentId) {
    return request(`/classes/student/${studentId}/history`)
  },
  unenrollStudent(classId, studentId) {
    return request(`/classes/${classId}/enroll/${studentId}`, { method: 'DELETE' })
  },
  listUsers(role) {
    return request(`/users/?role=${role}`)
  },
  pendingUsers() {
    return request('/users/pending')
  },
  updateUserApproval(userId, approved) {
    return request(`/users/${userId}/approval`, { method: 'PUT', body: { approved } })
  },

  myChildren() {
    return request('/users/my-children')
  },
  linkParent(parentId, studentId) {
    return request('/classes/link-parent', { method: 'POST', body: { parent_id: parentId, student_id: studentId } })
  },

  // --- assignments ---
  listClassAssignments(classId) {
    return request(`/assignments/class/${classId}`)
  },
  myFeed() {
    return request('/assignments/my/feed')
  },
  createAssignment({ class_id, subject, title, description, deadline, file }) {
    const form = new FormData()
    form.append('class_id', class_id)
    form.append('subject', subject || '')
    form.append('title', title)
    form.append('description', description || '')
    form.append('deadline', deadline)
    if (file) form.append('file', file)
    return request('/assignments/', { method: 'POST', body: form, isForm: true })
  },

  // --- submissions ---
  async submitHomework(assignmentId, { comment, file }) {
    const form = new FormData()
    form.append('comment', comment || '')
    if (file) form.append('file', file)
    return request(`/submissions/${assignmentId}`, { method: 'POST', body: form, isForm: true })
  },
  mySubmissions() {
    return request('/submissions/my')
  },
  submissionsForAssignment(assignmentId) {
    return request(`/submissions/assignment/${assignmentId}`)
  },
  gradeSubmission(submissionId, grade, teacher_feedback) {
    return request(`/submissions/${submissionId}/grade`, {
      method: 'PUT',
      body: { grade, teacher_feedback },
    })
  },
  childSubmissions(studentId) {
    return request(`/submissions/child/${studentId}`)
  },

  fileUrl(path) {
    return path ? `${API_URL}${path}` : null
  },

  // --- gradebook (журнал: оценки, посещаемость, ростер класса) ---
  classRoster(classId) {
    return request(`/gradebook/class/${classId}/roster`)
  },
  addGrade(payload) {
    return request('/gradebook/grades', { method: 'POST', body: payload })
  },
  deleteGrade(gradeId) {
    return request(`/gradebook/grades/${gradeId}`, { method: 'DELETE' })
  },
  markAttendance(payload) {
    return request('/gradebook/attendance', { method: 'POST', body: payload })
  },
  studentGrades(studentId) {
    return request(`/gradebook/grades/student/${studentId}`)
  },
  studentAttendance(studentId) {
    return request(`/gradebook/attendance/student/${studentId}`)
  },
  journalClasses() {
    return request('/gradebook/classes')
  },
  updateGrade(gradeId, payload) {
    return request(`/gradebook/grades/${gradeId}`, { method: 'PUT', body: payload })
  },

  // --- schedule (расписание) ---
  mySchedule() {
    return request('/schedule/my')
  },
  classSchedule(classId) {
    return request(`/schedule/class/${classId}`)
  },
  createLesson(payload) {
    return request('/schedule/', { method: 'POST', body: payload })
  },
  updateLesson(lessonId, payload) {
    return request(`/schedule/${lessonId}`, { method: 'PUT', body: payload })
  },
  deleteLesson(lessonId) {
    return request(`/schedule/${lessonId}`, { method: 'DELETE' })
  },

  // --- homeschool (домашнее обучение) ---
  async createHomeschoolRecord({ student_id, reason, start_date, notes, documents = [] }) {
    const form = new FormData()
    form.append('student_id', student_id)
    form.append('reason', reason)
    form.append('start_date', start_date)
    form.append('notes', notes || '')
    const record = await request('/homeschool/', { method: 'POST', body: form, isForm: true })

    const uploaded = []
    const uploadErrors = []
    for (const item of documents) {
      if (!item?.file || !item.file.name) continue
      try {
        const doc = await this.addHomeschoolDocument(record.id, {
          document_type: item.document_type,
          title: item.title,
          file: item.file,
        })
        uploaded.push(doc)
      } catch (error) {
        uploadErrors.push({ title: item.title, message: error.message })
      }
    }

    return { ...record, documents: [...(record.documents || []), ...uploaded], uploadErrors }
  },
  addHomeschoolDocument(recordId, { document_type, title, file }) {
    const form = new FormData()
    form.append('document_type', document_type)
    form.append('title', title)
    form.append('file', file)
    return request(`/homeschool/${recordId}/documents`, { method: 'POST', body: form, isForm: true })
  },
  allHomeschoolRecords() {
    return request('/homeschool/admin/all')
  },
  closeHomeschoolRecord(recordId, payload) {
    return request(`/homeschool/${recordId}/close`, { method: 'PUT', body: payload })
  },
  homeschoolRecords(studentId) {
    return request(`/homeschool/student/${studentId}`)
  },

}
