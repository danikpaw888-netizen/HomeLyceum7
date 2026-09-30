import React from 'react'
import { Link } from 'react-router-dom'

const BENEFITS = [
  {
    icon: '📚',
    title: 'Гибкий график',
    desc: 'Ученик выполняет задания в удобном темпе, без привязки к жёсткому расписанию очных уроков.',
    color: 'bg-brand-50 text-brand-600 border-brand-100',
  },
  {
    icon: '🧑‍🏫',
    title: 'Учителя лицея',
    desc: 'Занятия и проверку работ ведут те же преподаватели, что и в очных классах лицея №7.',
    color: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  },
  {
    icon: '📊',
    title: 'Прозрачная успеваемость',
    desc: 'Оценки по 10-балльной шкале, посещаемость и комментарии учителя — всегда под рукой.',
    color: 'bg-amber-50 text-amber-600 border-amber-100',
  },
  {
    icon: '📎',
    title: 'Всё в одном месте',
    desc: 'Задания, файлы, расписание уроков и оценки собраны в едином личном кабинете.',
    color: 'bg-purple-50 text-purple-600 border-purple-100',
  },
  {
    icon: '👨‍👩‍👧',
    title: 'Связь с родителями',
    desc: 'Родители видят успехи ребёнка, посещаемость и статус домашнего обучения в реальном времени.',
    color: 'bg-rose-50 text-rose-600 border-rose-100',
  },
  {
    icon: '🔒',
    title: 'Безопасный доступ',
    desc: 'Личный кабинет только для учеников, учителей и родителей лицея — по email и паролю.',
    color: 'bg-sky-50 text-sky-600 border-sky-100',
  },
]

const STEPS = [
  {
    num: '1',
    title: 'Учитель создаёт класс и задания',
    desc: 'Формирует состав класса, публикует домашние задания с материалами и сроками сдачи.',
  },
  {
    num: '2',
    title: 'Ученик учится и сдаёт работы',
    desc: 'Получает задания в «Дневнике», прикрепляет решения и следит за расписанием уроков.',
  },
  {
    num: '3',
    title: 'Родители следят за прогрессом',
    desc: 'Видят оценки по каждому предмету, посещаемость и любые изменения статуса обучения.',
  },
]

