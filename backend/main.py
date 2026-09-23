"""Step 2: Supabase Auth integration.

This file intentionally uses functions and dictionaries only. Supabase Auth
handles passwords and sessions; FastAPI reads the authenticated profile and
enforces application permissions in later steps.
"""

import hashlib
import httpx
import os
import re
import secrets
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, UploadFile, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from supabase import Client, create_client

load_dotenv(Path(__file__).resolve().parent / ".env")


SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
MAX_CV_BYTES = int(os.getenv("UPLOAD_MAX_BYTES", "2097152"))
N8N_EMAIL_WEBHOOK_URL = os.getenv("N8N_EMAIL_WEBHOOK_URL", "")
N8N_AI_WEBHOOK_URL = os.getenv("N8N_AI_WEBHOOK_URL", "")
N8N_SERVICE_TOKEN = os.getenv("N8N_SERVICE_TOKEN", "")

if not SUPABASE_URL or not SUPABASE_ANON_KEY:
    raise RuntimeError("SUPABASE_URL and SUPABASE_ANON_KEY are required in backend/.env")

if not SUPABASE_SERVICE_ROLE_KEY:
    raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is required in backend/.env")

auth_client: Client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
admin_client: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
ai_workflow_requested: set[int] = set()

app = FastAPI(title="Nowshera Digital ATS", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
bearer_scheme = HTTPBearer(auto_error=False)


def execute_read(query, attempts: int = 3):
    """Retry transient transport failures for idempotent Supabase reads only."""
    for attempt in range(attempts):
        try:
            return query.execute()
        except (httpx.ReadError, httpx.RemoteProtocolError, httpx.TimeoutException):
            if attempt == attempts - 1:
                raise
            time.sleep(0.15 * (2 ** attempt))


def public_profile(profile: dict) -> dict:
    return {
        "id": profile.get("id"),
        "name": profile.get("name"),
        "phone": profile.get("phone"),
        "role": profile.get("role"),
        "active": profile.get("active", True),
    }


def extract_bearer_token(credentials: Optional[HTTPAuthorizationCredentials]) -> str:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Bearer token is required")
    token = credentials.credentials.strip()
    if not token:
        raise HTTPException(status_code=401, detail="Bearer token is empty")
    return token


def get_authenticated_user(credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme)) -> dict:
    token = extract_bearer_token(credentials)
    try:
        auth_result = auth_client.auth.get_user(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired Supabase session")

    auth_user = getattr(auth_result, "user", None)
    if not auth_user:
        raise HTTPException(status_code=401, detail="Invalid or expired Supabase session")

    user_id = getattr(auth_user, "id", None)
    profile_result = execute_read(admin_client.table("profiles").select("*").eq("id", user_id).limit(1))
    profile = profile_result.data[0] if profile_result.data else None
    if not profile or not profile.get("active", True):
        raise HTTPException(status_code=403, detail="Your account is inactive or has no profile")

    return {"auth_user": auth_user, "profile": profile, "access_token": token}


def require_candidate(current: dict) -> dict:
    if current["profile"].get("role") != "candidate":
        raise HTTPException(status_code=403, detail="Candidate access is required")
    return current


def require_recruiter(current: dict) -> dict:
    if current["profile"].get("role") not in ["recruiter", "admin"]:
        raise HTTPException(status_code=403, detail="Recruiter access is required")
    return current


def require_admin(current: dict) -> dict:
    if current["profile"].get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access is required")
    return current


def recruiter_has_job(recruiter_id: str, job_id: int) -> bool:
    result = admin_client.table("job_recruiters").select("job_id").eq("recruiter_id", recruiter_id).eq("job_id", job_id).limit(1).execute()
    return bool(result.data)


def candidate_email(candidate_id: str) -> str:
    try:
        result = admin_client.auth.admin.get_user_by_id(candidate_id)
        user = getattr(result, "user", None)
        return getattr(user, "email", "") if user else ""
    except Exception:
        return ""


def trigger_email_workflow(email_event_id: int) -> None:
    if not N8N_EMAIL_WEBHOOK_URL:
        print("Email event queued but N8N_EMAIL_WEBHOOK_URL is empty")
        return
    try:
        response = httpx.post(N8N_EMAIL_WEBHOOK_URL, json={"email_event_id": email_event_id}, timeout=15)
        response.raise_for_status()
        print(f"n8n email workflow triggered for event {email_event_id}")
    except Exception as error:
        print(f"n8n email workflow failed for event {email_event_id}: {error}")
        admin_client.table("email_events").update({"status": "failed"}).eq("id", email_event_id).execute()


def trigger_ai_workflow(application_id: int) -> None:
    if not N8N_AI_WEBHOOK_URL:
        print("AI summary pending but N8N_AI_WEBHOOK_URL is empty")
        return
    try:
        response = httpx.post(N8N_AI_WEBHOOK_URL, json={"application_id": application_id}, timeout=15)
        response.raise_for_status()
        print(f"n8n AI workflow triggered for application {application_id}")
    except Exception as error:
        print(f"n8n AI workflow failed for application {application_id}: {error}")
        admin_client.table("ai_summaries").update({"status": "unavailable", "error": str(error)}).eq("application_id", application_id).execute()


def queue_email_event(application_id: int, recipient: str, event_type: str, background: BackgroundTasks, details: dict | None = None) -> dict:
    key = f"{event_type}:{application_id}"
    existing = admin_client.table("email_events").select("*").eq("idempotency_key", key).limit(1).execute().data
    if existing:
        event = existing[0]
    else:
        event = admin_client.table("email_events").insert({"application_id": application_id, "recipient": recipient, "event_type": event_type, "idempotency_key": key, "details": details or {}, "status": "queued"}).execute().data[0]
    if details:
        event["details"] = details
    background.add_task(trigger_email_workflow, event["id"])
    return event


def parse_date(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None: parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).replace(tzinfo=None)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="Date and time must be a valid ISO timestamp")


