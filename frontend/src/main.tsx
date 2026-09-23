import { FormEvent, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:8000/api").replace(/\/$/, "");
const TOKEN_KEY = "ats_access_token";

type Profile = { id: string; name: string; phone?: string; role: string; active: boolean };
type Mode = "login" | "register";

async function request(path: string, options: RequestInit = {}, token = "") {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || "Request failed");
  return data;
}

function AuthForm({ onAuthenticated, initialMode, onBack }: { onAuthenticated: (profile: Profile, token: string) => void; initialMode: Mode; onBack: () => void }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [loginRole, setLoginRole] = useState("candidate");
  const [form, setForm] = useState({ name: "", phone: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function update(field: string, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setMessage("");
    try {
      if (mode === "register") {
        const result = await request("/auth/register", { method: "POST", body: JSON.stringify(form) });
        if (!result.access_token) { setMessage(result.message); setMode("login"); return; }
        const profile = await request("/auth/me", {}, result.access_token);
        onAuthenticated(profile.user, result.access_token);
      } else {
        const result = await request("/auth/login", { method: "POST", body: JSON.stringify({ email: form.email, password: form.password }) });
        if (result.user.role !== loginRole) throw new Error("Unable to sign in with these details.");
        onAuthenticated(result.user, result.access_token);
      }
    } catch (reason) { setError(mode === "login" ? "Unable to sign in with these details." : reason instanceof Error ? reason.message : "Something went wrong"); }
  }

  return <main className="auth-page"><section className="auth-card"><button className="text-button" type="button" onClick={onBack}>← Back to home</button>
    <p className="eyebrow">Nowshera Digital</p><h1>Applicant Tracking System</h1>
    <p className="muted">Secure recruitment workspace for candidates and hiring teams.</p>
    <div className="tabs"><button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Sign in</button><button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>Create account</button></div>
    <form onSubmit={submit}>
      {mode === "register" && <><label>Name<input required value={form.name} onChange={(event) => update("name", event.target.value)} /></label><label>Phone<input required value={form.phone} onChange={(event) => update("phone", event.target.value)} /></label></>}
      {mode === "login" && <label>Sign in as<select value={loginRole} onChange={(event) => setLoginRole(event.target.value)}><option value="candidate">Candidate</option><option value="recruiter">Recruiter</option><option value="admin">Admin</option></select></label>}
      <label>Email<input required type="email" value={form.email} onChange={(event) => update("email", event.target.value)} /></label>
      <label>Password<input required minLength={8} type="password" value={form.password} onChange={(event) => update("password", event.target.value)} /></label>
      <button className="primary" type="submit">{mode === "login" ? "Sign in" : "Create account"}</button>
    </form>
    {message && <FeedbackNotice message={message}/>}{error && <FeedbackNotice message={error} type="error"/>}
  </section></main>;
}

function LandingPage({ onLogin, onRegister }: { onLogin: () => void; onRegister: () => void }) {
  return <main className="landing-page">
    <nav className="landing-nav"><strong>Nowshera ATS</strong><div><button className="landing-link" onClick={onLogin}>Sign in</button><button className="primary compact" onClick={onRegister}>Create account</button></div></nav>
    <section className="landing-hero"><div><p className="eyebrow">A clearer path to your next opportunity</p><h1>Hiring, made more human.</h1><p>One secure place to discover roles, manage applications, and keep every hiring conversation moving.</p><div className="landing-actions"><button className="primary compact" onClick={onRegister}>Get started</button><button className="secondary" onClick={onLogin}>I already have an account</button></div></div><div className="hero-preview"><span className="preview-label">YOUR NEXT CHAPTER</span><div className="preview-line wide"/><div className="preview-line"/><div className="preview-status"><i/> Application received <b>In review</b></div><div className="preview-dots"><i/><i/><i/></div></div></section>
    <section className="landing-features"><article><span>01</span><h2>Find the right role</h2><p>Browse open opportunities and apply with your CV.</p></article><article><span>02</span><h2>Stay in the loop</h2><p>Track application progress and scheduled interviews in one place.</p></article><article><span>03</span><h2>Recruit with clarity</h2><p>Hiring teams can review applicants and manage each stage securely.</p></article></section>
    <footer>© {new Date().getFullYear()} Nowshera ATS · A secure recruitment workspace</footer>
  </main>;
}

function HomeLinks({ items, onSelect }: { items: { href: string; title: string; description: string; icon: string }[]; onSelect: (page: string) => void }) {
  return <nav className="home-links" aria-label="Workspace sections">{items.map((item) => <button className="home-link" onClick={() => onSelect(item.href)} key={item.href}><span>{item.icon}</span><div><b>{item.title}</b><small>{item.description}</small></div><i>→</i></button>)}</nav>;
}

function BentoGrid({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`bento-grid ${className}`}>{children}</div>;
}

function BentoCard({ children, className = "", title, eyebrow, action }: { children: ReactNode; className?: string; title?: string; eyebrow?: string; action?: ReactNode }) {
  return <section className={`bento-card ${className}`}><div className="bento-card-content">{(title || eyebrow || action) && <div className="bento-card-header"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}{title && <h2>{title}</h2>}</div>{action}</div>}{children}</div></section>;
}

function MetricCard({ label, value, detail, tone = "teal", icon }: { label: string; value: string | number; detail?: string; tone?: string; icon?: string }) {
  return <BentoCard className={`metric-card tone-${tone}`}><div className="metric-head"><span>{label}</span>{icon && <i aria-hidden="true">{icon}</i>}</div><strong>{value}</strong>{detail && <small>{detail}</small>}</BentoCard>;
}

function StatusPill({ value }: { value: string }) {
  const tone = value.toLowerCase().replace(/[^a-z]+/g, "-");
  return <span className={`status-pill status-${tone}`}><span className="status-dot" aria-hidden="true"/>{value}</span>;
}

function ActivityList({ items, loading, empty, renderItem }: { items: any[]; loading: boolean; empty: string; renderItem: (item: any) => ReactNode }) {
  if (loading) return <LoadingState label="Loading recent activity…" compact/>;
  if (!items.length) return <EmptyState message={empty}/>;
  return <div className="activity-list">{items.map(renderItem)}</div>;
}

function ApplicationTimeline({ stage }: { stage: string }) {
  const stages = ["Applied", "Shortlisted", "Interview", "Offer", "Hired"];
  const finalStage = ["Rejected", "Withdrawn"].includes(stage);
  const currentIndex = stages.indexOf(stage);
  return <ol className={`application-timeline${finalStage ? " is-final" : ""}`} aria-label={`Application progress: ${stage}`}>
    {stages.map((item, index) => <li className={index < currentIndex ? "complete" : index === currentIndex ? "current" : ""} key={item}><span>{index < currentIndex ? "✓" : index + 1}</span><small>{item}</small></li>)}
    {finalStage && <li className="final-stage"><span>!</span><small>{stage}</small></li>}
  </ol>;
}

function EmptyState({ message }: { message: string }) {
  return <div className="empty-state"><span aria-hidden="true">✳</span><p>{message}</p></div>;
}

function LoadingState({ label = "Loading…", compact = false }: { label?: string; compact?: boolean }) {
  return <div className={`loading-state${compact ? " compact" : ""}`} role="status"><span className="loading-spinner" aria-hidden="true"/>{label}</div>;
}

function FeedbackNotice({ message, type = "success" }: { message: string; type?: "success" | "error" }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    setVisible(true);
    const timeout = window.setTimeout(() => setVisible(false), type === "error" ? 9000 : 6500);
    return () => window.clearTimeout(timeout);
  }, [message, type]);
  if (!message || !visible) return null;
  return <div className={`feedback-toast ${type}`} role={type === "error" ? "alert" : "status"} aria-live={type === "error" ? "assertive" : "polite"}>
    <span>{message}</span><button type="button" aria-label="Dismiss notification" onClick={() => setVisible(false)}>×</button>
  </div>;
}

function ErrorBanner({ message }: { message: string }) {
  return <FeedbackNotice message={message} type="error"/>;
}

function TopBar({ profile, onLogout }: { profile: Profile; onLogout: () => void }) {
  return <header className="topbar"><strong>Nowshera ATS</strong><div className="header-right"><span>{profile.name} · {profile.role}</span><button onClick={onLogout}>Sign out</button></div></header>;
}

function Sidebar({ profile, items }: { profile: Profile; items: { href: string; title: string; icon: string }[] }) {
  const [active, setActive] = useState("home");
  useEffect(() => {
    const pageChanged = (event: Event) => setActive((event as CustomEvent<string>).detail || "home");
    window.addEventListener("ats-page-changed", pageChanged);
    return () => window.removeEventListener("ats-page-changed", pageChanged);
  }, []);
  function navigate(page: string) { window.dispatchEvent(new CustomEvent("ats-navigate", { detail: page })); }
  const activeItem = active === "create-job" ? "jobs" : active;
  return <nav className="workspace-sidebar" aria-label={`${profile.role} workspace navigation`}><p className="sidebar-label">WORKSPACE</p>{items.map((item) => <button key={item.href} className={`sidebar-link${activeItem === item.href ? " active" : ""}`} aria-current={activeItem === item.href ? "page" : undefined} onClick={() => navigate(item.href)}><span aria-hidden="true">{item.icon}</span>{item.title}</button>)}</nav>;
}