export default function Landing() {
  return (
    <div className="min-h-screen bg-white overflow-x-hidden">
      {/* Кнопка входа в углу */}
      <Link
        to="/login"
        className="fixed top-4 right-4 sm:top-6 sm:right-6 z-50 bg-white/95 backdrop-blur border border-gray-200 text-brand-700 font-medium text-sm px-4 py-2 rounded-full shadow-card hover:shadow-card-hover hover:bg-white transition active:scale-95"
      >
        Войти
      </Link>

      {/* Hero */}
      <section className="relative bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 text-white overflow-hidden">
        <div className="absolute -top-24 -left-24 w-72 h-72 bg-white/10 rounded-full blur-3xl" />
        <div className="absolute top-1/3 -right-20 w-80 h-80 bg-amber-300/20 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-1/3 w-64 h-64 bg-emerald-300/10 rounded-full blur-3xl" />

        <div className="relative max-w-4xl mx-auto px-6 pt-20 pb-24 sm:pt-28 sm:pb-32 text-center animate-fade-in">
          <img
            src="/logo.png"
            alt="HomeLyceum7"
            className="w-24 h-24 sm:w-28 sm:h-28 mx-auto rounded-full bg-white/90 p-1.5 shadow-lg object-contain animate-scale-in"
          />
          <h1 className="mt-6 text-4xl sm:text-5xl font-extrabold tracking-tight">HomeLyceum7</h1>
          <div className="mt-4 max-w-md mx-auto text-white/90 space-y-2">
            <p className="text-lg sm:text-xl font-medium leading-snug">
              Индивидуальное обучение
              <br />
              для учащихся школы
              <br />
              <strong>Лицей №7 имени Н.А. Марабаева</strong>
            </p>
            <p className="text-sm sm:text-base text-white/75 leading-relaxed pt-1">
              Цифровая среда для домашнего обучения, занятий и контроля прогресса.
              <br />
              Учебные материалы, задания, оценки, расписание и документы — в одном защищённом кабинете.
            </p>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/register"
              className="bg-white text-brand-700 font-semibold px-6 py-3 rounded-full shadow-lg hover:shadow-xl hover:-translate-y-0.5 active:scale-95 transition"
            >
              Зарегистрироваться
            </Link>
            <Link
              to="/login"
              className="bg-white/10 border border-white/30 text-white font-semibold px-6 py-3 rounded-full hover:bg-white/20 active:scale-95 transition"
            >
              У меня уже есть аккаунт
            </Link>
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-2.5 text-xs sm:text-sm">
            {['🏫 Лицей №7 им. Н.А. Марабаева', '💻 Полностью онлайн', '👨‍🏫 Учителя лицея', '🕒 Гибкий график'].map((t) => (
              <span key={t} className="bg-white/10 border border-white/20 px-3 py-1.5 rounded-full">
                {t}
              </span>
            ))}
          </div>
        </div>

        <svg viewBox="0 0 1440 80" className="relative block w-full text-white" fill="currentColor">
          <path d="M0,32 C360,80 1080,0 1440,48 L1440,80 L0,80 Z" />
        </svg>
      </section>

      {/* Преимущества */}
      <section className="max-w-5xl mx-auto px-6 py-16 sm:py-20">
        <div className="text-center mb-12 animate-fade-in-up">
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-800">Всё необходимое для домашнего обучения</h2>
          <p className="text-gray-500 mt-2 max-w-xl mx-auto">
            Платформа объединяет учебный процесс, документы и коммуникацию школы с учеником и семьёй — от оформления домашнего обучения до ежедневной работы с заданиями.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {BENEFITS.map((b, i) => (
            <div
              key={b.title}
              className="bg-white rounded-2xl shadow-card hover:shadow-card-hover transition-shadow p-5 animate-fade-in-up"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className={`w-11 h-11 rounded-xl border flex items-center justify-center text-xl mb-3 ${b.color}`}>
                {b.icon}
              </div>
              <h3 className="font-semibold text-gray-800 mb-1.5">{b.title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{b.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Как это работает */}
      <section className="bg-gray-50 py-16 sm:py-20">
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center mb-12 animate-fade-in-up">
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-800">Как это работает</h2>
          </div>
          <div className="grid sm:grid-cols-3 gap-6">
            {STEPS.map((s) => (
              <div key={s.num} className="text-center animate-fade-in-up">
                <div className="w-12 h-12 rounded-full bg-brand-600 text-white font-bold text-lg flex items-center justify-center mx-auto shadow-md mb-4">
                  {s.num}
                </div>
                <h3 className="font-semibold text-gray-800 mb-1.5">{s.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Финальный призыв к действию */}
      <section className="relative bg-gradient-to-br from-brand-600 to-brand-700 text-white py-16 sm:py-20 overflow-hidden">
        <div className="absolute -bottom-16 -right-16 w-64 h-64 bg-white/10 rounded-full blur-3xl" />
        <div className="relative max-w-2xl mx-auto px-6 text-center animate-fade-in-up">
          <h2 className="text-2xl sm:text-3xl font-bold mb-3">Готовы начать?</h2>
          <p className="text-white/85 mb-8">
            Войдите в личный кабинет или зарегистрируйтесь — это займёт меньше минуты.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/register"
              className="bg-white text-brand-700 font-semibold px-6 py-3 rounded-full shadow-lg hover:shadow-xl hover:-translate-y-0.5 active:scale-95 transition"
            >
              Зарегистрироваться
            </Link>
            <Link
              to="/login"
              className="bg-white/10 border border-white/30 text-white font-semibold px-6 py-3 rounded-full hover:bg-white/20 active:scale-95 transition"
            >
              Войти
            </Link>
          </div>
        </div>
      </section>

      <footer className="bg-white py-8 text-center text-xs text-gray-400">
        <img src="/logo.png" alt="HomeLyceum7" className="w-8 h-8 mx-auto mb-2 object-contain opacity-80" />
        <p>HomeLyceum7 · Школа-лицей №7 имени Н.А. Марабаева</p>
      </footer>
    </div>
  )
}