def parse_interview_time(value: str) -> datetime:
    return parse_date(value)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "step": "supabase-auth"}


@app.get("/api/jobs")
def list_open_jobs() -> list:
    result = admin_client.table("jobs").select("*").eq("status", "open").order("deadline").execute()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    return [job for job in result.data if parse_date(job["deadline"]) > now]


@app.post("/api/candidate/cv")
async def upload_candidate_cv(file: UploadFile = File(...), current: dict = Depends(get_authenticated_user)) -> dict:
    require_candidate(current)
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="CV must be a PDF")
    content = await file.read()
    if len(content) > MAX_CV_BYTES:
        raise HTTPException(status_code=400, detail="CV must be 2 MB or smaller")
    if not content.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="The uploaded file is not a valid PDF")

    user_id = current["profile"]["id"]
    storage_path = f"{user_id}/{secrets.token_hex(12)}.pdf"
    try:
        admin_client.storage.from_("cv-files").upload(
            storage_path,
            content,
            {"content-type": "application/pdf", "upsert": "false"},
        )
    except Exception:
        raise HTTPException(status_code=500, detail="CV could not be saved")

    result = admin_client.table("cvs").insert({
        "candidate_id": user_id,
        "storage_path": storage_path,
        "original_filename": file.filename or "cv.pdf",
        "size_bytes": len(content),
        "checksum": hashlib.sha256(content).hexdigest(),
    }).execute()
    return result.data[0]


@app.get("/api/candidate/cvs")
def list_candidate_cvs(current: dict = Depends(get_authenticated_user)) -> list:
    require_candidate(current)
    result = admin_client.table("cvs").select("id,original_filename,size_bytes,created_at").eq("candidate_id", current["profile"]["id"]).order("created_at", desc=True).execute()
    return result.data


@app.post("/api/jobs/{job_id}/applications")
def create_application(job_id: int, cv_id: int, background: BackgroundTasks, current: dict = Depends(get_authenticated_user)) -> dict:
    require_candidate(current)
    candidate_id = current["profile"]["id"]
    job_result = admin_client.table("jobs").select("*").eq("id", job_id).limit(1).execute()
    job = job_result.data[0] if job_result.data else None
    if not job or job["status"] != "open" or parse_date(job["deadline"]) <= datetime.now(timezone.utc).replace(tzinfo=None):
        raise HTTPException(status_code=400, detail="This job is closed or past its deadline")

    hired_count = len(admin_client.table("applications").select("id").eq("job_id", job_id).eq("stage", "Hired").execute().data)
    if hired_count >= int(job["openings"]):
        # Repair a job left open by an earlier run before refusing another application.
        admin_client.table("jobs").update({"status": "closed"}).eq("id", job_id).eq("status", "open").execute()
        raise HTTPException(status_code=409, detail="This job has no openings remaining and is no longer accepting applications")

    cv_result = admin_client.table("cvs").select("id").eq("id", cv_id).eq("candidate_id", candidate_id).limit(1).execute()
    if not cv_result.data:
        raise HTTPException(status_code=403, detail="This CV does not belong to you")

    previous = admin_client.table("applications").select("id,stage").eq("candidate_id", candidate_id).eq("job_id", job_id).execute().data
    if any(application["stage"] == "Hired" for application in previous):
        raise HTTPException(status_code=409, detail="You were already hired for this job and cannot apply again")
    if any(application["stage"] == "Rejected" for application in previous):
        raise HTTPException(status_code=409, detail="You were already rejected for this job and cannot apply again")
    if any(application["stage"] not in ["Withdrawn"] for application in previous):
        raise HTTPException(status_code=409, detail="You already have an active application for this job")

    application = admin_client.table("applications").insert({
        "candidate_id": candidate_id,
        "job_id": job_id,
        "cv_id": cv_id,
        "stage": "Applied",
        "active_key": "active",
    }).execute().data[0]
    admin_client.table("ai_summaries").insert({"application_id": application["id"], "status": "pending"}).execute()
    queue_email_event(application["id"], current["auth_user"].email, "application_received", background)
    return {"id": application["id"], "stage": application["stage"], "message": "Application received"}


@app.get("/api/candidate/applications")
def list_candidate_applications(current: dict = Depends(get_authenticated_user)) -> list:
    require_candidate(current)
    result = admin_client.table("applications").select("*, jobs(title, department, location), cvs(original_filename)").eq("candidate_id", current["profile"]["id"]).order("created_at", desc=True).execute()
    return result.data


@app.post("/api/applications/{application_id}/withdraw")
def withdraw_application(application_id: int, current: dict = Depends(get_authenticated_user)) -> dict:
    require_candidate(current)
    result = admin_client.table("applications").select("*").eq("id", application_id).eq("candidate_id", current["profile"]["id"]).limit(1).execute()
    application = result.data[0] if result.data else None
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")
    if application["stage"] in ["Hired", "Rejected", "Withdrawn"]:
        raise HTTPException(status_code=400, detail="This application is final")
    admin_client.table("applications").update({
        "stage": "Withdrawn",
        "active_key": f"withdrawn-{application_id}-{int(datetime.now().timestamp())}",
    }).eq("id", application_id).execute()
    admin_client.table("interviews").update({"status": "cancelled"}).eq("application_id", application_id).eq("status", "scheduled").execute()
    return {"stage": "Withdrawn"}