function AppShell({ profile, onLogout, children }: { profile: Profile; onLogout: () => void; children: React.ReactNode }) {
  const items = profile.role === "candidate" ? [{ href: "home", title: "Overview", icon: "⌂" }, { href: "jobs", title: "Find jobs", icon: "⌕" }, { href: "applications", title: "My applications", icon: "▤" }, { href: "interviews", title: "Interviews", icon: "◷" }, { href: "settings", title: "Settings", icon: "⚙" }] : profile.role === "recruiter" ? [{ href: "home", title: "Overview", icon: "⌂" }, { href: "applicants", title: "Applicants", icon: "▤" }, { href: "interviews", title: "Interviews", icon: "◷" }, { href: "settings", title: "Settings", icon: "⚙" }] : [{ href: "home", title: "Overview", icon: "⌂" }, { href: "jobs", title: "Jobs", icon: "▤" }, { href: "recruiters", title: "Recruiters", icon: "♙" }, { href: "applications", title: "Application counts", icon: "▥" }];
  return <div className="app-shell"><TopBar profile={profile} onLogout={onLogout}/><div className="app-frame"><Sidebar profile={profile} items={items}/><div className="workspace-content">{children}</div></div></div>;
}

function useWorkspaceNavigation(activePage: string, setActivePage: (page: string) => void) {
  useEffect(() => {
    const navigate = (event: Event) => setActivePage((event as CustomEvent<string>).detail || "home");
    window.addEventListener("ats-navigate", navigate);
    return () => window.removeEventListener("ats-navigate", navigate);
  }, [setActivePage]);
  useEffect(() => { window.dispatchEvent(new CustomEvent("ats-page-changed", { detail: activePage })); }, [activePage]);
}

