from collections import defaultdict
from datetime import datetime, time

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..auth import get_current_user
from ..database import get_db
from .gradebook import _assert_can_view_student

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/student/{student_id}")
def student_report(student_id: int, db: Session = Depends(get_db),
                   current_user: models.User = Depends(get_current_user)):
    _assert_can_view_student(db, current_user, student_id)
    student = db.query(models.User).filter(models.User.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Ученик не найден")
    grade_rows = []
    for row in db.query(models.GradeEntry).filter(models.GradeEntry.student_id == student_id).all():
        grade_rows.append({"subject": row.subject or "Без предмета", "grade": row.grade,
                           "date": datetime.combine(row.date, time.min).isoformat(),
                           "source": "journal", "label": row.comment or "Оценка в журнале"})
    submissions = db.query(models.Submission).filter(
        models.Submission.student_id == student_id, models.Submission.grade.isnot(None)).all()
    for row in submissions:
        assignment = db.query(models.Assignment).filter(models.Assignment.id == row.assignment_id).first()
        if assignment:
            grade_rows.append({"subject": assignment.subject or "Без предмета", "grade": row.grade,
                               "date": (row.graded_at or row.submitted_at).isoformat(),
                               "source": "assignment", "label": assignment.title})
    grade_rows.sort(key=lambda row: row["date"], reverse=True)
    by_subject = defaultdict(list)
    for row in grade_rows:
        by_subject[row["subject"]].append(row["grade"])
    subjects = [{"subject": key, "average": round(sum(vals) / len(vals), 2), "count": len(vals)}
                for key, vals in sorted(by_subject.items())]
    class_history = db.query(models.StudentClassHistory).filter(
        models.StudentClassHistory.student_id == student_id).all()
    class_ids = {h.class_id for h in class_history}
    class_ids.update(e.class_id for e in db.query(models.Enrollment).filter(
        models.Enrollment.student_id == student_id).all())
    assignments = db.query(models.Assignment).filter(models.Assignment.class_id.in_(class_ids or {-1})).all()
    submissions = db.query(models.Submission).filter(models.Submission.student_id == student_id).all()
    done_ids = {s.assignment_id for s in submissions}
    now = datetime.utcnow()
    attendance = db.query(models.Attendance).filter(models.Attendance.student_id == student_id).all()
    attendance_counts = defaultdict(int)
    for item in attendance:
        status = item.status.value if hasattr(item.status, "value") else str(item.status)
        attendance_counts[status] += 1
    history = []
    for h in sorted(class_history, key=lambda item: item.joined_at, reverse=True):
        cls = db.query(models.ClassRoom).filter(models.ClassRoom.id == h.class_id).first()
        history.append({"class_id": h.class_id, "class_name": h.class_name or (cls.name if cls else "Архивный класс"),
                        "joined_at": h.joined_at.isoformat() if h.joined_at else None,
                        "left_at": h.left_at.isoformat() if h.left_at else None, "current": h.left_at is None})
    return {
        "student": {"id": student.id, "full_name": student.full_name},
        "summary": {
            "average_grade": round(sum(r["grade"] for r in grade_rows) / len(grade_rows), 2) if grade_rows else None,
            "grades_count": len(grade_rows), "homework_total": len(assignments),
            "homework_done": sum(1 for a in assignments if a.id in done_ids),
            "homework_overdue": sum(1 for a in assignments if a.id not in done_ids and a.deadline < now and a.is_active),
            "completion_percent": round(100 * sum(1 for a in assignments if a.id in done_ids) / len(assignments)) if assignments else 0,
            "attendance_total": len(attendance), "attendance_present": attendance_counts.get("present", 0),
            "attendance_absent": attendance_counts.get("absent", 0), "attendance_excused": attendance_counts.get("excused", 0),
        },
        "subjects": subjects, "grades": grade_rows[:100], "history": history,
    }