@app.get("/api/recruiter/jobs")
def list_recruiter_jobs(current: dict = Depends(get_authenticated_user)) -> list:
    require_recruiter(current)
    if current["profile"].get("role") == "admin":
        return admin_client.table("jobs").select("*").order("created_at", desc=True).execute().data
    assignments = admin_client.table("job_recruiters").select("job_id").eq("recruiter_id", current["profile"]["id"]).execute().data
    job_ids = [item["job_id"] for item in assignments]
    if not job_ids: return []
    return admin_client.table("jobs").select("*").in_("id", job_ids).order("created_at", desc=True).execute().data


@app.get("/api/recruiter/jobs/{job_id}/applications")
def list_recruiter_applications(job_id: int, current: dict = Depends(get_authenticated_user)) -> list:
    require_recruiter(current)
    if current["profile"].get("role") != "admin" and not recruiter_has_job(current["profile"]["id"], job_id):
        raise HTTPException(status_code=403, detail="This job is not assigned to you")
    return admin_client.table("applications").select("*, cvs(original_filename), profiles!applications_candidate_id_fkey(name,phone), jobs(title)").eq("job_id", job_id).order("created_at", desc=True).execute().data


@app.get("/api/recruiter/interviews")
def list_recruiter_interviews(current: dict = Depends(get_authenticated_user)) -> list:
    require_recruiter(current)
    if current["profile"].get("role") != "recruiter": raise HTTPException(status_code=403, detail="Only recruiters can view assigned interviews")
    interviews = admin_client.table("interviews").select("*").eq("recruiter_id", current["profile"]["id"]).eq("status", "scheduled").gte("starts_at", datetime.now(timezone.utc).isoformat()).order("starts_at").limit(50).execute().data
    output = []
    for interview in interviews:
        application = admin_client.table("applications").select("id,stage,created_at,profiles!applications_candidate_id_fkey(name),jobs(title)").eq("id", interview["application_id"]).limit(1).execute().data
        if not application or application[0]["stage"] != "Interview": continue
        interview["application"] = application[0]
        output.append(interview)
    return output


@app.get("/api/recruiter/recent-activity")
def recruiter_recent_activity(current: dict = Depends(get_authenticated_user)) -> dict:
    require_recruiter(current)
    if current["profile"].get("role") != "recruiter": raise HTTPException(status_code=403, detail="Only recruiters can view assigned activity")
    job_rows = admin_client.table("job_recruiters").select("job_id").eq("recruiter_id", current["profile"]["id"]).execute().data
    job_ids = [row["job_id"] for row in job_rows]
    if not job_ids: return {"applications": [], "interviews": []}
    applications = admin_client.table("applications").select("id,stage,created_at,profiles!applications_candidate_id_fkey(name),jobs(title)").in_("job_id", job_ids).order("created_at", desc=True).limit(5).execute().data
    interviews = admin_client.table("interviews").select("*").eq("recruiter_id", current["profile"]["id"]).eq("status", "scheduled").gte("starts_at", datetime.now(timezone.utc).isoformat()).order("starts_at").limit(5).execute().data
    active_interviews = []
    for interview in interviews:
        application = admin_client.table("applications").select("id,stage,profiles!applications_candidate_id_fkey(name),jobs(title)").eq("id", interview["application_id"]).limit(1).execute().data
        if not application or application[0]["stage"] != "Interview": continue
        interview["application"] = application[0]
        active_interviews.append(interview)
    return {"applications": applications, "interviews": active_interviews}


@app.get("/api/applications/{application_id}/cv-url")
def get_cv_url(application_id: int, current: dict = Depends(get_authenticated_user)) -> dict:
    require_recruiter(current)
    application_result = admin_client.table("applications").select("cv_id,job_id").eq("id", application_id).limit(1).execute()
    application = application_result.data[0] if application_result.data else None
    if not application: raise HTTPException(status_code=404, detail="Application not found")
    if current["profile"].get("role") != "admin" and not recruiter_has_job(current["profile"]["id"], application["job_id"]):
        raise HTTPException(status_code=403, detail="This application is not assigned to you")
    cv_result = admin_client.table("cvs").select("storage_path,original_filename").eq("id", application["cv_id"]).limit(1).execute()
    if not cv_result.data: raise HTTPException(status_code=404, detail="CV not found")
    cv = cv_result.data[0]
    signed = admin_client.storage.from_("cv-files").create_signed_url(cv["storage_path"], 600)
    return {"url": signed.get("signedURL") or signed.get("signedUrl"), "filename": cv["original_filename"]}


@app.get("/api/applications/{application_id}/notes")
def list_notes(application_id: int, current: dict = Depends(get_authenticated_user)) -> list:
    require_recruiter(current)
    application_result = admin_client.table("applications").select("job_id").eq("id", application_id).limit(1).execute()
    application = application_result.data[0] if application_result.data else None
    if not application: raise HTTPException(status_code=404, detail="Application not found")
    if current["profile"].get("role") != "admin" and not recruiter_has_job(current["profile"]["id"], application["job_id"]): raise HTTPException(status_code=403, detail="Not authorized")
    return admin_client.table("recruiter_notes").select("*, profiles(name)").eq("application_id", application_id).order("created_at").execute().data


@app.post("/api/applications/{application_id}/notes")
def create_note(application_id: int, data: dict, current: dict = Depends(get_authenticated_user)) -> dict:
    require_recruiter(current)
    note = str(data.get("note", "")).strip()
    if not note: raise HTTPException(status_code=422, detail="Note cannot be empty")
    if len(note) > 5000: raise HTTPException(status_code=422, detail="Note must be 5000 characters or fewer")
    application_result = admin_client.table("applications").select("job_id").eq("id", application_id).limit(1).execute()
    application = application_result.data[0] if application_result.data else None
    if not application: raise HTTPException(status_code=404, detail="Application not found")
    if current["profile"].get("role") != "admin" and not recruiter_has_job(current["profile"]["id"], application["job_id"]): raise HTTPException(status_code=403, detail="Not authorized")
    return admin_client.table("recruiter_notes").insert({"application_id": application_id, "author_id": current["profile"]["id"], "note": note}).execute().data[0]