function AccountSettings({ profile, onProfileUpdated }: { profile: Profile; onProfileUpdated: (profile: Profile) => void }) {
  const token = localStorage.getItem(TOKEN_KEY) || "";
  const [details, setDetails] = useState({ name: profile.name, phone: profile.phone || "" });
  const [passwords, setPasswords] = useState({ current_password: "", new_password: "", confirm_password: "" });
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");

  async function saveDetails(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try { const updated = await request("/account", { method: "PATCH", body: JSON.stringify(details) }, token); onProfileUpdated(updated); setMessage("Account details updated."); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Account details could not be updated"); }
    finally { setBusy(false); }
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    if (passwords.new_password !== passwords.confirm_password) { setError("New password and confirmation do not match."); setBusy(false); return; }
    try { const result = await request("/account/password", { method: "PATCH", body: JSON.stringify({ current_password: passwords.current_password, new_password: passwords.new_password }) }, token); setMessage(result.message || "Password updated successfully."); setPasswords({ current_password: "", new_password: "", confirm_password: "" }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Password could not be updated"); }
    finally { setBusy(false); }
  }

  return <main className="page workspace-page"><div className="workspace-top"><span>Account settings</span></div><ErrorBanner message={error}/>{message && <FeedbackNotice message={message}/>}<section className="section-heading"><p className="eyebrow">Your account</p><h1>Settings</h1><p className="muted">Update your profile details or change your password.</p></section><section className="card settings-card"><h2>Profile details</h2><form className="admin-form" onSubmit={saveDetails}><label>Full name<input required minLength={2} autoComplete="name" value={details.name} onChange={(event) => setDetails((current) => ({ ...current, name: event.target.value }))}/></label><label>Phone (optional)<input autoComplete="tel" value={details.phone} onChange={(event) => setDetails((current) => ({ ...current, phone: event.target.value }))}/></label><button className="primary compact" type="submit" disabled={busy}>Save profile</button></form></section><section className="card settings-card"><h2>Change password</h2><form className="admin-form" onSubmit={savePassword}><label>Current password<input required type="password" autoComplete="current-password" value={passwords.current_password} onChange={(event) => setPasswords((current) => ({ ...current, current_password: event.target.value }))}/></label><label>New password<input required type="password" minLength={8} autoComplete="new-password" value={passwords.new_password} onChange={(event) => setPasswords((current) => ({ ...current, new_password: event.target.value }))}/></label><label>Confirm new password<input required type="password" minLength={8} autoComplete="new-password" value={passwords.confirm_password} onChange={(event) => setPasswords((current) => ({ ...current, confirm_password: event.target.value }))}/></label><button className="primary compact" type="submit" disabled={busy}>Update password</button></form><p className="muted settings-hint">Your current password is checked before the password is changed.</p></section></main>;
}

function CandidateDashboard({ profile, onProfileUpdated }: { profile: Profile; onProfileUpdated: (profile: Profile) => void }) {
  const [activePage, setActivePage] = useState("home");
  useWorkspaceNavigation(activePage, setActivePage);
  const token = localStorage.getItem(TOKEN_KEY) || "";
  const [jobs, setJobs] = useState<any[]>([]), [cvs, setCvs] = useState<any[]>([]), [applications, setApplications] = useState<any[]>([]), [interviews, setInterviews] = useState<any[]>([]);
  const [selectedCv, setSelectedCv] = useState(""), [busy, setBusy] = useState(false), [dataLoading, setDataLoading] = useState(true), [message, setMessage] = useState(""), [error, setError] = useState("");
  const pages = [{ href: "jobs", title: "View jobs", description: `${jobs.length} open opportunities`, icon: "⌕" }, { href: "applications", title: "My applications", description: `${applications.length} applications tracked`, icon: "▤" }, { href: "interviews", title: "Interviews", description: `${interviews.length} scheduled`, icon: "◷" }];

  async function refresh() { setError(""); try { const [openJobs, ownCvs, ownApplications, ownInterviews] = await Promise.all([request("/jobs"), request("/candidate/cvs", {}, token), request("/candidate/applications", {}, token), request("/candidate/interviews", {}, token)]); setJobs(openJobs); setCvs(ownCvs); setApplications(ownApplications); setInterviews(ownInterviews); if (!selectedCv && ownCvs[0]) setSelectedCv(String(ownCvs[0].id)); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load candidate data"); } }
  useEffect(() => { refresh().finally(() => setDataLoading(false)); }, []);

  if (activePage === "settings") return <AccountSettings profile={profile} onProfileUpdated={onProfileUpdated}/>;
  if (activePage === "home") return <main className="page workspace-page dashboard-overview"><ErrorBanner message={error}/>{message && <FeedbackNotice message={message}/>}<BentoGrid className="candidate-bento">
    <BentoCard className="welcome-bento span-2"><p className="eyebrow">Candidate workspace</p><h1>Good to see you, {profile.name.split(" ")[0]}</h1><p>Keep your momentum going. Your applications and upcoming conversations are right here.</p><div className="welcome-meta"><span>✦ Personalized job search</span><span>◷ Application updates</span></div></BentoCard>
    <MetricCard label="Open jobs" value={dataLoading ? "—" : jobs.length} detail="Roles ready to explore" icon="⌕"/>
    <MetricCard label="Active applications" value={dataLoading ? "—" : applications.filter((item) => !["Hired", "Rejected", "Withdrawn"].includes(item.stage)).length} detail="Currently in progress" tone="mint" icon="↗"/>
    <MetricCard label="Upcoming interviews" value={dataLoading ? "—" : interviews.length} detail="On your calendar" tone="blue" icon="◷"/>
    <BentoCard className="span-2" eyebrow="Your journey" title="Recent applications" action={<button className="card-action" onClick={() => setActivePage("applications")}>All applications →</button>}>
      <ActivityList items={applications.slice(0, 3)} loading={dataLoading} empty="Your submitted applications will appear here." renderItem={(item) => <article className="bento-activity" key={item.id}><div className="bento-activity-head"><div><b>{item.jobs?.title || "Job application"}</b><small>{item.created_at ? new Date(item.created_at).toLocaleDateString() : "Recently submitted"}</small></div><StatusPill value={item.stage}/></div><ApplicationTimeline stage={item.stage}/></article>}/>
    </BentoCard>
    <BentoCard eyebrow="On your calendar" title="Upcoming interviews" action={<button className="card-action" onClick={() => setActivePage("interviews")}>View schedule →</button>}>
      <ActivityList items={interviews.slice(0, 4)} loading={dataLoading} empty="No interviews scheduled yet." renderItem={(item) => <div className="activity-row" key={item.id}><div><b>{new Date(item.starts_at).toLocaleString()}</b><small>{item.location}</small></div><span className="activity-icon">◷</span></div>}/>
    </BentoCard>
    <BentoCard className="cv-readiness" eyebrow="Application essentials" title="Your CV" action={<span className={`readiness-badge${cvs.length ? " ready" : ""}`}>{cvs.length ? "Ready" : "Add CV"}</span>}>
      <p>{cvs.length ? `${cvs.length} CV${cvs.length === 1 ? "" : "s"} saved. Choose one when applying.` : "Upload a PDF CV to apply for open roles."}</p><input aria-label="Upload a PDF CV" type="file" accept="application/pdf,.pdf" onChange={upload} disabled={busy}/>{cvs.length > 0 && <select aria-label="Choose your default CV" value={selectedCv} onChange={(event) => setSelectedCv(event.target.value)}><option value="">Choose a CV</option>{cvs.map((cv) => <option key={cv.id} value={cv.id}>{cv.original_filename}</option>)}</select>}<small>PDF only · Maximum 2 MB</small>
    </BentoCard>
    <BentoCard className="span-2 quick-actions" eyebrow="Jump back in" title="Your workspace"><HomeLinks items={pages} onSelect={setActivePage}/></BentoCard>
  </BentoGrid></main>;

  if (activePage === "home") return <main className="page workspace-page"><section className="welcome"><p className="eyebrow">Candidate workspace</p><h1>Good to see you, {profile.name.split(" ")[0]}</h1><p className="muted">Your next opportunity is one step closer. Here’s what’s happening with your job search.</p></section><section className="admin-overview-stats"><article><span>Open jobs</span><b>{jobs.length}</b></article><article><span>Active applications</span><b>{applications.filter((item) => !["Hired", "Rejected", "Withdrawn"].includes(item.stage)).length}</b></article><article><span>Upcoming interviews</span><b>{interviews.length}</b></article></section><section className="home-activity-grid"><article className="card"><div className="activity-heading"><div><p className="eyebrow">Recently submitted</p><h2>Latest applications</h2></div><button onClick={() => setActivePage("applications")}>View all →</button></div>{applications.slice(0, 3).length === 0 ? <p className="muted">Your submitted applications will appear here.</p> : applications.slice(0, 3).map((item) => <div className="activity-row" key={item.id}><div><b>{item.jobs?.title || "Job application"}</b><small>{item.created_at ? new Date(item.created_at).toLocaleDateString() : "Submitted"}</small></div><span className="status-pill">{item.stage}</span></div>)}</article><article className="card"><div className="activity-heading"><div><p className="eyebrow">On your calendar</p><h2>Upcoming interviews</h2></div><button onClick={() => setActivePage("interviews")}>View all →</button></div>{interviews.slice(0, 3).length === 0 ? <p className="muted">No interviews scheduled yet.</p> : interviews.slice(0, 3).map((item) => <div className="activity-row" key={item.id}><div><b>{new Date(item.starts_at).toLocaleString()}</b><small>{item.location}</small></div></div>)}</article></section><HomeLinks items={pages} onSelect={setActivePage}/><section className="card home-cv"><h2>Keep your CV ready</h2><p className="muted">Upload a PDF once, then choose it when applying for a role.</p><input type="file" accept="application/pdf,.pdf" onChange={upload} disabled={busy}/>{cvs.length > 0 && <select value={selectedCv} onChange={(event) => setSelectedCv(event.target.value)}><option value="">Choose a CV for applications</option>{cvs.map((cv) => <option key={cv.id} value={cv.id}>{cv.original_filename}</option>)}</select>}<small>PDF only, maximum 2 MB.</small></section></main>;

  async function upload(event: FormEvent<HTMLInputElement>) { const file = event.currentTarget.files?.[0]; if (!file) return; setBusy(true); setError(""); setMessage(""); try { const form = new FormData(); form.append("file", file); const result = await fetch(`${API_URL}/candidate/cv`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form }); if (!result.ok) throw new Error((await result.json()).detail || "CV upload failed"); setMessage("CV uploaded successfully."); await refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : "CV upload failed"); } finally { setBusy(false); } }
  async function apply(jobId: number) { if (!selectedCv) { setError("Upload and select a CV first."); return; } setBusy(true); setError(""); setMessage(""); try { await request(`/jobs/${jobId}/applications?cv_id=${selectedCv}`, { method: "POST" }, token); setMessage("Application submitted."); await refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Application failed"); } finally { setBusy(false); } }
  async function withdraw(applicationId: number) { setBusy(true); try { await request(`/applications/${applicationId}/withdraw`, { method: "POST" }, token); setMessage("Application withdrawn."); await refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Withdrawal failed"); } finally { setBusy(false); } }

  const pageContent = activePage === "jobs" ? <><section className="section-heading"><p className="eyebrow">Your next opportunity</p><h1>Open jobs</h1><p className="muted">Explore roles and apply using your selected CV.</p></section><section className="card"><h2>Your CVs</h2><input type="file" accept="application/pdf,.pdf" onChange={upload} disabled={busy}/>{cvs.length > 0 && <select value={selectedCv} onChange={(event) => setSelectedCv(event.target.value)}><option value="">Choose a CV for applications</option>{cvs.map((cv) => <option key={cv.id} value={cv.id}>{cv.original_filename}</option>)}</select>}<small>PDF only, maximum 2 MB.</small></section>{jobs.length === 0 && <p className="empty-state">No open jobs are available right now.</p>}{jobs.map((job) => <article className="card" key={job.id}><h3>{job.title}</h3><p>{job.department} · {job.location} · {job.job_type}</p><p>{job.description}</p><small>Apply by {new Date(job.deadline).toLocaleString()}</small><br/><button className="primary compact" disabled={busy} onClick={() => apply(job.id)}>Apply with selected CV</button></article>)}</> : activePage === "applications" ? <section><div className="section-heading"><p className="eyebrow">Your progress</p><h1>My applications</h1><p className="muted">Track the status of each application and withdraw if your plans change.</p></div>{applications.length === 0 && <p className="empty-state">You have not applied to a job yet.</p>}{applications.map((application) => <article className="card application" key={application.id}><div><b>{application.jobs?.title || `Application #${application.id}`}</b><p>Stage: <strong>{application.stage}</strong></p><small>CV: {application.cvs?.original_filename || "Submitted CV"}</small></div>{!["Hired", "Rejected", "Withdrawn"].includes(application.stage) && <button onClick={() => withdraw(application.id)} disabled={busy}>Withdraw</button>}</article>)}</section> : activePage === "interviews" ? <section><div className="section-heading"><p className="eyebrow">Coming up</p><h1>Interviews</h1><p className="muted">Details for interviews scheduled with the hiring team.</p></div>{interviews.length === 0 && <p className="empty-state">No interviews scheduled.</p>}{interviews.map((interview) => <article className="card" key={interview.id}><b>{new Date(interview.starts_at).toLocaleString()}</b><p>{interview.location}</p></article>)}</section> : <><section className="welcome"><p className="eyebrow">Candidate workspace</p><h1>Welcome, {profile.name}</h1><p className="muted">Your hiring journey, all in one place. Choose a section to get started.</p></section><HomeLinks items={pages} onSelect={setActivePage}/><section className="card home-cv"><h2>Keep your CV ready</h2><p className="muted">Upload a PDF once, then choose it when applying for a role.</p><input type="file" accept="application/pdf,.pdf" onChange={upload} disabled={busy}/>{cvs.length > 0 && <select value={selectedCv} onChange={(event) => setSelectedCv(event.target.value)}><option value="">Choose a CV for applications</option>{cvs.map((cv) => <option key={cv.id} value={cv.id}>{cv.original_filename}</option>)}</select>}<small>PDF only, maximum 2 MB.</small></section></>;
  return <main className="page workspace-page"><div className="workspace-top"><button className="back-home" onClick={() => setActivePage("home")}>{activePage === "home" ? "Your workspace" : "← Home"}</button>{activePage !== "home" && <span>{pages.find((page) => page.href === activePage)?.title}</span>}</div>{message && <FeedbackNotice message={message}/ >}{error && <FeedbackNotice message={error} type="error"/>}<div className="view-transition" key={activePage}>{pageContent}</div></main>;
}

function ScheduleInterviewPanel({ application, form, onChange, onSubmit, onCancel }: any) {
  return <div className="schedule-panel" role="dialog" aria-modal="true" aria-labelledby="schedule-title"><div className="schedule-panel-card"><div className="schedule-panel-head"><div><p className="eyebrow">Candidate interview</p><h2 id="schedule-title">Schedule interview</h2><p className="muted">Choose a date and time for {application?.profiles?.name || "this candidate"}.</p></div><button type="button" className="icon-button" aria-label="Close scheduling panel" onClick={onCancel}>×</button></div><form onSubmit={onSubmit}><div className="schedule-fields"><label>Date<input required type="date" min={new Date().toISOString().slice(0, 10)} value={form.date} onChange={(event) => onChange("date", event.target.value)}/></label><label>Start time<input required type="time" value={form.time} onChange={(event) => onChange("time", event.target.value)}/></label></div><label>Location or meeting link<input required placeholder="e.g. Google Meet or interview room" value={form.location} onChange={(event) => onChange("location", event.target.value)}/></label><p className="schedule-hint">The interview lasts one hour. Overlapping or past times will be rejected automatically.</p><div className="form-actions"><button type="button" onClick={onCancel}>Cancel</button><button className="primary compact" type="submit">Schedule interview</button></div></form></div></div>;
}

function RecruiterApplicantsView({ jobs, applications, selectedJob, setSelectedJob, summaries, error, message, readSummary, retrySummary, move, schedule, addNote, openCv, nextStage, schedulingApplication, scheduleForm, onScheduleChange, onScheduleSubmit, onScheduleCancel }: any) {
  return <main className="page workspace-page"><section className="section-heading"><p className="eyebrow">Candidate review</p><h1>Applicants</h1><p className="muted">Review CVs, AI-generated summaries, and application progress for your assigned roles.</p></section>{message && <FeedbackNotice message={message}/ >}{error && <FeedbackNotice message={error} type="error"/>}<section className="card"><label>Choose an assigned job<select value={selectedJob || ""} onChange={(event) => setSelectedJob(Number(event.target.value))}><option value="">Select job</option>{jobs.map((job: any) => <option key={job.id} value={job.id}>{job.title} · {job.status}</option>)}</select></label></section>{applications.length === 0 ? <p className="empty-state">No applications for this job yet.</p> : applications.map((application: any) => { const summary = summaries[application.id]; return <article className="card recruiter-applicant-card" key={application.id}><div className="applicant-detail"><h3>{application.profiles?.name || `Application #${application.id}`}</h3><p>{application.jobs?.title || "Assigned job"} · Stage: <strong>{application.stage}</strong></p><button className="cv-open-button" onClick={() => openCv(application.id)}>↗ Open CV <small>{application.cvs?.original_filename || "View submitted CV"}</small></button>{summary && <div className="summary"><b>AI-generated summary</b>{summary.status === "unavailable" || summary.status === "pending" ? <p>{summary.message || (summary.status === "pending" ? "Summary is being generated." : "Summary is unavailable.")}</p> : <><h4>Profile</h4><pre>{summary.profile}</pre><h4>Requirements found</h4><pre>{summary.found_requirements || "None listed"}</pre><h4>Requirements not found</h4><pre>{summary.missing_requirements || "None listed"}</pre><h4>Interview questions</h4><pre>{summary.questions}</pre></>}</div>}</div><div className="actions applicant-actions"><button onClick={() => readSummary(application.id)}>View AI summary</button>{summary?.status === "unavailable" && <button onClick={() => retrySummary(application.id)}>Try again</button>}{nextStage[application.stage] && application.stage !== "Shortlisted" && <button onClick={() => move(application.id, nextStage[application.stage])}>Move to {nextStage[application.stage]}</button>}{application.stage === "Shortlisted" && <button onClick={() => schedule(application.id)}>Schedule interview</button>}{!["Hired", "Rejected", "Withdrawn"].includes(application.stage) && <button onClick={() => move(application.id, "Rejected")}>Reject</button>}<button onClick={() => addNote(application.id)}>Private note</button></div></article>; })}</main>;
}

function RecruiterDashboard({ profile, onProfileUpdated }: { profile: Profile; onProfileUpdated: (profile: Profile) => void }) {
  const [activePage, setActivePage] = useState("home");
  useWorkspaceNavigation(activePage, setActivePage);
  const token = localStorage.getItem(TOKEN_KEY) || "";
  const [jobs, setJobs] = useState<any[]>([]), [applications, setApplications] = useState<any[]>([]), [recentApplications, setRecentApplications] = useState<any[]>([]), [interviews, setInterviews] = useState<any[]>([]), [selectedJob, setSelectedJob] = useState<number | null>(null), [summaries, setSummaries] = useState<Record<number, any>>({}), [dataLoading, setDataLoading] = useState(true), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [schedulingApplication, setSchedulingApplication] = useState<any>(null), [scheduleForm, setScheduleForm] = useState({ date: "", time: "", location: "" });
  async function loadJobs() { try { const result = await request("/recruiter/jobs", {}, token); setJobs(result); if (result[0] && selectedJob === null) setSelectedJob(result[0].id); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load jobs"); } }
  async function loadApplications(jobId: number) { try { setApplications(await request(`/recruiter/jobs/${jobId}/applications`, {}, token)); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load applications"); } }
  async function loadInterviews() { try { const recent = await request("/recruiter/recent-activity", {}, token); setInterviews(recent.interviews); setRecentApplications(recent.applications); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load recruiter activity"); } }
  useEffect(() => { Promise.all([loadJobs(), loadInterviews()]).finally(() => setDataLoading(false)); }, []); useEffect(() => { if (selectedJob !== null) loadApplications(selectedJob); }, [selectedJob]);
  useEffect(() => { if (activePage === "home") loadInterviews(); }, [activePage]);
  useEffect(() => { if (activePage === "interviews") request("/recruiter/interviews", {}, token).then(setInterviews).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load interviews")); }, [activePage]);
  useEffect(() => { const goHome = () => setActivePage("home"); window.addEventListener("ats-home", goHome); return () => window.removeEventListener("ats-home", goHome); }, []);
  useEffect(() => {
    const pendingIds = Object.entries(summaries).filter(([, summary]) => summary?.status === "pending").map(([id]) => Number(id));
    if (!pendingIds.length) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (cancelled) return;
      const results = await Promise.all(pendingIds.map(async (id) => {
        try { return { id, summary: await request(`/applications/${id}/ai-summary`, {}, token) }; }
        catch { return { id, summary: null }; }
      }));
      if (cancelled) return;
      const stillPending: number[] = [];
      results.forEach(({ id, summary }) => {
        if (!summary || summary.status === "pending") stillPending.push(id);
        else setSummaries((current) => current[id]?.status === "pending" ? { ...current, [id]: summary } : current);
      });
      if (stillPending.length) timer = setTimeout(poll, 2000);
    };
    timer = setTimeout(poll, 1500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [summaries, token]);
  async function move(applicationId: number, stage: string) { try { await request(`/applications/${applicationId}/stage`, { method: "POST", body: JSON.stringify({ stage }) }, token); setMessage(`Application moved to ${stage}.`); if (selectedJob !== null) await loadApplications(selectedJob); await loadInterviews(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Stage change failed"); } }
  async function addNote(applicationId: number) { const note = window.prompt("Private recruiter note:"); if (!note) return; try { await request(`/applications/${applicationId}/notes`, { method: "POST", body: JSON.stringify({ note }) }, token); setMessage("Private note saved."); } catch (reason) { setError(reason instanceof Error ? reason.message : "Note could not be saved"); } }
  function schedule(applicationId: number) { const application = applications.find((item) => item.id === applicationId); setSchedulingApplication(application || null); setScheduleForm({ date: "", time: "", location: "" }); }
  function changeSchedule(field: "date" | "time" | "location", value: string) { setScheduleForm((current) => ({ ...current, [field]: value })); }
  async function submitSchedule(event: FormEvent) { event.preventDefault(); if (!schedulingApplication) return; try { const startsAt = `${scheduleForm.date}T${scheduleForm.time}`; await request(`/applications/${schedulingApplication.id}/interviews`, { method: "POST", body: JSON.stringify({ starts_at: startsAt, location: scheduleForm.location }) }, token); setSchedulingApplication(null); setMessage("Interview scheduled."); if (selectedJob !== null) await loadApplications(selectedJob); await loadInterviews(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Interview could not be scheduled"); } }
  async function readSummary(applicationId: number) { try { const summary = await request(`/applications/${applicationId}/ai-summary`, {}, token); setSummaries((current) => ({ ...current, [applicationId]: summary })); } catch (reason) { setError(reason instanceof Error ? reason.message : "Summary could not be loaded"); } }
  async function retrySummary(applicationId: number) { try { await request(`/applications/${applicationId}/ai-summary/retry`, { method: "POST" }, token); setMessage("AI summary retry queued."); setSummaries((current) => ({ ...current, [applicationId]: { status: "pending", message: "Summary is being generated." } })); } catch (reason) { setError(reason instanceof Error ? reason.message : "Summary retry failed"); } }
  async function openCv(applicationId: number) { const tab = window.open("about:blank", "_blank"); if (!tab) { setError("Allow pop-ups to open a secure CV preview."); return; } tab.opener = null; tab.document.title = "Loading CV…"; try { const result = await request(`/applications/${applicationId}/cv-url`, {}, token); if (!result.url) throw new Error("A secure CV link could not be created."); tab.location.replace(result.url); } catch (reason) { tab.close(); setError(reason instanceof Error ? reason.message : "CV could not be opened"); } }
  const nextStage: Record<string, string> = { Applied: "Shortlisted", Shortlisted: "Interview", Interview: "Offer", Offer: "Hired" };
  const recruiterLinks = [{ href: "applicants", title: "Applicants", description: "Review candidates and AI summaries", icon: "▤" }, { href: "interviews", title: "Interviews", description: "Shortlisted candidates and scheduling", icon: "◷" }];
  const pipelineStages = ["Applied", "Shortlisted", "Interview", "Offer", "Hired", "Rejected"];
  const pipelineCounts = pipelineStages.map((stage) => ({ stage, count: applications.filter((item) => item.stage === stage).length }));
  const summaryStatuses = Object.values(summaries).reduce((result: Record<string, number>, item: any) => { result[item.status] = (result[item.status] || 0) + 1; return result; }, {});
  if (activePage === "settings") return <AccountSettings profile={profile} onProfileUpdated={onProfileUpdated}/>;
  if (activePage === "home") return <main className="page workspace-page dashboard-overview"><ErrorBanner message={error}/>{message && <p className="success" role="status">{message}</p>}<BentoGrid className="recruiter-bento">
    <BentoCard className="welcome-bento span-2"><p className="eyebrow">Recruiter workspace</p><h1>Hiring, at a glance</h1><p>Review the pipeline, keep up with candidate activity, and prepare for upcoming interviews.</p><div className="welcome-meta"><span>◈ {jobs.length} assigned role{jobs.length === 1 ? "" : "s"}</span><span>◎ Human-led decisions</span></div></BentoCard>
    <MetricCard label="Assigned jobs" value={dataLoading ? "—" : jobs.length} detail="Roles in your workspace" icon="▤"/>
    <MetricCard label="Needs review" value={dataLoading ? "—" : applications.filter((item) => ["Applied", "Shortlisted"].includes(item.stage)).length} detail="For the selected job" tone="amber" icon="◷"/>
    <MetricCard label="Upcoming interviews" value={dataLoading ? "—" : interviews.length} detail="Next scheduled interviews" tone="blue" icon="⌖"/>
    <BentoCard className="span-2 pipeline-card" eyebrow={selectedJob ? `Selected role · ${jobs.find((job) => job.id === selectedJob)?.title || "Loading"}` : "Hiring flow"} title="Application pipeline" action={<button className="card-action" onClick={() => setActivePage("applicants")}>Review applicants →</button>}>
      <p className="muted">Stage counts for the selected assigned role. Move candidates forward based on your review.</p>{dataLoading ? <LoadingState compact/> : !selectedJob ? <EmptyState message="No assigned roles yet."/> : <div className="pipeline-stages">{pipelineCounts.map(({ stage, count }) => <div className="pipeline-stage" key={stage}><StatusPill value={stage}/><b>{count}</b></div>)}</div>}
    </BentoCard>
    <BentoCard eyebrow="Assigned roles" title="Your jobs" action={<button className="card-action" onClick={() => setActivePage("applicants")}>Browse →</button>}>
      <ActivityList items={jobs.slice(0, 4)} loading={dataLoading} empty="No jobs assigned to you yet." renderItem={(job) => <button className="activity-row activity-button" key={job.id} onClick={() => { setSelectedJob(job.id); setActivePage("applicants"); }}><div><b>{job.title}</b><small>{job.department} · {job.location}</small></div><StatusPill value={job.status}/></button>}/>
    </BentoCard>
    <BentoCard eyebrow="Latest activity" title="Recent applications" className="span-2" action={<button className="card-action" onClick={() => setActivePage("applicants")}>Open review queue →</button>}>
      <ActivityList items={recentApplications.slice(0, 4)} loading={dataLoading} empty="No applications have been submitted to your assigned jobs yet." renderItem={(item) => <div className="activity-row" key={item.id}><div><b>{item.profiles?.name || "Candidate"}</b><small>{item.jobs?.title || "Application"} · {new Date(item.created_at).toLocaleDateString()}</small></div><StatusPill value={item.stage}/></div>}/>
    </BentoCard>
    <BentoCard eyebrow="On your calendar" title="Upcoming interviews" action={<button className="card-action" onClick={() => setActivePage("interviews")}>View schedule →</button>}>
      <ActivityList items={interviews.slice(0, 3)} loading={dataLoading} empty="No interviews scheduled." renderItem={(item) => <div className="activity-row" key={item.id}><div><b>{item.application?.profiles?.name || "Candidate"}</b><small>{item.application?.jobs?.title || "Interview"} · {new Date(item.starts_at).toLocaleString()}</small></div></div>}/>
    </BentoCard>
    <BentoCard eyebrow="Decision support" title="AI summary activity"><p className="muted">AI summaries support your review; hiring decisions remain yours.</p><div className="summary-metrics"><span><StatusPill value="available"/><b>{summaryStatuses.available || 0}</b></span><span><StatusPill value="pending"/><b>{summaryStatuses.pending || 0}</b></span><span><StatusPill value="unavailable"/><b>{summaryStatuses.unavailable || 0}</b></span></div><p className="bento-note">Counts reflect summaries opened in this session.</p></BentoCard>
    <BentoCard className="quick-actions" eyebrow="Quick access" title="Continue where you left off"><HomeLinks items={recruiterLinks} onSelect={setActivePage}/></BentoCard>
  </BentoGrid></main>;
  if (activePage === "home") return <main className="page workspace-page"><section className="welcome"><p className="eyebrow">Recruiter workspace</p><h1>Hiring, at a glance</h1><p className="muted">Your assigned roles, recent applications, and upcoming interviews are gathered here.</p></section><section className="admin-overview-stats"><article><span>Assigned jobs</span><b>{jobs.length}</b></article><article><span>Recent applications</span><b>{recentApplications.length}</b></article><article><span>Scheduled interviews</span><b>{interviews.length}</b></article></section><section className="home-activity-grid"><article className="card"><div className="activity-heading"><div><p className="eyebrow">Latest activity</p><h2>Recent applications</h2></div><button onClick={() => setActivePage("applicants")}>View applicants →</button></div>{recentApplications.length === 0 ? <p className="muted">No applications have been submitted to your assigned jobs yet.</p> : recentApplications.slice(0, 3).map((item) => <div className="activity-row" key={item.id}><div><b>{item.profiles?.name || "Candidate"}</b><small>{item.jobs?.title || "Application"} · {new Date(item.created_at).toLocaleDateString()}</small></div><span className="status-pill">{item.stage}</span></div>)}</article><article className="card"><div className="activity-heading"><div><p className="eyebrow">Coming up</p><h2>Next interviews</h2></div><button onClick={() => setActivePage("interviews")}>View schedule →</button></div>{interviews.length === 0 ? <p className="muted">No interviews scheduled.</p> : interviews.slice(0, 3).map((item) => <div className="activity-row" key={item.id}><div><b>{item.application?.profiles?.name || "Candidate"}</b><small>{item.application?.jobs?.title || "Interview"} · {new Date(item.starts_at).toLocaleString()}</small></div></div>)}</article></section><HomeLinks items={recruiterLinks} onSelect={setActivePage}/></main>;
  if (activePage === "interviews") return <main className="page workspace-page"><div className="workspace-top"><button className="back-home" onClick={() => setActivePage("home")}>← Overview</button><span>Interview schedule</span></div><section className="section-heading"><p className="eyebrow">Your calendar</p><h1>Scheduled interviews</h1><p className="muted">Upcoming candidate interviews assigned to you.</p></section>{error && <p className="error">{error}</p>}{interviews.length === 0 ? <p className="empty-state">No interviews scheduled yet. Shortlist an applicant to schedule an interview.</p> : interviews.map((item) => <article className="card interview-card" key={item.id}><div className="interview-date"><b>{new Date(item.starts_at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</b><strong>{new Date(item.starts_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</strong></div><div><h3>{item.application?.profiles?.name || "Candidate"}</h3><p>{item.application?.jobs?.title || "Assigned role"}</p><small>{item.location}</small></div><span className="status-pill">Scheduled</span></article>)}</main>;
  if (activePage === "applicants") return <><RecruiterApplicantsView jobs={jobs} applications={applications} selectedJob={selectedJob} setSelectedJob={setSelectedJob} summaries={summaries} error={error} message={message} readSummary={readSummary} retrySummary={retrySummary} move={move} schedule={schedule} addNote={addNote} openCv={openCv} nextStage={nextStage}/>{schedulingApplication && <ScheduleInterviewPanel application={schedulingApplication} form={scheduleForm} onChange={changeSchedule} onSubmit={submitSchedule} onCancel={() => setSchedulingApplication(null)}/>}</>;
  return <main className="page"><section className="welcome"><p className="eyebrow">Recruiter workspace</p><h1>Assigned jobs</h1><p className="muted">Review only the jobs assigned to your account.</p></section>{message && <p className="success">{message}</p>}{error && <p className="error">{error}</p>}<section className="card"><label>Choose a job<select value={selectedJob || ""} onChange={(event) => setSelectedJob(Number(event.target.value))}><option value="">Select job</option>{jobs.map((job) => <option key={job.id} value={job.id}>{job.title} · {job.status}</option>)}</select></label></section><section><h2>Applicants</h2>{applications.length === 0 && <p className="muted">No applications for this job.</p>}{applications.map((application) => { const summary = summaries[application.id]; return <article className="card application" key={application.id}><div><h3>{application.profiles?.name || `Application #${application.id}`}</h3><p>Stage: <strong>{application.stage}</strong></p><small>CV: {application.cvs?.original_filename || "Submitted CV"}</small>{summary && <div className="summary"><b>AI-generated summary</b>{summary.status === "unavailable" || summary.status === "pending" ? <p>{summary.message || "Summary is being generated."}</p> : <><h4>Profile</h4><pre>{summary.profile}</pre><h4>Requirements found</h4><pre>{summary.found_requirements || "None listed"}</pre><h4>Requirements not found</h4><pre>{summary.missing_requirements || "None listed"}</pre><h4>Interview questions</h4><pre>{summary.questions}</pre></>}</div>}</div><div className="actions"><button onClick={() => readSummary(application.id)}>View AI summary</button>{summary?.status === "unavailable" && <button onClick={() => retrySummary(application.id)}>Try again</button>}{nextStage[application.stage] && application.stage !== "Shortlisted" && <button onClick={() => move(application.id, nextStage[application.stage])}>Move to {nextStage[application.stage]}</button>}{application.stage === "Shortlisted" && <button onClick={() => schedule(application.id)}>Schedule interview</button>}{!["Hired", "Rejected", "Withdrawn"].includes(application.stage) && <button onClick={() => move(application.id, "Rejected")}>Reject</button>}<button onClick={() => addNote(application.id)}>Private note</button></div></article>; })}</section></main>;
}

function AdminJobCard({ job, recruiters, onStatus, onAssign, onRemove }: { job: any; recruiters: any[]; onStatus: (jobId: number, status: string) => void; onAssign: (jobId: number, recruiterId: string) => void; onRemove: (jobId: number, recruiterId: string) => void }) {
  const assigned: any[] = job.assigned_recruiters || [];
  return <article className="card admin-job-card">
    <div className="job-card-head"><div><h3>{job.title}</h3><p>{job.department} · {job.location} · {job.openings} openings</p></div><span className={`status-pill status-${job.status}`}>{job.status}</span></div>
    <section className="job-assignees" aria-label={`Recruiters assigned to ${job.title}`}><h4>Assigned recruiters <span>{assigned.length}</span></h4>{assigned.length ? <ul>{assigned.map((recruiter) => <li key={recruiter.id}><span><b>{recruiter.name}</b><small>{recruiter.active ? "Active account" : "Inactive account"}</small></span><button type="button" className="remove-assignment" aria-label={`Remove ${recruiter.name} from ${job.title}`} onClick={() => onRemove(job.id, recruiter.id)}>Remove</button></li>)}</ul> : <p className="muted">No recruiters assigned to this job.</p>}</section>
    <div className="actions">{job.status === "draft" && <button onClick={() => onStatus(job.id, "open")}>Open job</button>}{job.status === "open" && <button onClick={() => onStatus(job.id, "closed")}>Close job</button>}{job.status === "closed" && <button onClick={() => onStatus(job.id, "open")}>Reopen job</button>}<select defaultValue="" aria-label={`Assign recruiter to ${job.title}`} onChange={(event) => { const recruiterId = event.currentTarget.value; event.currentTarget.value = ""; onAssign(job.id, recruiterId); }}><option value="">Assign recruiter</option>{recruiters.filter((recruiter) => recruiter.active && !assigned.some((item) => item.id === recruiter.id)).map((recruiter) => <option key={recruiter.id} value={recruiter.id}>{recruiter.name}</option>)}</select></div>
  </article>;
}

function AdminRecruiterPage({ recruiters, form, onFormChange, onCreate, onActivate, showCreate, setShowCreate, loading, error, message }: { recruiters: any[]; form: { name: string; phone: string; email: string; password: string }; onFormChange: (field: "name" | "phone" | "email" | "password", value: string) => void; onCreate: (event: FormEvent) => void; onActivate: (id: string, active: boolean) => void; showCreate: boolean; setShowCreate: (show: boolean) => void; loading: boolean; error: string; message: string }) {
  return <main className="page workspace-page"><div className="workspace-top"><button className="back-home" onClick={() => window.dispatchEvent(new CustomEvent("ats-navigate", { detail: "home" }))}>← Overview</button><span>Recruiter management</span></div><ErrorBanner message={error}/>{message && <p className="success" role="status">{message}</p>}<div className="section-heading admin-heading"><div><p className="eyebrow">Team access</p><h1>Recruiters</h1><p className="muted">Create recruiter accounts and manage access for your hiring team.</p></div><button className={showCreate ? "secondary" : "primary compact"} onClick={() => setShowCreate(!showCreate)}>{showCreate ? "Cancel" : "＋ Create recruiter"}</button></div>{showCreate && <section className="card recruiter-create-card"><h2>Create recruiter account</h2><p className="muted">Set an initial password and share it with the recruiter securely.</p><form className="admin-form recruiter-create-form" onSubmit={onCreate}><label>Full name<input required minLength={2} autoComplete="name" value={form.name} onChange={(event) => onFormChange("name", event.target.value)}/></label><label>Phone (optional)<input autoComplete="tel" value={form.phone} onChange={(event) => onFormChange("phone", event.target.value)}/></label><label>Email<input required type="email" autoComplete="email" value={form.email} onChange={(event) => onFormChange("email", event.target.value)}/></label><label>Initial password<input required type="password" minLength={8} autoComplete="new-password" value={form.password} onChange={(event) => onFormChange("password", event.target.value)}/></label><button className="primary compact" type="submit">Create recruiter account</button></form></section>}<section className="section-heading"><p className="eyebrow">Existing accounts</p><h2>Recruiter access</h2></section>{loading ? <LoadingState label="Loading recruiter accounts…"/> : recruiters.length === 0 ? <EmptyState message="No recruiters yet. Create the first recruiter account above."/> : recruiters.map((recruiter) => <article className="card application" key={recruiter.id}><div><b>{recruiter.name}</b><p>{recruiter.active ? "Active · can sign in" : "Inactive · access disabled"}</p></div><button onClick={() => onActivate(recruiter.id, !recruiter.active)}>{recruiter.active ? "Deactivate" : "Activate"}</button></article>)}</main>;
}

function AdminDashboard({ profile }: { profile: Profile }) {
  const [activePage, setActivePage] = useState("home");
  useWorkspaceNavigation(activePage, setActivePage);
  const token = localStorage.getItem(TOKEN_KEY) || "";
  const [jobs, setJobs] = useState<any[]>([]), [recruiters, setRecruiters] = useState<any[]>([]), [dashboard, setDashboard] = useState<any[]>([]), [recent, setRecent] = useState<{ applications: any[]; interviews: any[] }>({ applications: [], interviews: [] }), [dataLoading, setDataLoading] = useState(true), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [form, setForm] = useState({ title: "", department: "", location: "", job_type: "full-time", description: "", requirements: "", deadline: "", openings: "1" });
  const [recruiterForm, setRecruiterForm] = useState({ name: "", phone: "", email: "", password: "" });
  const [showRecruiterForm, setShowRecruiterForm] = useState(false);
  async function refresh() {
    setError("");
    const failures: string[] = [];
    // Keep these admin reads sequential: they share the backend's Supabase client,
    // and a burst of concurrent reads can trigger transient connection read errors.
    const reads: Array<[string, (value: any) => void]> = [
      ["jobs", setJobs],
      ["recruiters", setRecruiters],
      ["dashboard", setDashboard],
      ["recent activity", setRecent],
    ];
    for (const [label, update] of reads) {
      try {
        const endpoint = label === "recent activity" ? "/admin/recent-activity" : `/admin/${label}`;
        update(await request(endpoint, {}, token));
      } catch (reason) {
        failures.push(label);
        if (failures.length === 1) console.error(`Admin ${label} refresh failed`, reason);
      }
    }
    setError(failures.length ? `Some admin data could not be refreshed (${failures.join(", ")}). Try again.` : "");
  }
  useEffect(() => { refresh().finally(() => setDataLoading(false)); }, []);
  function change(field: string, value: string) { setForm((current) => ({ ...current, [field]: value })); }
  async function createJob(event: FormEvent) { event.preventDefault(); try { await request("/admin/jobs", { method: "POST", body: JSON.stringify({ ...form, openings: Number(form.openings), deadline: new Date(form.deadline).toISOString() }) }, token); setMessage("Draft job created."); setForm({ title: "", department: "", location: "", job_type: "full-time", description: "", requirements: "", deadline: "", openings: "1" }); await refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Job could not be created"); } }
  async function setStatus(jobId: number, status: string) { try { await request(`/admin/jobs/${jobId}/status`, { method: "PATCH", body: JSON.stringify({ status }) }, token); setMessage(`Job ${status}.`); await refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Job status could not change"); } }
  async function assign(jobId: number, recruiterId: string) { if (!recruiterId) return; setError(""); try { await request(`/admin/jobs/${jobId}/recruiters/${recruiterId}`, { method: "POST" }, token); setMessage("Recruiter assigned."); await refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Recruiter could not be assigned"); } }
  async function removeAssignment(jobId: number, recruiterId: string) { setError(""); setMessage(""); try { await request(`/admin/jobs/${jobId}/recruiters/${recruiterId}`, { method: "DELETE" }, token); setMessage("Recruiter removed from this job."); await refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Recruiter assignment could not be removed"); } }
  async function createRecruiter(event: FormEvent) { event.preventDefault(); setError(""); setMessage(""); try { await request("/admin/recruiters", { method: "POST", body: JSON.stringify(recruiterForm) }, token); setMessage(`Recruiter account created for ${recruiterForm.email}. Share the initial password securely.`); setRecruiterForm({ name: "", phone: "", email: "", password: "" }); setShowRecruiterForm(false); await refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Recruiter account could not be created"); } }
  async function activate(recruiterId: string, active: boolean) { try { await request(`/admin/recruiters/${recruiterId}/active`, { method: "PATCH", body: JSON.stringify({ active }) }, token); await refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Recruiter status could not change"); } }
  const adminLinks = [{ href: "jobs", title: "Jobs", description: `${jobs.length} roles · manage openings and assignments`, icon: "▤" }, { href: "recruiters", title: "Recruiters", description: `${recruiters.length} accounts · manage access`, icon: "♙" }, { href: "applications", title: "Application counts", description: "Monitor hiring stages across jobs", icon: "▥" }];
  const totalApplications = dashboard.reduce((total, item) => total + Number(item.total || 0), 0);
  const openJobs = jobs.filter((job) => job.status === "open").length;
  if (activePage === "recruiters") return <AdminRecruiterPage recruiters={recruiters} form={recruiterForm} onFormChange={(field, value) => setRecruiterForm((current) => ({ ...current, [field]: value }))} onCreate={createRecruiter} onActivate={activate} showCreate={showRecruiterForm} setShowCreate={setShowRecruiterForm} loading={dataLoading} error={error} message={message}/>;
  if (activePage === "jobs") return <main className="page workspace-page"><div className="workspace-top"><button className="back-home" onClick={() => setActivePage("home")}>← Overview</button><span>Job management</span></div><ErrorBanner message={error}/>{message && <p className="success" role="status">{message}</p>}<div className="section-heading admin-heading"><div><p className="eyebrow">Job management</p><h1>Jobs</h1><p className="muted">Open, close, assign, or remove recruiters from job listings.</p></div><button className="primary compact" onClick={() => setActivePage("create-job")}>＋ Create a job</button></div>{dataLoading ? <LoadingState label="Loading jobs and recruiter assignments…"/> : jobs.length === 0 ? <EmptyState message="No jobs created yet. Create the first opening."/> : jobs.map((job) => <AdminJobCard key={job.id} job={job} recruiters={recruiters} onStatus={setStatus} onAssign={assign} onRemove={removeAssignment}/> )}</main>;
  if (activePage === "home") return <main className="page workspace-page dashboard-overview"><ErrorBanner message={error}/><BentoGrid className="admin-bento">
    <BentoCard className="welcome-bento span-2"><p className="eyebrow">Administration</p><h1>Hiring operations</h1><p>Good morning, {profile.name}. Here’s a live snapshot of jobs, recruiter access, and the hiring pipeline.</p><div className="welcome-meta"><span>◈ Centralized hiring</span><span>◎ Human-led decisions</span></div></BentoCard>
    <MetricCard label="Open jobs" value={dataLoading ? "—" : openJobs} detail={`${jobs.length} total job${jobs.length === 1 ? "" : "s"}`} icon="▤"/>
    <MetricCard label="Active applications" value={dataLoading ? "—" : dashboard.reduce((total, item) => total + Number(item.counts?.Applied || 0) + Number(item.counts?.Shortlisted || 0) + Number(item.counts?.Interview || 0) + Number(item.counts?.Offer || 0), 0)} detail="Excludes completed outcomes" tone="mint" icon="↗"/>
    <MetricCard label="Recruiter accounts" value={dataLoading ? "—" : recruiters.length} detail={`${recruiters.filter((item) => item.active).length} active`} tone="blue" icon="♙"/>
    <BentoCard eyebrow="Portfolio" title="Job management" action={<button className="card-action" onClick={() => setActivePage("jobs")}>Manage jobs →</button>}>
      <div className="management-stat"><strong>{openJobs}</strong><span>open roles</span></div><p className="muted">{jobs.filter((job) => job.status === "draft").length} drafts · {jobs.filter((job) => job.status === "closed").length} closed</p><button className="secondary-action" onClick={() => setActivePage("create-job")}>＋ Create a job</button>
    </BentoCard>
    <BentoCard eyebrow="Team access" title="User management" action={<button className="card-action" onClick={() => setActivePage("recruiters")}>Manage recruiters →</button>}>
      <div className="management-stat"><strong>{recruiters.filter((item) => item.active).length}</strong><span>active recruiters</span></div><p className="muted">Activate or deactivate recruiter accounts and control access.</p>
    </BentoCard>
    <BentoCard className="span-2" eyebrow="Recent activity" title="Latest applications" action={<button className="card-action" onClick={() => setActivePage("applications")}>View pipeline →</button>}>
      <ActivityList items={recent.applications.slice(0, 4)} loading={dataLoading} empty="No applications have been submitted yet." renderItem={(item) => <div className="activity-row" key={item.id}><div><b>{item.profiles?.name || "Candidate"}</b><small>{item.jobs?.title || "Job"} · {new Date(item.created_at).toLocaleDateString()}</small></div><StatusPill value={item.stage}/></div>}/>
    </BentoCard>
    <BentoCard eyebrow="Coming up" title="Upcoming interviews" action={<button className="card-action" onClick={() => setActivePage("applications")}>View pipeline →</button>}>
      <ActivityList items={recent.interviews.slice(0, 4)} loading={dataLoading} empty="No interviews scheduled." renderItem={(item) => <div className="activity-row" key={item.id}><div><b>{item.application?.profiles?.name || "Candidate"}</b><small>{item.application?.jobs?.title || "Interview"} · {new Date(item.starts_at).toLocaleString()}</small></div></div>}/>
    </BentoCard>
    <BentoCard eyebrow="Automation" title="Workflow health"><div className="workflow-info"><span className="workflow-orb">n8n</span><div><b>AI summaries & email notifications</b><small>Connected through configured n8n workflows</small></div></div><p className="muted">Live workflow health is not reported by the current API.</p></BentoCard>
    <BentoCard className="quick-actions" eyebrow="Workspace" title="Management shortcuts"><HomeLinks items={adminLinks} onSelect={setActivePage}/></BentoCard>
  </BentoGrid></main>;
  if (activePage === "home") return <main className="page workspace-page"><section className="welcome"><p className="eyebrow">Administration</p><h1>Hiring operations</h1><p className="muted">Good morning, {profile.name}. Here’s the latest across your hiring team.</p></section><section className="admin-overview-stats"><article><span>All jobs</span><b>{jobs.length}</b></article><article><span>Active recruiters</span><b>{recruiters.filter((item) => item.active).length}</b></article><article><span>Applications</span><b>{dashboard.reduce((total, item) => total + Number(item.total || 0), 0)}</b></article></section><section className="home-activity-grid"><article className="card"><div className="activity-heading"><div><p className="eyebrow">Recently received</p><h2>Latest applications</h2></div><button onClick={() => setActivePage("applications")}>View counts →</button></div>{recent.applications.length === 0 ? <p className="muted">No applications have been submitted yet.</p> : recent.applications.slice(0, 4).map((item) => <div className="activity-row" key={item.id}><div><b>{item.profiles?.name || "Candidate"}</b><small>{item.jobs?.title || "Job"} · {new Date(item.created_at).toLocaleDateString()}</small></div><span className="status-pill">{item.stage}</span></div>)}</article><article className="card"><div className="activity-heading"><div><p className="eyebrow">On the calendar</p><h2>Upcoming interviews</h2></div><button onClick={() => setActivePage("applications")}>View pipeline →</button></div>{recent.interviews.length === 0 ? <p className="muted">No interviews scheduled.</p> : recent.interviews.slice(0, 4).map((item) => <div className="activity-row" key={item.id}><div><b>{item.application?.profiles?.name || "Candidate"}</b><small>{item.application?.jobs?.title || "Interview"} · {new Date(item.starts_at).toLocaleString()}</small></div></div>)}</article></section><HomeLinks items={adminLinks} onSelect={setActivePage}/></main>;
  const adminPage = activePage === "home" ? <><section className="welcome"><p className="eyebrow">Administration</p><h1>Hiring operations</h1><p className="muted">A clear view of open roles, recruiter access, and application progress.</p></section><section className="admin-overview-stats"><article><span>All jobs</span><b>{jobs.length}</b></article><article><span>Active recruiters</span><b>{recruiters.filter((item) => item.active).length}</b></article><article><span>Applications</span><b>{dashboard.reduce((total, item) => total + Number(item.total || 0), 0)}</b></article></section><HomeLinks items={adminLinks} onSelect={setActivePage}/></> : activePage === "jobs" ? <section><div className="section-heading admin-heading"><div><p className="eyebrow">Job management</p><h1>Jobs</h1><p className="muted">Open, close, and assign recruiters to job listings.</p></div><button className="primary compact" onClick={() => setActivePage("create-job")}>＋ Create a job</button></div>{jobs.length === 0 && <p className="empty-state">No jobs created yet. Create the first opening.</p>}{jobs.map((job) => <article className="card" key={job.id}><div className="job-card-head"><div><h3>{job.title}</h3><p>{job.department} · {job.location} · {job.openings} openings</p></div><span className={`status-pill status-${job.status}`}>{job.status}</span></div><div className="actions">{job.status === "draft" && <button onClick={() => setStatus(job.id, "open")}>Open job</button>}{job.status === "open" && <button onClick={() => setStatus(job.id, "closed")}>Close job</button>}{job.status === "closed" && <button onClick={() => setStatus(job.id, "open")}>Reopen job</button>}<select defaultValue="" aria-label={`Assign recruiter to ${job.title}`} onChange={(event) => assign(job.id, event.target.value)}><option value="">Assign recruiter</option>{recruiters.filter((r) => r.active).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div></article>)}</section> : activePage === "create-job" ? <section><div className="section-heading"><p className="eyebrow">New opening</p><h1>Create a job</h1><p className="muted">Add the role details, then open it when it is ready for candidates.</p></div><section className="card"><form className="admin-form" onSubmit={createJob}><input required placeholder="Job title" value={form.title} onChange={(e) => change("title", e.target.value)}/><input required placeholder="Department" value={form.department} onChange={(e) => change("department", e.target.value)}/><input required placeholder="Location" value={form.location} onChange={(e) => change("location", e.target.value)}/><select value={form.job_type} onChange={(e) => change("job_type", e.target.value)}><option value="full-time">Full-time</option><option value="part-time">Part-time</option><option value="internship">Internship</option></select><input required type="datetime-local" value={form.deadline} onChange={(e) => change("deadline", e.target.value)}/><input required type="number" min="1" placeholder="Openings" value={form.openings} onChange={(e) => change("openings", e.target.value)}/><textarea required placeholder="Description" value={form.description} onChange={(e) => change("description", e.target.value)}/><textarea required placeholder="Requirements" value={form.requirements} onChange={(e) => change("requirements", e.target.value)}/><div className="form-actions"><button type="button" onClick={() => setActivePage("jobs")}>Cancel</button><button className="primary compact" type="submit">Create draft</button></div></form></section></section> : activePage === "recruiters" ? <section><div className="section-heading"><p className="eyebrow">Team access</p><h1>Recruiters</h1><p className="muted">Activate or deactivate recruiter accounts.</p></div>{recruiters.map((recruiter) => <article className="card application" key={recruiter.id}><div><b>{recruiter.name}</b><p>{recruiter.active ? "Active · can sign in" : "Inactive · access disabled"}</p></div><button onClick={() => activate(recruiter.id, !recruiter.active)}>{recruiter.active ? "Deactivate" : "Activate"}</button></article>)}</section> : <section><div className="section-heading"><p className="eyebrow">Hiring pipeline</p><h1>Application counts</h1><p className="muted">Applications grouped by their current stage for each job.</p></div>{dashboard.length === 0 && <p className="empty-state">There are no application counts to show yet.</p>}{dashboard.map((item) => <article className="card" key={item.job.id}><h3>{item.job.title} · {item.total} total</h3><div className="counts">{Object.entries(item.counts).map(([stage, count]) => <span key={stage}>{stage}: <b>{String(count)}</b></span>)}</div></article>)}</section>;
  if (activePage !== "legacy") return <main className="page workspace-page"><div className="workspace-top"><button className="back-home" onClick={() => setActivePage("home")}>← Overview</button><span>Administration</span></div>{message && <p className="success">{message}</p>}{error && <p className="error">{error}</p>}<div className="view-transition" key={activePage}>{adminPage}</div></main>;
  return <main className="page"><section className="welcome"><p className="eyebrow">Admin workspace</p><h1>Hiring dashboard</h1><p className="muted">Create jobs, manage recruiters, assign ownership, and monitor the hiring pipeline.</p></section>{message && <p className="success">{message}</p>}{error && <p className="error">{error}</p>}<section className="card"><h2>Create draft job</h2><form className="admin-form" onSubmit={createJob}><input required placeholder="Job title" value={form.title} onChange={(e) => change("title", e.target.value)}/><input required placeholder="Department" value={form.department} onChange={(e) => change("department", e.target.value)}/><input required placeholder="Location" value={form.location} onChange={(e) => change("location", e.target.value)}/><select value={form.job_type} onChange={(e) => change("job_type", e.target.value)}><option value="full-time">Full-time</option><option value="part-time">Part-time</option><option value="internship">Internship</option></select><input required type="datetime-local" value={form.deadline} onChange={(e) => change("deadline", e.target.value)}/><input required type="number" min="1" placeholder="Openings" value={form.openings} onChange={(e) => change("openings", e.target.value)}/><textarea required placeholder="Description" value={form.description} onChange={(e) => change("description", e.target.value)}/><textarea required placeholder="Requirements" value={form.requirements} onChange={(e) => change("requirements", e.target.value)}/><button className="primary compact" type="submit">Create draft</button></form></section><section><h2>Jobs and assignments</h2>{jobs.map((job) => <article className="card" key={job.id}><h3>{job.title}</h3><p>{job.status} · {job.openings} openings · {job.department}</p><div className="actions">{job.status === "draft" && <button onClick={() => setStatus(job.id, "open")}>Open job</button>}{job.status === "open" && <button onClick={() => setStatus(job.id, "closed")}>Close job</button>}{job.status === "closed" && <button onClick={() => setStatus(job.id, "open")}>Reopen job</button>}<select defaultValue="" onChange={(e) => assign(job.id, e.target.value)}><option value="">Assign recruiter</option>{recruiters.filter((r) => r.active).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div></article>)}</section><section><h2>Recruiters</h2>{recruiters.map((recruiter) => <article className="card application" key={recruiter.id}><div><b>{recruiter.name}</b><p>{recruiter.active ? "Active" : "Inactive"}</p></div><button onClick={() => activate(recruiter.id, !recruiter.active)}>{recruiter.active ? "Deactivate" : "Activate"}</button></article>)}</section><section><h2>Application counts</h2>{dashboard.map((item) => <article className="card" key={item.job.id}><h3>{item.job.title} · {item.total} total</h3><div className="counts">{Object.entries(item.counts).map(([stage, count]) => <span key={stage}>{stage}: <b>{String(count)}</b></span>)}</div></article>)}</section></main>;
}

function Dashboard({ profile, onLogout, onProfileUpdated }: { profile: Profile; onLogout: () => void; onProfileUpdated: (profile: Profile) => void }) {
  const content = profile.role === "candidate" ? <CandidateDashboard profile={profile} onProfileUpdated={onProfileUpdated}/> : profile.role === "recruiter" ? <RecruiterDashboard profile={profile} onProfileUpdated={onProfileUpdated}/> : <AdminDashboard profile={profile} />;
  return <AppShell profile={profile} onLogout={onLogout}>{content}</AppShell>;
}

function App() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState<Mode | null>(null);

  useEffect(() => { const token = localStorage.getItem(TOKEN_KEY); if (!token) { setLoading(false); return; } request("/auth/me", {}, token).then((result) => setProfile(result.user)).catch(() => localStorage.removeItem(TOKEN_KEY)).finally(() => setLoading(false)); }, []);
  function authenticated(nextProfile: Profile, token: string) { localStorage.setItem(TOKEN_KEY, token); setAuthMode(null); setProfile(nextProfile); }
  function logout() { localStorage.removeItem(TOKEN_KEY); setProfile(null); setAuthMode(null); }
  if (loading) return <div className="loading">Loading session…</div>;
  return profile ? <Dashboard profile={profile} onLogout={logout} onProfileUpdated={setProfile}/> : authMode ? <AuthForm key={authMode} initialMode={authMode} onBack={() => setAuthMode(null)} onAuthenticated={authenticated} /> : <LandingPage onLogin={() => setAuthMode("login")} onRegister={() => setAuthMode("register")} />;
}

createRoot(document.getElementById("root")!).render(<App />);