@app.post("/api/applications/{application_id}/stage")
def move_application_stage(application_id: int, data: dict, background: BackgroundTasks, current: dict = Depends(get_authenticated_user)) -> dict:
    require_recruiter(current)
    if current["profile"].get("role") != "recruiter": raise HTTPException(status_code=403, detail="Only assigned recruiters can change application stages")
    application_result = admin_client.table("applications").select("*").eq("id", application_id).limit(1).execute()
    application = application_result.data[0] if application_result.data else None
    if not application: raise HTTPException(status_code=404, detail="Application not found")
    if current["profile"].get("role") != "admin" and not recruiter_has_job(current["profile"]["id"], application["job_id"]): raise HTTPException(status_code=403, detail="Not authorized")
    current_stage = application["stage"]; next_stage = str(data.get("stage", ""))
    job_status = admin_client.table("jobs").select("status").eq("id", application["job_id"]).limit(1).execute().data
    if job_status and job_status[0]["status"] == "closed" and next_stage != "Rejected": raise HTTPException(status_code=400, detail="Applications for a closed job can only be rejected")
    if current_stage in ["Hired", "Rejected", "Withdrawn"]: raise HTTPException(status_code=400, detail="Application is final")
    if next_stage == "Interview": raise HTTPException(status_code=400, detail="Schedule an interview to move this application to Interview")
    valid_next = next_stage == "Rejected" or (current_stage in ["Applied", "Shortlisted", "Interview", "Offer"] and next_stage == ["Applied", "Shortlisted", "Interview", "Offer", "Hired"][["Applied", "Shortlisted", "Interview", "Offer", "Hired"].index(current_stage) + 1])
    if not valid_next: raise HTTPException(status_code=400, detail="Stages must advance one step at a time")
    if next_stage == "Hired":
        job = admin_client.table("jobs").select("id,openings").eq("id", application["job_id"]).limit(1).execute().data[0]
        hired_count = len(admin_client.table("applications").select("id").eq("job_id", application["job_id"]).eq("stage", "Hired").execute().data)
        if hired_count >= job["openings"]: raise HTTPException(status_code=409, detail="No opening remains")
    updated = admin_client.table("applications").update({"stage": next_stage, "active_key": f"{next_stage.lower()}-{application_id}" if next_stage in ["Hired", "Rejected"] else "active"}).eq("id", application_id).execute().data[0]
    admin_client.table("application_stage_history").insert({"application_id": application_id, "actor_id": current["profile"]["id"], "old_stage": current_stage, "new_stage": next_stage}).execute()
    if next_stage == "Hired" and hired_count + 1 >= int(job["openings"]):
        admin_client.table("jobs").update({"status": "closed"}).eq("id", job["id"]).eq("status", "open").execute()
    if next_stage in ["Offer", "Hired", "Rejected"]:
        admin_client.table("interviews").update({"status": "cancelled"}).eq("application_id", application_id).eq("status", "scheduled").execute()
    if next_stage in ["Hired", "Rejected"]:
        recipient = candidate_email(application["candidate_id"])
        if recipient: queue_email_event(application_id, recipient, next_stage.lower(), background)
    return updated


@app.post("/api/applications/{application_id}/interviews")
def schedule_interview(application_id: int, data: dict, background: BackgroundTasks, current: dict = Depends(get_authenticated_user)) -> dict:
    require_recruiter(current)
    if current["profile"].get("role") != "recruiter": raise HTTPException(status_code=403, detail="Only assigned recruiters can schedule interviews")
    starts_at = parse_interview_time(str(data.get("starts_at", "")))
    location = str(data.get("location", "")).strip()
    if not location: raise HTTPException(status_code=422, detail="Location or meeting link is required")
    if starts_at <= datetime.now(timezone.utc).replace(tzinfo=None): raise HTTPException(status_code=400, detail="Interview must be in the future")
    ends_at = starts_at + timedelta(hours=1)
    application_result = admin_client.table("applications").select("*").eq("id", application_id).limit(1).execute()
    application = application_result.data[0] if application_result.data else None
    if not application: raise HTTPException(status_code=404, detail="Application not found")
    recruiter_id = current["profile"]["id"]
    if current["profile"].get("role") != "admin" and not recruiter_has_job(recruiter_id, application["job_id"]): raise HTTPException(status_code=403, detail="Not authorized")
    if application["stage"] != "Shortlisted": raise HTTPException(status_code=400, detail="Only shortlisted applicants can be scheduled for interview")
    overlap = admin_client.table("interviews").select("id").eq("recruiter_id", recruiter_id).eq("status", "scheduled").lt("starts_at", ends_at.isoformat()).gt("ends_at", starts_at.isoformat()).limit(1).execute()
    if overlap.data: raise HTTPException(status_code=409, detail="This interview overlaps another interview")
    interview = admin_client.table("interviews").insert({"application_id": application_id, "recruiter_id": recruiter_id, "starts_at": starts_at.isoformat(), "ends_at": ends_at.isoformat(), "location": location, "status": "scheduled"}).execute().data[0]
    admin_client.table("applications").update({"stage": "Interview"}).eq("id", application_id).execute()
    admin_client.table("application_stage_history").insert({"application_id": application_id, "actor_id": recruiter_id, "old_stage": "Shortlisted", "new_stage": "Interview"}).execute()
    recipient = candidate_email(application["candidate_id"])
    if recipient: queue_email_event(application_id, recipient, "interview_invitation", background, {"starts_at": starts_at.isoformat(), "ends_at": ends_at.isoformat(), "location": location})
    return interview


@app.get("/api/internal/email-events/{email_event_id}")
def get_email_event(email_event_id: int, x_n8n_token: Optional[str] = Header(default=None)) -> dict:
    if not N8N_SERVICE_TOKEN or not x_n8n_token or not secrets.compare_digest(x_n8n_token, N8N_SERVICE_TOKEN): raise HTTPException(status_code=401, detail="Invalid automation token")
    result = admin_client.table("email_events").select("*").eq("id", email_event_id).limit(1).execute().data
    if not result: raise HTTPException(status_code=404, detail="Email event not found")
    event = result[0]
    application = admin_client.table("applications").select("job_id,candidate_id").eq("id", event["application_id"]).limit(1).execute().data
    event["application"] = application[0] if application else None
    return event


@app.post("/api/internal/email-events/{email_event_id}/sent")
def mark_email_sent(email_event_id: int, x_n8n_token: Optional[str] = Header(default=None)) -> dict:
    if not N8N_SERVICE_TOKEN or not x_n8n_token or not secrets.compare_digest(x_n8n_token, N8N_SERVICE_TOKEN): raise HTTPException(status_code=401, detail="Invalid automation token")
    result = admin_client.table("email_events").update({"status": "sent"}).eq("id", email_event_id).execute()
    if not result.data: raise HTTPException(status_code=404, detail="Email event not found")
    return result.data[0]


@app.get("/api/candidate/interviews")
def list_candidate_interviews(current: dict = Depends(get_authenticated_user)) -> list:
    require_candidate(current)
    applications = admin_client.table("applications").select("id").eq("candidate_id", current["profile"]["id"]).execute().data
    ids = [item["id"] for item in applications]
    if not ids: return []
    interviews = admin_client.table("interviews").select("*").in_("application_id", ids).eq("status", "scheduled").gte("starts_at", datetime.now(timezone.utc).isoformat()).order("starts_at").execute().data
    active_interviews = []
    for interview in interviews:
        application = admin_client.table("applications").select("id,stage,jobs(title)").eq("id", interview["application_id"]).limit(1).execute().data
        if not application or application[0]["stage"] != "Interview": continue
        interview["application"] = application[0]
        active_interviews.append(interview)
    return active_interviews


@app.get("/api/internal/applications/{application_id}/ai-input")
def get_ai_input(application_id: int, x_n8n_token: Optional[str] = Header(default=None)) -> dict:
    if not N8N_SERVICE_TOKEN or not x_n8n_token or not secrets.compare_digest(x_n8n_token, N8N_SERVICE_TOKEN): raise HTTPException(status_code=401, detail="Invalid automation token")
    application_result = admin_client.table("applications").select("id,cv_id,job_id").eq("id", application_id).limit(1).execute().data
    if not application_result: raise HTTPException(status_code=404, detail="Application not found")
    application = application_result[0]
    cv_result = admin_client.table("cvs").select("storage_path,original_filename").eq("id", application["cv_id"]).limit(1).execute().data
    job_result = admin_client.table("jobs").select("requirements").eq("id", application["job_id"]).limit(1).execute().data
    if not cv_result or not job_result: raise HTTPException(status_code=404, detail="AI input not found")
    try:
        signed = admin_client.storage.from_("cv-files").create_signed_url(cv_result[0]["storage_path"], 600)
        cv_url = signed.get("signedURL") or signed.get("signedUrl")
    except Exception:
        raise HTTPException(status_code=500, detail="Could not create temporary CV URL")
    return {"application_id": application_id, "cv_url": cv_url, "filename": cv_result[0]["original_filename"], "requirements": job_result[0]["requirements"]}


@app.post("/api/n8n/ai-summary-callback")
def save_ai_summary(application_id: int, data: dict, x_n8n_token: Optional[str] = Header(default=None)) -> dict:
    if not N8N_SERVICE_TOKEN or not x_n8n_token or not secrets.compare_digest(x_n8n_token, N8N_SERVICE_TOKEN): raise HTTPException(status_code=401, detail="Invalid automation token")
    profile = data.get("profile", []); found = data.get("found_requirements", []); missing = data.get("missing_requirements", []); questions = data.get("questions", [])
    if (not isinstance(profile, list) or not 3 <= len(profile) <= 5 or
        not isinstance(found, list) or not isinstance(missing, list) or
        not isinstance(questions, list) or len(questions) != 3 or
        any(not isinstance(item, str) or not item.strip() for item in profile + found + missing + questions)):
        raise HTTPException(status_code=422, detail="AI summary must contain 3-5 profile bullets, requirement lists, and exactly 3 questions")
    all_summary_text = " ".join(profile + found + missing + questions)
    prohibited = re.compile(r"\b(age|aged|gender|male|female|religion|religious|marital|married|spouse|husband|wife|date of birth|birth date|dob)\b", re.IGNORECASE)
    if prohibited.search(all_summary_text):
        raise HTTPException(status_code=422, detail="AI summary contains a prohibited personal attribute and was not saved")
    if not admin_client.table("applications").select("id").eq("id", application_id).limit(1).execute().data:
        raise HTTPException(status_code=404, detail="Application not found")
    summary = {"status": "available", "profile": "\n".join(f"- {item}" for item in profile), "found_requirements": "\n".join(found), "missing_requirements": "\n".join(missing), "questions": "\n".join(f"{index + 1}. {item}" for index, item in enumerate(questions)), "error": None}
    result = admin_client.table("ai_summaries").update(summary).eq("application_id", application_id).execute()
    if not result.data: raise HTTPException(status_code=404, detail="Summary record not found")
    return {"status": "available", "application_id": application_id}


@app.post("/api/n8n/ai-summary-failed")
def mark_ai_summary_failed(application_id: int, data: dict, x_n8n_token: Optional[str] = Header(default=None)) -> dict:
    if not N8N_SERVICE_TOKEN or not x_n8n_token or not secrets.compare_digest(x_n8n_token, N8N_SERVICE_TOKEN): raise HTTPException(status_code=401, detail="Invalid automation token")
    message = str(data.get("error", "AI summary could not be generated"))[:500]
    result = admin_client.table("ai_summaries").update({"status": "unavailable", "error": message}).eq("application_id", application_id).execute()
    if not result.data: raise HTTPException(status_code=404, detail="Summary record not found")
    return {"status": "unavailable", "application_id": application_id}


@app.get("/api/applications/{application_id}/ai-summary")
def read_ai_summary(application_id: int, background: BackgroundTasks, current: dict = Depends(get_authenticated_user)) -> dict:
    if current["profile"].get("role") not in ["recruiter", "admin"]: raise HTTPException(status_code=403, detail="AI summaries are private")
    application_result = admin_client.table("applications").select("job_id").eq("id", application_id).limit(1).execute().data
    if not application_result: raise HTTPException(status_code=404, detail="Application not found")
    if current["profile"].get("role") == "recruiter" and not recruiter_has_job(current["profile"]["id"], application_result[0]["job_id"]): raise HTTPException(status_code=403, detail="Not authorized")
    result = admin_client.table("ai_summaries").select("*").eq("application_id", application_id).limit(1).execute().data
    if not result: return {"status": "unavailable", "message": "Summary not available"}
    if result[0]["status"] == "pending":
        if application_id not in ai_workflow_requested:
            ai_workflow_requested.add(application_id)
            background.add_task(trigger_ai_workflow, application_id)
        return {"status": "pending", "message": "Summary is being generated."}
    if result[0]["status"] != "available": return {"status": "unavailable", "message": "Summary not available"}
    return {"status": "available", "written_by": "AI", **result[0]}


@app.post("/api/applications/{application_id}/ai-summary/retry")
def retry_ai_summary(application_id: int, background: BackgroundTasks, current: dict = Depends(get_authenticated_user)) -> dict:
    if current["profile"].get("role") not in ["recruiter", "admin"]: raise HTTPException(status_code=403, detail="Not authorized")
    application_result = admin_client.table("applications").select("job_id").eq("id", application_id).limit(1).execute().data
    if not application_result: raise HTTPException(status_code=404, detail="Application not found")
    if current["profile"].get("role") == "recruiter" and not recruiter_has_job(current["profile"]["id"], application_result[0]["job_id"]): raise HTTPException(status_code=403, detail="Not authorized")
    previous = admin_client.table("ai_summaries").select("status").eq("application_id", application_id).limit(1).execute().data
    if not previous: raise HTTPException(status_code=404, detail="Summary record not found")
    if previous[0]["status"] != "unavailable": raise HTTPException(status_code=409, detail="Only unavailable summaries can be retried")
    result = admin_client.table("ai_summaries").update({"status": "pending", "error": None}).eq("application_id", application_id).execute()
    if not result.data: raise HTTPException(status_code=404, detail="Summary record not found")
    ai_workflow_requested.discard(application_id)
    ai_workflow_requested.add(application_id)
    background.add_task(trigger_ai_workflow, application_id)
    return {"status": "pending", "message": "AI summary retry queued"}


@app.get("/api/admin/recruiters")
def list_recruiters(current: dict = Depends(get_authenticated_user)) -> list:
    require_admin(current)
    return admin_client.table("profiles").select("id,name,phone,role,active,created_at").eq("role", "recruiter").order("name").execute().data


@app.patch("/api/account")
def update_my_account(data: dict, current: dict = Depends(get_authenticated_user)) -> dict:
    role = current["profile"].get("role")
    if role not in ["candidate", "recruiter"]:
        raise HTTPException(status_code=403, detail="Account settings are available to candidates and recruiters")
    name = str(data.get("name", "")).strip()
    phone = str(data.get("phone", "")).strip()
    if len(name) < 2:
        raise HTTPException(status_code=422, detail="Name must be at least 2 characters")
    profile_id = current["profile"]["id"]
    result = admin_client.table("profiles").update({"name": name, "phone": phone or None}).eq("id", profile_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Account profile was not found")
    return public_profile(result.data[0])


@app.patch("/api/account/password")
def update_my_password(data: dict, current: dict = Depends(get_authenticated_user)) -> dict:
    role = current["profile"].get("role")
    if role not in ["candidate", "recruiter"]:
        raise HTTPException(status_code=403, detail="Password settings are available to candidates and recruiters")
    current_password = str(data.get("current_password", ""))
    new_password = str(data.get("new_password", ""))
    if not current_password:
        raise HTTPException(status_code=422, detail="Current password is required")
    if len(new_password) < 8:
        raise HTTPException(status_code=422, detail="New password must be at least 8 characters")
    if current_password == new_password:
        raise HTTPException(status_code=422, detail="New password must be different from the current password")
    email = getattr(current["auth_user"], "email", None)
    if not email:
        raise HTTPException(status_code=400, detail="This account cannot update its password with email and password")
    try:
        verification_client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
        verification_client.auth.sign_in_with_password({"email": email, "password": current_password})
    except Exception:
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    try:
        admin_client.auth.admin.update_user_by_id(current["profile"]["id"], {"password": new_password})
    except Exception:
        raise HTTPException(status_code=400, detail="Password could not be updated")
    return {"message": "Password updated successfully"}


@app.post("/api/admin/recruiters", status_code=201)
def create_recruiter(data: dict, current: dict = Depends(get_authenticated_user)) -> dict:
    require_admin(current)
    name = str(data.get("name", "")).strip()
    phone = str(data.get("phone", "")).strip()
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    if len(name) < 2:
        raise HTTPException(status_code=422, detail="Name must be at least 2 characters")
    if "@" not in email or email.startswith("@") or email.endswith("@"):
        raise HTTPException(status_code=422, detail="A valid email is required")
    if len(password) < 8:
        raise HTTPException(status_code=422, detail="Initial password must be at least 8 characters")

    try:
        response = admin_client.auth.admin.create_user({
            "email": email,
            "password": password,
            "email_confirm": True,
            "user_metadata": {"name": name, "phone": phone},
        })
    except Exception as error:
        message = str(error).lower()
        if "already" in message or "registered" in message or "exists" in message:
            raise HTTPException(status_code=409, detail="An account already exists for this email")
        raise HTTPException(status_code=400, detail="Supabase could not create the recruiter account")

    auth_user = getattr(response, "user", None)
    recruiter_id = getattr(auth_user, "id", None)
    if not recruiter_id:
        raise HTTPException(status_code=502, detail="Supabase did not return the new account")

    try:
        admin_client.table("profiles").update({"name": name, "phone": phone, "role": "recruiter", "active": True}).eq("id", recruiter_id).execute()
        profile = admin_client.table("profiles").select("id,name,phone,role,active,created_at").eq("id", recruiter_id).limit(1).execute().data
        if not profile or profile[0].get("role") != "recruiter":
            raise RuntimeError("The recruiter profile was not created")
        return profile[0]
    except Exception:
        try:
            admin_client.auth.admin.delete_user(recruiter_id)
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="The recruiter profile could not be created; the account was rolled back")


@app.patch("/api/admin/recruiters/{recruiter_id}/active")
def update_recruiter_status(recruiter_id: str, data: dict, current: dict = Depends(get_authenticated_user)) -> dict:
    require_admin(current)
    active = bool(data.get("active"))
    result = admin_client.table("profiles").update({"active": active}).eq("id", recruiter_id).eq("role", "recruiter").execute()
    if not result.data: raise HTTPException(status_code=404, detail="Recruiter not found")
    return result.data[0]


@app.get("/api/admin/jobs")
def list_admin_jobs(current: dict = Depends(get_authenticated_user)) -> list:
    require_admin(current)
    jobs = execute_read(admin_client.table("jobs").select("*").order("created_at", desc=True)).data
    assignments = execute_read(admin_client.table("job_recruiters").select("job_id,recruiter_id")).data
    recruiter_ids = list({item["recruiter_id"] for item in assignments})
    recruiter_rows = execute_read(admin_client.table("profiles").select("id,name,active").in_("id", recruiter_ids)).data if recruiter_ids else []
    recruiters_by_id = {item["id"]: item for item in recruiter_rows}
    recruiters_by_job: dict[int, list] = {}
    for assignment in assignments:
        recruiter = recruiters_by_id.get(assignment["recruiter_id"])
        if recruiter:
            recruiters_by_job.setdefault(assignment["job_id"], []).append(recruiter)
    for job in jobs:
        job["assigned_recruiters"] = recruiters_by_job.get(job["id"], [])
    return jobs


@app.post("/api/admin/jobs")
def create_job(data: dict, current: dict = Depends(get_authenticated_user)) -> dict:
    require_admin(current)
    required = ["title", "department", "location", "job_type", "description", "requirements", "deadline", "openings"]
    missing = [field for field in required if not str(data.get(field, "")).strip()]
    if missing: raise HTTPException(status_code=422, detail=f"Missing fields: {', '.join(missing)}")
    if data["job_type"] not in ["full-time", "part-time", "internship"]: raise HTTPException(status_code=422, detail="Invalid job type")
    if int(data["openings"]) < 1: raise HTTPException(status_code=422, detail="Openings must be at least 1")
    if parse_date(data["deadline"]) <= datetime.now(timezone.utc).replace(tzinfo=None): raise HTTPException(status_code=422, detail="Deadline must be in the future")
    payload = {"title": data["title"].strip(), "department": data["department"].strip(), "location": data["location"].strip(), "job_type": data["job_type"], "description": data["description"].strip(), "requirements": data["requirements"].strip(), "deadline": data["deadline"], "openings": int(data["openings"]), "status": "draft"}
    return admin_client.table("jobs").insert(payload).execute().data[0]


@app.patch("/api/admin/jobs/{job_id}/status")
def update_job_status(job_id: int, data: dict, current: dict = Depends(get_authenticated_user)) -> dict:
    require_admin(current)
    status = data.get("status")
    if status not in ["draft", "open", "closed"]: raise HTTPException(status_code=422, detail="Invalid job status")
    result = admin_client.table("jobs").update({"status": status}).eq("id", job_id).execute()
    if not result.data: raise HTTPException(status_code=404, detail="Job not found")
    return result.data[0]


@app.post("/api/admin/jobs/{job_id}/recruiters/{recruiter_id}")
def assign_job_recruiter(job_id: int, recruiter_id: str, current: dict = Depends(get_authenticated_user)) -> dict:
    require_admin(current)
    recruiter = admin_client.table("profiles").select("id,active,role").eq("id", recruiter_id).limit(1).execute().data
    if not recruiter or recruiter[0]["role"] != "recruiter": raise HTTPException(status_code=404, detail="Recruiter not found")
    if not recruiter[0]["active"]: raise HTTPException(status_code=400, detail="Recruiter is inactive")
    existing = admin_client.table("job_recruiters").select("job_id").eq("job_id", job_id).eq("recruiter_id", recruiter_id).limit(1).execute().data
    if not existing: admin_client.table("job_recruiters").insert({"job_id": job_id, "recruiter_id": recruiter_id}).execute()
    return {"job_id": job_id, "recruiter_id": recruiter_id, "assigned": True}


@app.delete("/api/admin/jobs/{job_id}/recruiters/{recruiter_id}")
def remove_job_recruiter(job_id: int, recruiter_id: str, current: dict = Depends(get_authenticated_user)) -> dict:
    require_admin(current)
    existing = admin_client.table("job_recruiters").select("job_id,recruiter_id").eq("job_id", job_id).eq("recruiter_id", recruiter_id).limit(1).execute().data
    if not existing:
        raise HTTPException(status_code=404, detail="Recruiter assignment not found")
    admin_client.table("job_recruiters").delete().eq("job_id", job_id).eq("recruiter_id", recruiter_id).execute()
    return {"job_id": job_id, "recruiter_id": recruiter_id, "assigned": False}


@app.get("/api/admin/dashboard")
def admin_dashboard(current: dict = Depends(get_authenticated_user)) -> list:
    require_admin(current)
    jobs = execute_read(admin_client.table("jobs").select("*").order("created_at", desc=True)).data
    applications = execute_read(admin_client.table("applications").select("job_id,stage")).data
    stages = ["Applied", "Shortlisted", "Interview", "Offer", "Hired", "Rejected", "Withdrawn"]
    grouped: dict[int, dict] = {}
    for application in applications:
        job_id = application["job_id"]
        if job_id not in grouped:
            grouped[job_id] = {"counts": {stage: 0 for stage in stages}, "total": 0}
        grouped[job_id]["counts"][application["stage"]] = grouped[job_id]["counts"].get(application["stage"], 0) + 1
        grouped[job_id]["total"] += 1
    return [{"job": job, **grouped.get(job["id"], {"counts": {stage: 0 for stage in stages}, "total": 0})} for job in jobs]


@app.get("/api/admin/recent-activity")
def admin_recent_activity(current: dict = Depends(get_authenticated_user)) -> dict:
    require_admin(current)
    applications = execute_read(admin_client.table("applications").select("id,stage,created_at,profiles!applications_candidate_id_fkey(name),jobs(title)").order("created_at", desc=True).limit(5)).data
    interviews = execute_read(admin_client.table("interviews").select("*").eq("status", "scheduled").gte("starts_at", datetime.now(timezone.utc).isoformat()).order("starts_at").limit(5)).data
    active_interviews = []
    for interview in interviews:
        application = execute_read(admin_client.table("applications").select("id,stage,profiles!applications_candidate_id_fkey(name),jobs(title)").eq("id", interview["application_id"]).limit(1)).data
        if not application or application[0]["stage"] != "Interview":
            admin_client.table("interviews").update({"status": "cancelled"}).eq("id", interview["id"]).execute()
            continue
        interview["application"] = application[0]
        active_interviews.append(interview)
    return {"applications": applications, "interviews": active_interviews}


@app.post("/api/auth/register")
def register(data: dict) -> dict:
    name = str(data.get("name", "")).strip()
    phone = str(data.get("phone", "")).strip()
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))

    if len(name) < 2:
        raise HTTPException(status_code=422, detail="Name is required")
    if "@" not in email:
        raise HTTPException(status_code=422, detail="A valid email is required")
    if len(password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")

    try:
        result = auth_client.auth.sign_up(
            {
                "email": email,
                "password": password,
                "options": {"data": {"name": name, "phone": phone}},
            }
        )
    except Exception as error:
        raise HTTPException(status_code=400, detail=str(error))

    user = getattr(result, "user", None)
    session = getattr(result, "session", None)
    if not user:
        raise HTTPException(status_code=400, detail="Supabase could not create the account")

    response = {"user_id": getattr(user, "id", None), "email": email, "message": "Account created"}
    if session:
        response["access_token"] = session.access_token
        response["refresh_token"] = session.refresh_token
        response["email_confirmation_required"] = False
    else:
        response["email_confirmation_required"] = True
        response["message"] = "Account created. Check your email before signing in."
    return response


@app.post("/api/auth/login")
def login(data: dict) -> dict:
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    if "@" not in email or not password:
        raise HTTPException(status_code=422, detail="Email and password are required")

    try:
        result = auth_client.auth.sign_in_with_password({"email": email, "password": password})
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    session = getattr(result, "session", None)
    user = getattr(result, "user", None)
    if not session or not user:
        raise HTTPException(status_code=401, detail="Email confirmation may be required")

    profile_result = admin_client.table("profiles").select("*").eq("id", user.id).limit(1).execute()
    profile = profile_result.data[0] if profile_result.data else None
    if not profile or not profile.get("active", True):
        raise HTTPException(status_code=403, detail="Your account is inactive or has no profile")

    return {
        "access_token": session.access_token,
        "refresh_token": session.refresh_token,
        "user": public_profile(profile),
    }


@app.get("/api/auth/me")
def me(current: dict = Depends(get_authenticated_user)) -> dict:
    return {"user": public_profile(current["profile"])}


@app.post("/api/auth/logout")
def logout(current: dict = Depends(get_authenticated_user)) -> dict:
    # Supabase access tokens are stateless. React should remove its local
    # session; this endpoint confirms that the caller was authenticated.
    return {"message": "Signed out", "user_id": current["profile"]["id"]}
