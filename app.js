(() => {
  "use strict";

  const C = window.BCC_CONFIG || {};
  const hasConfig = C.SUPABASE_URL && !C.SUPABASE_URL.includes("YOUR_") && C.SUPABASE_ANON_KEY && !C.SUPABASE_ANON_KEY.includes("YOUR_");
  const sb = hasConfig ? window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY) : null;

  const state = {
    portal: "student",
    session: null,
    profile: null,
    view: "dashboard",
    classNo: null,
    quiz: null,
    quizQuestions: [],
    quizAnswers: {},
    quizStartedAt: null,
    quizTimer: null,
    currentLecture: null,
    route: {}
  };

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  const fmtDate = v => v ? new Date(v).toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" }) : "—";
  const fmtDateTime = v => v ? new Date(v).toLocaleString("en-IN", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" }) : "—";
  const initials = n => (n || "B").trim().split(/\s+/).map(x => x[0]).join("").slice(0,2).toUpperCase();
  const slug = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const classText = c => c ? `Class ${c}` : "Class";
  const roleLabel = p => p?.role === "admin" ? "Administrator" : "Teacher";

  function toast(message, type = "info") {
    const el = document.createElement("div");
    el.className = `toast ${type === "success" ? "success" : type === "error" ? "error" : ""}`;
    el.textContent = message;
    $("#toast-root").appendChild(el);
    setTimeout(() => el.remove(), 3300);
  }
  function loading(on, text = "Loading...") {
    $("#loader").classList.toggle("hidden", !on);
    const s = $("#loader span"); if (s) s.textContent = text;
  }
  function modal(html) {
    $("#modal-root").innerHTML = `<div class="modal-backdrop" data-modal-backdrop><div class="modal">${html}</div></div>`;
    $("#modal-root").querySelector("[data-modal-backdrop]").addEventListener("click", e => {
      if (e.target.matches("[data-modal-backdrop]")) closeModal();
    });
  }
  function closeModal() { $("#modal-root").innerHTML = ""; }

  // Browser/mobile back-button navigation for this single-page portal.
  function writeRoute(view, route = {}, replace = false) {
    state.view = view;
    state.route = route || {};

    const entry = { bccPortal: true, view, route: state.route };
    const url = `${location.pathname}${location.search}#${encodeURIComponent(view)}`;

    if (replace) {
      history.replaceState(entry, "", url);
    } else {
      history.pushState(entry, "", url);
    }
  }

  async function navigate(view, route = {}, replace = false) {
    writeRoute(view, route, replace);
    toggleSidebar(false);
    await renderView();
  }

  async function handlePopState(event) {
    // Before login there is no portal route to restore.
    if (!state.profile) return;

    // If the user reaches a history entry that belongs to the page before
    // the portal, keep the user inside the portal instead of leaving Chrome.
    if (!event.state?.bccPortal) {
      const home = state.profile.role === "student" ? "dashboard" : "admin-dashboard";
      writeRoute(home, {}, false);
      return;
    }

    state.view = event.state.view || (state.profile.role === "student" ? "dashboard" : "admin-dashboard");
    state.route = event.state.route || {};
    toggleSidebar(false);
    await renderView();
  }

  function authEmail(id) {
  const cleanId = String(id).trim();

  // Existing BCC admin account
  if (cleanId.toUpperCase() === "ADMIN") {
    return "rezanadaf9@gmail.com";
  }

  const domain = C.AUTH_EMAIL_DOMAIN || "students.bcc-portal.invalid";

  return `${cleanId
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")}@${domain}`;
}

  async function q(table, select = "*") {
    const { data, error } = await sb.from(table).select(select);
    if (error) throw error;
    return data || [];
  }

  async function currentProfile() {
    if (!sb || !state.session?.user) return null;
    const { data, error } = await sb.from("profiles").select("*").eq("id", state.session.user.id).single();
    if (error) throw error;
    return data;
  }

  async function getStudentProfile() {
    const { data, error } = await sb.from("student_profiles").select("*").eq("user_id", state.session.user.id).single();
    if (error) throw error;
    return data;
  }

  async function login() {
    if (!sb) {
      toast("Add your Supabase URL and publishable/anon key in config.js first.", "error");
      return;
    }
    const id = $("#login-id").value.trim();
    const password = $("#login-password").value;
    if (!id || !password) return toast("Enter your ID and password.", "error");
    loading(true, "Signing in...");
    try {
      const { data, error } = await sb.auth.signInWithPassword({ email: authEmail(id), password });
      if (error) throw error;
      state.session = data.session;
      state.profile = await currentProfile();
      if (!state.profile) throw new Error("Your account exists, but its BCC profile is missing.");
      if (state.portal === "student" && state.profile.role !== "student") throw new Error("This ID is not a student account.");
      if (state.portal === "teacher" && !["teacher","admin"].includes(state.profile.role)) throw new Error("This ID is not a teacher account.");
      await enterApp();
    } catch (e) {
      toast(e.message || "Login failed.", "error");
    } finally { loading(false); }
  }

  async function enterApp() {
    $("#boot-screen")?.classList.add("hidden");
    $("#login-screen").classList.add("hidden");
    $("#app-shell").classList.remove("hidden");
    $("#student-nav").classList.toggle("hidden", state.profile.role !== "student");
    $("#admin-nav").classList.toggle("hidden", state.profile.role === "student");
    $("#profile-name").textContent = state.profile.full_name || "BCCian";
    $("#profile-role").textContent = state.profile.role === "student" ? "Student" : roleLabel(state.profile);
    $("#profile-avatar").textContent = initials(state.profile.full_name);
    $("#menu-name").textContent = state.profile.full_name || "BCCian";
    $("#menu-id").textContent = state.profile.login_id || "—";
    let homeView;
    if (state.profile.role === "student") {
      const sp = await getStudentProfile();
      state.classNo = sp.class_no;
      state.student = sp;
      $("#topbar-context").textContent = `${classText(sp.class_no)} • Batch ${sp.batch}`;
      homeView = "dashboard";
    } else {
      state.classNo = null;
      $("#topbar-context").textContent = "Teacher & Administration Portal";
      homeView = "admin-dashboard";
    }

    // Create portal history entries as soon as login succeeds. This is what
    // makes the Android/iPhone browser Back button navigate between portal
    // screens instead of immediately leaving the page.
    history.pushState({ bccPortal: true, view: homeView, route: {} }, "", `${location.pathname}${location.search}#${encodeURIComponent(homeView)}`);
    state.view = homeView;
    state.route = {};

    syncNav();
    await renderView();
  }

  async function logout() {
    if (state.quizTimer) clearInterval(state.quizTimer);
    if (sb) await sb.auth.signOut();
    state.session = null; state.profile = null; state.student = null;
    state.route = {};
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    $("#app-shell").classList.add("hidden");
    $("#login-screen").classList.remove("hidden");
    $("#login-password").value = "";
    $("#login-id").value = "";
    closeProfileMenu();
  }

  function syncNav() {
    $$(".nav-item[data-view]").forEach(b => b.classList.toggle("active", b.dataset.view === state.view));
    const active = $(`.nav-item[data-view="${state.view}"]`);
    $("#topbar-section").textContent = active ? active.querySelector("span").textContent : "Dashboard";
  }

  async function renderView() {
    syncNav();
    const el = $("#view-container");
    el.innerHTML = "";
    try {
      if (state.profile.role === "student") {
        if (state.view === "dashboard") return await renderStudentDashboard(el);
        if (state.view === "lectures") return await renderLectures(el);
        if (state.view === "lectures-subject") return await renderLectureListForSubject(state.route.subjectId, false);
        if (state.view === "notes") return await renderNotes(el);
        if (state.view === "notes-subject") return await renderNotesList(state.route.subjectId, false);
        if (state.view === "homework") return await renderHomework(el);
        if (state.view === "homework-subject") return await renderHomeworkList(state.route.subjectId, false);
        if (state.view === "quizzes") return await renderQuizzes(el);
        if (state.view === "notebooklm") return await renderNotebookLM(el);
        if (state.view === "lecture-player") {
          if (!state.currentLecture || state.currentLecture.id !== state.route.lectureId) {
            return await openLecture(state.route.lectureId, false);
          }
          return await renderLecturePlayer(el);
        }
        if (state.view === "quiz-run") {
          if (!state.quiz || state.quiz.id !== state.route.quizId) {
            return await startQuiz(state.route.quizId, false);
          }
          return await renderQuizRun(el);
        }
        if (state.view === "quiz-result") {
          if (!state.lastAttempt || !state.quiz || state.quiz.id !== state.route.quizId) {
            return await showAttemptResult(state.route.quizId, false);
          }
          return await renderQuizResult(el);
        }
      } else {
        if (state.view === "admin-dashboard") return await renderAdminDashboard(el);
        if (state.view === "students") return await renderStudents(el);
        if (state.view === "content") return await renderContent(el);
        if (state.view === "quiz-manager") return await renderQuizManager(el);
        if (state.view === "marks") return await renderMarks(el);
      }
    } catch (e) {
      console.error(e);
      el.innerHTML = `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><h3>Could not load this page</h3><p>${esc(e.message)}</p></div>`;
      toast(e.message || "Something went wrong.", "error");
    }
  }

  function dashboardCard(icon, title, desc, view, extra="") {
    return `<article class="feature-card" data-go="${view}"><div class="feature-icon"><i class="${icon}"></i></div><div><h3>${title}</h3><p>${desc}</p>${extra}</div></article>`;
  }

  async function renderStudentDashboard(el) {
    const [lectures, notes, homework, quizzes, attempts] = await Promise.all([
      sb.from("lectures").select("id", { count:"exact", head:true }).eq("class_no", state.classNo),
      sb.from("notes").select("id", { count:"exact", head:true }).eq("class_no", state.classNo),
      sb.from("homework").select("id", { count:"exact", head:true }).eq("class_no", state.classNo),
      sb.from("quizzes").select("id", { count:"exact", head:true }).eq("class_no", state.classNo).eq("is_active", true),
      sb.from("quiz_attempts").select("id,score,total_marks,submitted_at").eq("student_id", state.profile.id).order("submitted_at",{ascending:false}).limit(5)
    ]);
    if (lectures.error) throw lectures.error;
    const attemptsData = attempts.data || [];
    const avg = attemptsData.length ? Math.round(attemptsData.reduce((a,x)=>a+(Number(x.score)||0),0)/attemptsData.length) : 0;
    el.innerHTML = `
      <div class="banner">
        <div><h2>Keep learning, ${esc(state.profile.full_name?.split(" ")[0] || "BCCian")}! 👋</h2><p>${classText(state.classNo)} • Batch ${esc(state.student.batch)} • Stay consistent and keep moving forward.</p></div>
        <div class="banner-icon"><i class="fa-solid fa-graduation-cap"></i></div>
      </div>
      <div class="stats-grid">
        ${metric("Lectures", lectures.count ?? 0, "Class content")}
        ${metric("Notes", notes.count ?? 0, "Study material")}
        ${metric("Active quizzes", quizzes.count ?? 0, "Available now")}
      </div>
      <h2 class="section-title">Learning</h2>
      <div class="feature-grid">
        ${dashboardCard("fa-solid fa-video","Live Lecture","Join an available live class","lectures")}
        ${dashboardCard("fa-solid fa-circle-play","Recorded Lecture","Watch recorded classes in BCC","lectures")}
        ${dashboardCard("fa-solid fa-download","Downloaded Lecture","Access downloadable lecture files","lectures")}
      </div>
      <h2 class="section-title">Study Material</h2>
      <div class="feature-grid">
        ${dashboardCard("fa-solid fa-file-lines","Today's Lecture Notes","Open notes for today's classes","notes")}
        ${dashboardCard("fa-solid fa-folder-open","Subject-wise Lecture Notes","Browse notes by subject","notes")}
        ${dashboardCard("fa-solid fa-file-arrow-down","Downloaded Lecture Notes","Open or download available notes","notes")}
      </div>
      <h2 class="section-title">Quizzes</h2>
      <div class="feature-grid">
        ${dashboardCard("fa-solid fa-circle-question","Active Quizzes","Attempt your available quizzes","quizzes")}
        ${dashboardCard("fa-solid fa-chart-simple","Recent Quiz Score",`${avg}% average across recent attempts`,"quizzes")}
        ${dashboardCard("fa-solid fa-book-open","Homework","Open subject-wise homework","homework")}
        ${dashboardCard("fa-solid fa-sparkles","AI Study Hub","NotebookLM resources, notes, lectures and doubt-solving links","notebooklm")}
      </div>`;
    $$(`[data-go]`,el).forEach(x=>x.onclick=()=>navigate(x.dataset.go));
  }

  function metric(label,value,sub){return `<div class="feature-card metric-card"><div><small>${label}</small><div class="metric-value">${esc(value)}</div><div class="metric-sub">${sub}</div></div></div>`}

  async function renderNotebookLM(el) {
    const { data, error } = await sb.from("notebooklm_resources")
      .select("*,subjects(name)")
      .eq("class_no", state.classNo)
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    if (error) throw error;
    const rows = data || [];
    const groups = [
      ["notes", "fa-solid fa-note-sticky", "Notes & summaries"],
      ["lecture", "fa-solid fa-video", "Lectures"],
      ["doubt", "fa-solid fa-circle-question", "Doubt solving"],
      ["ai", "fa-solid fa-wand-magic-sparkles", "AI study assistant"]
    ];
    el.innerHTML = `
      <div class="page-head"><div><h1>AI Study Hub</h1><p>Open the NotebookLM / Gemini study resources published for your class.</p></div></div>
      <div class="notebook-banner"><div><span class="pill active">BCC AI LEARNING</span><h2>Study smarter with your class resources</h2><p>Notes, lectures, doubt-solving and AI study links are selected by BCC for your class.</p></div><i class="fa-solid fa-sparkles"></i></div>
      <div class="resource-grid">
        ${groups.map(([type,icon,label]) => { const items=rows.filter(r=>r.resource_type===type); return `<section class="resource-group"><div class="resource-group-head"><h2><i class="${icon}"></i> ${label}</h2><span>${items.length}</span></div><div class="resource-list">${items.map(r=>`<article class="resource-card"><div class="resource-card-head"><div><span class="pill">${esc(r.subjects?.name || "Class resource")}</span><h3>${esc(r.title)}</h3></div><i class="${icon}"></i></div>${r.description?`<p>${esc(r.description)}</p>`:""}<a class="resource-link" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open resource</a></article>`).join("") || emptyInline("No resources in this category yet.")}</div></section>`; }).join("")}
      </div>`;
  }

  async function renderLectures(el) {
    const { data, error } = await sb.from("lectures").select("*,subjects(name)").eq("class_no",state.classNo).order("is_live",{ascending:false}).order("created_at",{ascending:false});
    if(error) throw error;
    const rows = data || [];
    const subjects = [...new Map(rows.map(x=>[x.subject_id, x.subjects?.name || "Other"])).entries()];
    el.innerHTML = `<div class="page-head"><div><h1>Lectures</h1><p>Choose a subject to view live and recorded lectures.</p></div></div>
      ${subjects.length ? `<div class="subject-grid">${subjects.map(([id,name])=>`<div class="subject-card" data-subject="${esc(id)}"><h3>${esc(name)}</h3><p>Open lectures for ${esc(name)}.</p><span class="subject-count">${rows.filter(x=>x.subject_id===id).length} lecture(s)</span></div>`).join("")}</div>
      <h2 class="section-title">All Lectures</h2><div class="list-stack">${rows.map(lectureRow).join("")}</div>` : empty("fa-solid fa-video","No lectures yet","Your class lectures will appear here.")}`;
    $$(".subject-card",el).forEach(c=>c.onclick=()=>renderLectureListForSubject(c.dataset.subject, true));
    $$("[data-lecture]",el).forEach(b=>b.onclick=()=>openLecture(b.dataset.lecture));
  }

  async function renderLectureListForSubject(subjectId, pushHistory = true) {
    const { data, error } = await sb.from("lectures").select("*,subjects(name)").eq("class_no",state.classNo).eq("subject_id",subjectId).order("created_at",{ascending:false});
    if(error) return toast(error.message,"error");
    if (pushHistory) writeRoute("lectures-subject", { subjectId });
    $("#view-container").innerHTML = `<div class="back-row"><button class="small-btn" id="back-lectures"><i class="fa-solid fa-arrow-left"></i> Back</button></div><div class="page-head"><div><h1>${esc(data?.[0]?.subjects?.name || "Subject")}</h1><p>Lectures stay inside the BCC portal.</p></div></div><div class="list-stack">${(data||[]).map(lectureRow).join("") || emptyInline("No lectures yet.")}</div>`;
    $("#back-lectures").onclick=()=>history.back();
    $$("[data-lecture]").forEach(b=>b.onclick=()=>openLecture(b.dataset.lecture));
  }

  function lectureRow(x) {
    const live = x.is_live ? `<span class="pill active">LIVE</span>` : "";
    const kind = x.youtube_url ? "YouTube" : x.file_path ? "Uploaded video" : "Lecture";
    return `<div class="list-item"><div class="list-main"><strong>${esc(x.title)} ${live}</strong><span>${esc(x.subjects?.name || "Subject")} • ${kind} • ${fmtDate(x.created_at)}</span></div><div class="inline"><button class="small-btn primary" data-lecture="${esc(x.id)}">${x.is_live ? "Join" : "Watch"}</button>${x.downloadable && x.file_path ? `<button class="small-btn" data-download="${esc(x.file_path)}">Download</button>`:""}</div></div>`;
  }

  async function openLecture(id, pushHistory = true) {
    const { data,error }=await sb.from("lectures").select("*,subjects(name)").eq("id",id).single();
    if(error) return toast(error.message,"error");
    state.currentLecture=data;
    if (pushHistory) writeRoute("lecture-player", { lectureId: id });
    await renderView();
  }

  async function renderLecturePlayer(el) {
    const x=state.currentLecture;
    if(!x){state.view="lectures";return renderView()}
    let media="";
    if(x.youtube_url){
      const embed=toYoutubeEmbed(x.youtube_url);
      media=embed ? `<iframe src="${esc(embed)}" title="${esc(x.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>` : `<div class="player-placeholder"><div><i class="fa-solid fa-link-slash"></i><p>Invalid YouTube URL configured by teacher.</p></div></div>`;
    } else if(x.file_path){
      const url=await signedUrl(x.file_path,3600);
      media=url ? `<video controls playsinline style="width:100%;max-height:75vh;display:block" src="${esc(url)}"></video>` : `<div class="player-placeholder"><div><i class="fa-solid fa-video-slash"></i><p>Video file is unavailable.</p></div></div>`;
    } else media=`<div class="player-placeholder"><div><i class="fa-solid fa-video"></i><p>No lecture media has been attached yet.</p></div></div>`;
    el.innerHTML=`<div class="back-row"><button class="small-btn" id="back-lecture"><i class="fa-solid fa-arrow-left"></i> Back to Lectures</button></div>
      <div class="player-wrap">${media}</div><div class="video-info"><h2>${esc(x.title)}</h2><p>${esc(x.subjects?.name || "Subject")} • ${x.is_live ? "Live lecture" : "Recorded lecture"} • ${fmtDateTime(x.created_at)}</p>${x.description?`<p>${esc(x.description)}</p>`:""}${x.downloadable&&x.file_path?`<button class="small-btn yellow" id="download-current" style="margin-top:12px"><i class="fa-solid fa-download"></i> Download lecture</button>`:""}</div>`;
    $("#back-lecture").onclick=()=>history.back();
    $("#download-current")?.addEventListener("click",async()=>downloadFile(x.file_path,x.title));
  }

  function toYoutubeEmbed(url) {
    try {
      const u=new URL(url);
      let id="";
      if(u.hostname.includes("youtu.be")) id=u.pathname.slice(1);
      if(u.hostname.includes("youtube.com")) id=u.searchParams.get("v") || (u.pathname.includes("/live/") ? u.pathname.split("/live/")[1] : u.pathname.includes("/embed/") ? u.pathname.split("/embed/")[1] : "");
      if(!id) return "";
      return `https://www.youtube.com/embed/${encodeURIComponent(id)}?rel=0`;
    } catch { return ""; }
  }

  async function renderNotes(el) {
    const {data,error}=await sb.from("notes").select("*,subjects(name)").eq("class_no",state.classNo).order("created_at",{ascending:false});
    if(error)throw error;
    const rows=data||[];
    const subjects=[...new Map(rows.map(x=>[x.subject_id,x.subjects?.name||"Other"])).entries()];
    el.innerHTML=`<div class="page-head"><div><h1>Notes</h1><p>Open PDFs and images without leaving the portal.</p></div></div>
      ${subjects.length?`<div class="subject-grid">${subjects.map(([id,name])=>`<div class="subject-card" data-note-subject="${esc(id)}"><h3>${esc(name)}</h3><p>Lecture notes and study files.</p><span class="subject-count">${rows.filter(x=>x.subject_id===id).length} file(s)</span></div>`).join("")}</div>`:empty("fa-solid fa-note-sticky","No notes yet","Your class notes will appear here.")}`;
    $$("[data-note-subject]",el).forEach(c=>c.onclick=()=>renderNotesList(c.dataset.noteSubject, true));
  }

  async function renderNotesList(subjectId, pushHistory = true) {
    const {data,error}=await sb.from("notes").select("*,subjects(name)").eq("class_no",state.classNo).eq("subject_id",subjectId).order("created_at",{ascending:false});
    if(error)return toast(error.message,"error");
    if (pushHistory) writeRoute("notes-subject", { subjectId });
    $("#view-container").innerHTML=`<div class="back-row"><button class="small-btn" id="back-notes"><i class="fa-solid fa-arrow-left"></i> Back</button></div><div class="page-head"><div><h1>${esc(data?.[0]?.subjects?.name||"Notes")}</h1><p>Open or download a note.</p></div></div><div class="list-stack">${(data||[]).map(noteRow).join("")||emptyInline("No notes yet.")}</div>`;
    $("#back-notes").onclick=()=>history.back();
    $$("[data-note]",$("#view-container")).forEach(b=>b.onclick=()=>openNote(b.dataset.note));
    $$("[data-download]",$("#view-container")).forEach(b=>b.onclick=()=>downloadFile(b.dataset.download,b.dataset.name||"download"));
  }
  function noteRow(x){return `<div class="list-item"><div class="list-main"><strong>${esc(x.title)}</strong><span>${esc(x.subjects?.name||"Subject")} • ${String(x.file_type||"file").toUpperCase()} • ${fmtDate(x.created_at)}</span></div><div class="inline"><button class="small-btn primary" data-note="${esc(x.id)}">Open</button>${x.file_path?`<button class="small-btn" data-download="${esc(x.file_path)}" data-name="${esc(x.title)}">Download</button>`:""}</div></div>`}
  async function openNote(id){
    const {data,error}=await sb.from("notes").select("*,subjects(name)").eq("id",id).single();if(error)return toast(error.message,"error");
    const url=await signedUrl(data.file_path,3600); if(!url)return toast("Could not open file.","error");
    const ext=(data.file_type||data.file_path.split(".").pop()||"").toLowerCase();
    const viewer=ext.includes("pdf")?`<iframe class="pdf-frame" src="${esc(url)}"></iframe>`:`<img class="image-preview" src="${esc(url)}" alt="${esc(data.title)}">`;
    modal(`<div class="modal-head"><h2>${esc(data.title)}</h2><button class="close-btn" data-close><i class="fa-solid fa-xmark"></i></button></div>${viewer}<div class="modal-actions"><button class="small-btn" data-download="${esc(data.file_path)}" data-name="${esc(data.title)}">Download</button></div>`);
    $("[data-close]").onclick=closeModal;$("[data-download]").onclick=()=>downloadFile(data.file_path,data.title);
  }

  async function renderHomework(el){
    const {data,error}=await sb.from("homework").select("*,subjects(name)").eq("class_no",state.classNo).order("created_at",{ascending:false});if(error)throw error;
    const rows=data||[];const subjects=[...new Map(rows.map(x=>[x.subject_id,x.subjects?.name||"Other"])).entries()];
    el.innerHTML=`<div class="page-head"><div><h1>Homework</h1><p>Subject-wise homework, PDFs, images and instructions.</p></div></div>${subjects.length?`<div class="subject-grid">${subjects.map(([id,name])=>`<div class="subject-card" data-hw-subject="${esc(id)}"><h3>${esc(name)}</h3><p>Open assigned homework.</p><span class="subject-count">${rows.filter(x=>x.subject_id===id).length} item(s)</span></div>`).join("")}</div>`:empty("fa-solid fa-book-open","No homework yet","Homework will appear here when assigned.")}`;
    $$("[data-hw-subject]",el).forEach(c=>c.onclick=()=>renderHomeworkList(c.dataset.hwSubject, true));
  }
  async function renderHomeworkList(subjectId, pushHistory = true){
    const {data,error}=await sb.from("homework").select("*,subjects(name)").eq("class_no",state.classNo).eq("subject_id",subjectId).order("created_at",{ascending:false});if(error)return toast(error.message,"error");
    $("#view-container").innerHTML=`<div class="back-row"><button class="small-btn" id="back-hw"><i class="fa-solid fa-arrow-left"></i> Back</button></div><div class="page-head"><div><h1>${esc(data?.[0]?.subjects?.name||"Homework")}</h1><p>Instructions and attached files.</p></div></div><div class="list-stack">${(data||[]).map(x=>`<div class="content-card"><h3>${esc(x.title)}</h3><p>${esc(x.instructions||"No extra instructions.")}</p><p class="mini-label">Posted ${fmtDate(x.created_at)}${x.due_date?` • Due ${fmtDate(x.due_date)}`:""}</p>${x.file_path?`<div class="inline" style="margin-top:10px"><button class="small-btn primary" data-hw="${esc(x.id)}">Open file</button><button class="small-btn" data-download="${esc(x.file_path)}" data-name="${esc(x.title)}">Download</button></div>`:""}</div>`).join("")||emptyInline("No homework yet.")}</div>`;
    $("#back-hw").onclick=()=>history.back();$$("[data-hw]").forEach(b=>b.onclick=()=>openHomework(b.dataset.hw));$$("[data-download]").forEach(b=>b.onclick=()=>downloadFile(b.dataset.download,b.dataset.name));
  }
  async function openHomework(id){const {data,error}=await sb.from("homework").select("*").eq("id",id).single();if(error)return toast(error.message,"error");const url=await signedUrl(data.file_path,3600);if(!url)return toast("Could not open file.","error");const ext=(data.file_path||"").split(".").pop().toLowerCase();const viewer=ext==="pdf"?`<iframe class="pdf-frame" src="${esc(url)}"></iframe>`:`<img class="image-preview" src="${esc(url)}" alt="">`;modal(`<div class="modal-head"><h2>${esc(data.title)}</h2><button class="close-btn" data-close><i class="fa-solid fa-xmark"></i></button></div>${viewer}<div class="modal-actions"><button class="small-btn" data-download="${esc(data.file_path)}" data-name="${esc(data.title)}">Download</button></div>`);$("[data-close]").onclick=closeModal;$("[data-download]").onclick=()=>downloadFile(data.file_path,data.title)}

  async function renderQuizzes(el){
    const {data,error}=await sb.from("quizzes").select("*,subjects(name)").eq("class_no",state.classNo).eq("is_active",true).order("start_at",{ascending:false});if(error)throw error;
    const rows=data||[];
    const attempts=await sb.from("quiz_attempts").select("quiz_id,score,total_marks,submitted_at").eq("student_id",state.profile.id);
    const done=new Map((attempts.data||[]).map(a=>[a.quiz_id,a]));
    el.innerHTML=`<div class="page-head"><div><h1>Quizzes</h1><p>Weekly, monthly and chapter-wise quizzes currently active.</p></div></div>${rows.length?`<div class="list-stack">${rows.map(x=>{const a=done.get(x.id);return `<div class="quiz-card"><h3>${esc(x.title)}</h3><div class="quiz-meta"><span class="pill">${esc(x.quiz_type)}</span><span class="pill">${esc(x.subjects?.name||"All subjects")}</span><span class="pill">${x.duration_minutes} min</span><span class="pill">${x.total_marks} marks</span>${a?`<span class="pill active">Attempted: ${a.score}/${a.total_marks}</span>`:""}</div><p class="mini-label">${x.start_at?`Starts ${fmtDateTime(x.start_at)} • `:""}${x.end_at?`Ends ${fmtDateTime(x.end_at)}`:""}</p><div style="margin-top:12px">${a?`<button class="small-btn" data-result="${x.id}">View result</button>`:`<button class="small-btn primary" data-start-quiz="${x.id}">Start quiz</button>`}</div></div>`}).join("")}</div>`:empty("fa-solid fa-circle-question","No active quiz","There is no active quiz for your class right now.")}`;
    $$("[data-start-quiz]",el).forEach(b=>b.onclick=()=>startQuiz(b.dataset.startQuiz, true));$$(`[data-result]`,el).forEach(b=>b.onclick=()=>showAttemptResult(b.dataset.result, true));
  }
  async function startQuiz(id, pushHistory = true){
    const {data,error}=await sb.from("quizzes").select("*,subjects(name)").eq("id",id).single();if(error)return toast(error.message,"error");
    if(data.start_at && new Date(data.start_at)>new Date())return toast("This quiz has not started yet.","error");
    if(data.end_at && new Date(data.end_at)<new Date())return toast("This quiz has ended.","error");
    const {data:questions,error:qerr}=await sb.from("quiz_questions_public").select("*").eq("quiz_id",id).order("position");
    if(qerr) return toast(qerr.message,"error");
    if(!questions?.length)return toast("This quiz has no questions yet.","error");
    state.quiz=data;state.quizQuestions=questions;state.quizAnswers={};state.quizStartedAt=Date.now();
    if (pushHistory) writeRoute("quiz-run", { quizId: id });
    await renderView();
  }
  async function renderQuizRun(el){
    const qz=state.quiz;if(!qz){writeRoute("quizzes", {}, false);return renderView()}
    el.innerHTML=`<div class="quiz-topbar"><div><strong>${esc(qz.title)}</strong><span class="mini-label"> • ${qz.quiz_questions.length} questions</span></div><div class="timer" id="quiz-timer"></div></div><form id="quiz-form">${qz.quiz_questions.map((q,i)=>`<div class="question-card"><h3>${i+1}. ${esc(q.question_text)}</h3>${["A","B","C","D"].map(letter=>{const key=`option_${letter.toLowerCase()}`;return q[key]?`<label class="option"><input type="radio" name="q_${q.id}" value="${letter}"><span><strong>${letter}.</strong> ${esc(q[key])}</span></label>`:""}).join("")}</div>`).join("")}<button class="primary-btn" type="submit" style="width:100%">Submit Quiz</button></form>`;
    startTimer(qz.duration_minutes*60);
    $("#quiz-form").onsubmit=async e=>{e.preventDefault();if(!confirm("Submit this quiz now?"))return;await submitQuiz()};
  }
  function startTimer(seconds){if(state.quizTimer)clearInterval(state.quizTimer);let left=seconds;const tick=()=>{const m=Math.floor(left/60),s=left%60;$("#quiz-timer").textContent=`${m}:${String(s).padStart(2,"0")}`;if(left<=0){clearInterval(state.quizTimer);submitQuiz(true)}left--};tick();state.quizTimer=setInterval(tick,1000)}
  async function submitQuiz(auto=false){
    if(!state.quiz)return;
    clearInterval(state.quizTimer);
    state.quizQuestions.forEach(q=>{const r=document.querySelector(`input[name="q_${q.id}"]:checked`);state.quizAnswers[q.id]=r?.value||null});
    loading(true,"Saving result...");
    try{
      const {data,error}=await sb.functions.invoke("submit-quiz",{body:{quiz_id:state.quiz.id,answers:state.quizAnswers}});
      if(error)throw error;
      if(data?.error)throw new Error(data.error);
      state.lastAttempt={attempt:data.attempt,answers:data.answers||[]};
      state.quizQuestions=data.questions||state.quizQuestions;
      writeRoute("quiz-result", { quizId: state.quiz.id }, true);
      await renderQuizResult();
      toast(auto?"Time ended. Your quiz was submitted.":"Quiz submitted successfully.","success");
    }catch(e){toast(e.message||"Could not submit quiz.","error")}finally{loading(false)}
  }
  async function renderQuizResult(){
    const el=$("#view-container"),a=state.lastAttempt.attempt,qz=state.quiz;
    el.innerHTML=`<div class="back-row"><button class="small-btn" id="back-quizzes"><i class="fa-solid fa-arrow-left"></i> Back to Quizzes</button></div><div class="result-card"><p class="mini-label">Quiz submitted</p><div class="score-big">${a.score}/${a.total_marks}</div><p>${a.correct_count} correct • ${a.wrong_count} wrong • ${a.unattempted_count} unattempted</p><div class="analysis-grid">${state.quizQuestions.map(q=>{const x=state.lastAttempt.answers.find(y=>y.question_id===q.id);return `<div class="analysis-item ${x?.status==="correct"?"correct":x?.status==="wrong"?"wrong":""}"><h4>${esc(q.question_text)}</h4><p>Your answer: ${esc(x?.selected_option||"Not attempted")} • Correct: ${esc(q.correct_option)} • Marks: ${x?.marks_awarded??0}</p>${q.explanation?`<p><strong>Explanation:</strong> ${esc(q.explanation)}</p>`:""}</div>`}).join("")}</div></div>`;
    $("#back-quizzes").onclick=()=>history.back();
  }
  async function showAttemptResult(quizId, pushHistory = true){
    const {data,error}=await sb.from("quiz_attempts").select("*,quizzes(*,subjects(name))").eq("quiz_id",quizId).eq("student_id",state.profile.id).order("submitted_at",{ascending:false}).limit(1).maybeSingle();
    if(error)return toast(error.message,"error");
    if(!data)return toast("No attempt found.","error");
    const {data:result,error:rerr}=await sb.functions.invoke("attempt-result",{body:{attempt_id:data.id}});
    if(rerr||result?.error)return toast(rerr?.message||result?.error||"Could not load result.","error");
    state.quiz=data.quizzes;state.lastAttempt={attempt:data,answers:result.answers||[]};state.quizQuestions=result.questions||[];
    if (pushHistory) writeRoute("quiz-result", { quizId }, false);
    await renderQuizResult();
  }

  async function renderAdminDashboard(el){
    const [students,lectures,notes,hw,quizzes,attempts]=await Promise.all([
      sb.from("student_profiles").select("id",{count:"exact",head:true}),
      sb.from("lectures").select("id",{count:"exact",head:true}),
      sb.from("notes").select("id",{count:"exact",head:true}),
      sb.from("homework").select("id",{count:"exact",head:true}),
      sb.from("quizzes").select("id",{count:"exact",head:true}).eq("is_active",true),
      sb.from("quiz_attempts").select("id",{count:"exact",head:true})
    ]);
    el.innerHTML=`<div class="banner"><div><h2>Teacher dashboard</h2><p>Manage students, class content, quizzes and marks from one place.</p></div><div class="banner-icon"><i class="fa-solid fa-chalkboard-user"></i></div></div>
      <div class="stats-grid">${metric("Students",students.count??0,"All classes")}${metric("Lectures",lectures.count??0,"Uploaded/linked")}${metric("Notes",notes.count??0,"Study files")}${metric("Homework",hw.count??0,"Assignments")}${metric("Active quizzes",quizzes.count??0,"Currently active")}${metric("Quiz attempts",attempts.count??0,"Submitted")}</div>
      <h2 class="section-title">Administration</h2><div class="feature-grid">
      ${dashboardCard("fa-solid fa-user-plus","Create Student","Generate BCC Student ID and password","students")}
      ${dashboardCard("fa-solid fa-cloud-arrow-up","Manage Content","Upload notes, homework and lectures","content")}
      ${dashboardCard("fa-solid fa-list-check","Quiz Manager","Create and configure quizzes","quiz-manager")}
      ${dashboardCard("fa-solid fa-chart-column","Marks","View quiz scores by class","marks")}</div>`;
    $$("[data-go]",el).forEach(x=>x.onclick=()=>navigate(x.dataset.go));
  }

  async function renderStudents(el){
    const {data,error}=await sb.from("student_profiles").select("*,profiles(full_name,login_id)").order("class_no").order("roll_number");if(error)throw error;
    const rows=data||[];
    el.innerHTML=`<div class="page-head"><div><h1>Students</h1><p>Create accounts and view student information.</p></div><button class="small-btn primary" id="create-student"><i class="fa-solid fa-user-plus"></i> Create student</button></div>
      <div class="table-card"><table class="data-table"><thead><tr><th>Name</th><th>ID</th><th>Class</th><th>Roll</th><th>Batch</th><th>Actions</th></tr></thead><tbody>${rows.map(x=>`<tr><td><strong>${esc(x.profiles?.full_name)}</strong></td><td>${esc(x.profiles?.login_id)}</td><td>${x.class_no}</td><td>${esc(x.roll_number)}</td><td>${esc(x.batch)}</td><td><button class="small-btn" data-student="${esc(x.id)}">View</button></td></tr>`).join("")||`<tr><td colspan="6">No students yet.</td></tr>`}</tbody></table></div>`;
    $("#create-student").onclick=showCreateStudent;
    $$("[data-student]",el).forEach(b=>b.onclick=()=>viewStudent(b.dataset.student));
  }

  function showCreateStudent(){
    modal(`<div class="modal-head"><h2>Create student</h2><button class="close-btn" data-close><i class="fa-solid fa-xmark"></i></button></div>
      <div class="form-grid"><div class="form-group"><label>Full name</label><input id="new-name" required></div><div class="form-group"><label>Class</label><select id="new-class"><option value="10">10</option><option value="12">12</option></select></div><div class="form-group"><label>Roll number</label><input id="new-roll"></div><div class="form-group"><label>Batch</label><select id="new-batch"><option value="26">26</option><option value="27">27</option></select></div><div class="form-group"><label>Initial password</label><input id="new-password" type="password" minlength="8"></div></div>
      <p class="notice" style="margin-top:14px">The system generates the ID as batch + BCC + class + first two letters of the name + random 3 digits. Passwords are handled by Supabase Auth and are not stored in plaintext by this portal.</p>
      <div class="modal-actions"><button class="small-btn" data-close>Cancel</button><button class="small-btn primary" id="save-student">Create</button></div>`);
    $$("[data-close]").forEach(x=>x.onclick=closeModal);$("#save-student").onclick=createStudent;
  }
  async function createStudent(){
    const payload={full_name:$("#new-name").value.trim(),class_no:Number($("#new-class").value),roll_number:$("#new-roll").value.trim(),batch:$("#new-batch").value,password:$("#new-password").value};
    if(!payload.full_name||!payload.password||payload.password.length<8)return toast("Name and an 8+ character password are required.","error");
    loading(true,"Creating student...");
    try{const {data,error}=await sb.functions.invoke("admin-create-user",{body:{type:"student",...payload}});if(error)throw error;if(data?.error)throw new Error(data.error);closeModal();toast(`Student created. ID: ${data.login_id}`,"success");await renderStudents($("#view-container"))}catch(e){toast(e.message||"Could not create student.","error")}finally{loading(false)}
  }
  async function viewStudent(id){
    const {data,error}=await sb.from("student_profiles").select("*,profiles(full_name,login_id)").eq("id",id).single();if(error)return toast(error.message,"error");
    const attempts=await sb.from("quiz_attempts").select("*,quizzes(title)").eq("student_id",data.user_id).order("submitted_at",{ascending:false}).limit(20);
    modal(`<div class="modal-head"><h2>${esc(data.profiles?.full_name)}</h2><button class="close-btn" data-close><i class="fa-solid fa-xmark"></i></button></div>
      <div class="stats-grid"><div class="content-card"><span class="mini-label">Student ID</span><h3>${esc(data.profiles?.login_id)}</h3></div><div class="content-card"><span class="mini-label">Class</span><h3>${data.class_no}</h3></div><div class="content-card"><span class="mini-label">Roll / Batch</span><h3>${esc(data.roll_number)} / ${esc(data.batch)}</h3></div></div>
      <h3 class="section-title">Quiz history</h3><div class="table-card"><table class="data-table"><thead><tr><th>Quiz</th><th>Score</th><th>Correct</th><th>Wrong</th><th>Date</th></tr></thead><tbody>${(attempts.data||[]).map(a=>`<tr><td>${esc(a.quizzes?.title)}</td><td>${a.score}/${a.total_marks}</td><td>${a.correct_count}</td><td>${a.wrong_count}</td><td>${fmtDate(a.submitted_at)}</td></tr>`).join("")||`<tr><td colspan="5">No attempts yet.</td></tr>`}</tbody></table></div>`);
    $("[data-close]").onclick=closeModal;
  }

  async function subjectsForClass(classNo){
    const {data,error}=await sb.from("subjects").select("*").eq("class_no",classNo).order("name");if(error)throw error;
    const rows=data||[];
    if(Number(classNo)===12){
      const arts=["History","Geography","Political Science","Economics","Hindi","Urdu","English"];
      return arts.map(name=>rows.find(x=>x.name===name)).filter(Boolean);
    }
    return rows;
  }

  async function renderContent(el){
    const subjects10=await subjectsForClass(10), subjects12=await subjectsForClass(12);
    el.innerHTML=`<div class="page-head"><div><h1>Content</h1><p>Choose a class first. Content is only visible to that class.</p></div></div>
      <div class="two-col"><div class="admin-card"><h3>Upload / add content</h3><p class="mini-label" style="margin:4px 0 15px">PDF/JPG notes and homework use Supabase Storage. Lectures can use an official YouTube URL or an uploaded video.</p>
        <div class="form-grid"><div class="form-group"><label>Class</label><select id="content-class"><option value="10">Class 10</option><option value="12">Class 12</option></select></div><div class="form-group"><label>Content type</label><select id="content-type"><option value="note">Note</option><option value="homework">Homework</option><option value="lecture">Lecture</option></select></div><div class="form-group"><label>Subject</label><select id="content-subject"></select></div><div class="form-group"><label>Title</label><input id="content-title"></div></div>
        <div id="content-extra" style="margin-top:13px"></div><div class="modal-actions"><button class="small-btn primary" id="save-content">Save content</button></div>
      </div>
      <div class="admin-card"><h3>Recent content</h3><div id="recent-content" class="list-stack" style="margin-top:12px"></div></div></div>
      <div class="admin-card notebook-admin-card" style="margin-top:16px"><h3><i class="fa-solid fa-sparkles"></i> AI Study Hub / NotebookLM</h3><p class="mini-label" style="margin:4px 0 15px">Publish a NotebookLM or Gemini resource link for Class 10 or Class 12 Arts students.</p>
        <div class="form-grid"><div class="form-group"><label>Class</label><select id="nl-class"><option value="10">Class 10</option><option value="12">Class 12</option></select></div><div class="form-group"><label>Subject</label><select id="nl-subject"></select></div><div class="form-group"><label>Resource type</label><select id="nl-type"><option value="notes">Notes &amp; summaries</option><option value="lecture">Lecture</option><option value="doubt">Doubt solving</option><option value="ai">AI study assistant</option></select></div><div class="form-group"><label>Title</label><input id="nl-title" placeholder="e.g. History Chapter 1 AI Notes"></div><div class="form-group" style="grid-column:1/-1"><label>NotebookLM / Gemini URL</label><input id="nl-url" type="url" placeholder="https://notebooklm.google.com/... or your Gemini resource link"></div><div class="form-group" style="grid-column:1/-1"><label>Description</label><textarea id="nl-description" placeholder="What should students use this resource for?"></textarea></div></div>
        <div class="modal-actions"><button class="small-btn primary" id="save-notebooklm"><i class="fa-solid fa-paper-plane"></i> Publish AI resource</button></div>
        <div id="notebooklm-admin-list" class="list-stack" style="margin-top:14px"></div>
      </div>`;
    const subMap={10:subjects10,12:subjects12};const refresh=()=>{$("#content-subject").innerHTML=(subMap[$("#content-class").value]||[]).map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join("");renderContentExtra()};const refreshNL=()=>{$("#nl-subject").innerHTML=(subMap[$("#nl-class").value]||[]).map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join("")};$("#content-class").onchange=refresh;$("#content-type").onchange=renderContentExtra;$("#nl-class").onchange=refreshNL;refresh();refreshNL();$("#save-content").onclick=saveContent;$("#save-notebooklm").onclick=saveNotebookLM;await renderRecentContent();await renderNotebookLMAdmin();
  }
  function renderContentExtra(){
    const type=$("#content-type").value;
    $("#content-extra").innerHTML=type==="lecture"?`<div class="form-grid"><div class="form-group"><label>Source</label><select id="lecture-source"><option value="youtube">YouTube URL</option><option value="upload">Upload video</option></select></div><div class="form-group"><label>Live lecture?</label><select id="lecture-live"><option value="false">No</option><option value="true">Yes</option></select></div><div class="form-group" style="grid-column:1/-1"><label>YouTube URL (if source is YouTube)</label><input id="lecture-youtube" placeholder="https://www.youtube.com/watch?v=..."></div><div class="form-group" style="grid-column:1/-1"><label>Video file (if source is upload)</label><input id="lecture-file" type="file" accept="video/*"></div><div class="form-group" style="grid-column:1/-1"><label>Description</label><textarea id="lecture-description"></textarea></div></div>`:`<div class="form-grid"><div class="form-group"><label>File (PDF/JPG/PNG)</label><input id="content-file" type="file" accept=".pdf,image/jpeg,image/png"></div><div class="form-group"><label>${type==="homework"?"Due date":"File type"}</label>${type==="homework"?`<input id="hw-due" type="date">`:`<select id="note-file-type"><option value="pdf">PDF</option><option value="jpg">JPG</option><option value="png">PNG</option></select>`}</div>${type==="homework"?`<div class="form-group" style="grid-column:1/-1"><label>Instructions</label><textarea id="hw-instructions"></textarea></div>`:""}</div>`;
  }
  async function saveContent(){
    const type=$("#content-type").value,classNo=Number($("#content-class").value),subjectId=$("#content-subject").value,title=$("#content-title").value.trim();if(!subjectId||!title)return toast("Class, subject and title are required.","error");
    loading(true,"Saving content...");
    try{
      if(type==="lecture"){
        const source=$("#lecture-source").value;let filePath=null;
        if(source==="upload"){const f=$("#lecture-file").files[0];if(!f)throw new Error("Choose a video file.");filePath=await uploadFile(f,`lectures/${classNo}/${Date.now()}-${slug(f.name)}`)}
        const {error}=await sb.from("lectures").insert({class_no:classNo,subject_id:subjectId,title,youtube_url:source==="youtube"?$("#lecture-youtube").value.trim()||null:null,file_path:filePath,is_live:$("#lecture-live").value==="true",downloadable:!!filePath,description:$("#lecture-description").value.trim()||null,created_by:state.profile.id});if(error)throw error;
      } else {
        const f=$("#content-file").files[0];if(!f)throw new Error("Choose a file.");const path=`${type}s/${classNo}/${Date.now()}-${slug(f.name)}`;const fp=await uploadFile(f,path);
        if(type==="note"){const {error}=await sb.from("notes").insert({class_no:classNo,subject_id:subjectId,title,file_path:fp,file_type:$("#note-file-type").value,created_by:state.profile.id});if(error)throw error}
        else {const {error}=await sb.from("homework").insert({class_no:classNo,subject_id:subjectId,title,file_path:fp,instructions:$("#hw-instructions").value.trim()||null,due_date:$("#hw-due").value||null,created_by:state.profile.id});if(error)throw error}
      }
      toast("Content saved.","success");$("#content-title").value="";await renderRecentContent();
    }catch(e){toast(e.message||"Could not save content.","error")}finally{loading(false)}
  }
  async function saveNotebookLM(){
    const payload={class_no:Number($("#nl-class").value),subject_id:$("#nl-subject").value||null,resource_type:$("#nl-type").value,title:$("#nl-title").value.trim(),url:$("#nl-url").value.trim(),description:$("#nl-description").value.trim()||null,is_active:true,created_by:state.profile.id};
    if(!payload.title||!payload.url)return toast("Title and resource URL are required.","error");
    if(!/^https?:\/\//i.test(payload.url))return toast("Enter a valid http/https resource URL.","error");
    loading(true,"Publishing AI resource...");
    try{const {error}=await sb.from("notebooklm_resources").insert(payload);if(error)throw error;$("#nl-title").value="";$("#nl-url").value="";$("#nl-description").value="";toast("AI resource published.","success");await renderNotebookLMAdmin()}catch(e){toast(e.message||"Could not publish AI resource.","error")}finally{loading(false)}
  }
  async function renderNotebookLMAdmin(){
    const {data,error}=await sb.from("notebooklm_resources").select("id,title,class_no,resource_type,url,is_active,created_at,subjects(name)").order("created_at",{ascending:false}).limit(20);if(error)return;
    $("#notebooklm-admin-list").innerHTML=(data||[]).map(r=>`<div class="list-item"><div class="list-main"><strong>${esc(r.title)}</strong><span>Class ${r.class_no} • ${esc(r.subjects?.name||"General")} • ${esc(r.resource_type)} • ${fmtDate(r.created_at)}</span></div><button class="small-btn danger" data-delete-nl="${r.id}">Remove</button></div>`).join("")||emptyInline("No AI resources published yet.");
    $$('[data-delete-nl]').forEach(b=>b.onclick=async()=>{if(!confirm("Remove this AI resource?"))return;const {error:e}=await sb.from("notebooklm_resources").delete().eq("id",b.dataset.deleteNl);if(e)return toast(e.message,"error");toast("AI resource removed.","success");await renderNotebookLMAdmin()});
  }

  async function renderRecentContent(){
    const [l,n,h]=await Promise.all([sb.from("lectures").select("id,title,created_at,class_no,subjects(name)").order("created_at",{ascending:false}).limit(5),sb.from("notes").select("id,title,created_at,class_no,subjects(name)").order("created_at",{ascending:false}).limit(5),sb.from("homework").select("id,title,created_at,class_no,subjects(name)").order("created_at",{ascending:false}).limit(5)]);
    const rows=[...(l.data||[]).map(x=>({...x,type:"Lecture"})),...(n.data||[]).map(x=>({...x,type:"Note"})),...(h.data||[]).map(x=>({...x,type:"Homework"}))].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,8);
    $("#recent-content").innerHTML=rows.map(x=>`<div class="list-item"><div class="list-main"><strong>${esc(x.title)}</strong><span>${x.type} • Class ${x.class_no} • ${esc(x.subjects?.name||"")}</span></div></div>`).join("")||emptyInline("No content yet.");
  }

  async function uploadFile(file,path){const {error}=await sb.storage.from("bcc-content").upload(path,file,{upsert:false,contentType:file.type});if(error)throw error;return path}
  async function signedUrl(path,seconds=3600){if(!path)return null;const {data,error}=await sb.storage.from("bcc-content").createSignedUrl(path,seconds);if(error){console.error(error);return null}return data?.signedUrl||null}
  async function downloadFile(path,name){const url=await signedUrl(path,120);if(!url)return toast("Could not create download link.","error");const a=document.createElement("a");a.href=url;a.download=name||"bcc-file";a.target="_blank";document.body.appendChild(a);a.click();a.remove()}

  async function renderQuizManager(el){
    const [qzs,subs10,subs12]=await Promise.all([sb.from("quizzes").select("*,subjects(name)").order("created_at",{ascending:false}),subjectsForClass(10),subjectsForClass(12)]);
    if(qzs.error)throw qzs.error;
    el.innerHTML=`<div class="page-head"><div><h1>Quiz Manager</h1><p>Create weekly, monthly and chapter-wise quizzes with configurable scoring.</p></div><button class="small-btn primary" id="new-quiz"><i class="fa-solid fa-plus"></i> New quiz</button></div>
      <div class="list-stack">${(qzs.data||[]).map(x=>`<div class="quiz-card"><div class="inline" style="justify-content:space-between"><div><h3>${esc(x.title)}</h3><div class="quiz-meta"><span class="pill">${esc(x.quiz_type)}</span><span class="pill">${esc(x.subjects?.name||"All")}</span><span class="pill">${x.total_marks} marks</span><span class="pill">${x.duration_minutes} min</span>${x.is_active?`<span class="pill active">Active</span>`:`<span class="pill">Inactive</span>`}</div></div><button class="small-btn" data-edit-quiz="${x.id}">Edit</button></div></div>`).join("")||emptyInline("No quizzes yet.")}</div>`;
    $("#new-quiz").onclick=()=>showQuizEditor(null,[...subs10,...subs12]);$$("[data-edit-quiz]").forEach(b=>b.onclick=()=>showQuizEditor(b.dataset.editQuiz,[...subs10,...subs12]));
  }
  async function showQuizEditor(id,subjects){
    let quiz=null,questions=[];
    if(id){const {data,error}=await sb.from("quizzes").select("*,quiz_questions(*)").eq("id",id).single();if(error)return toast(error.message,"error");quiz=data;questions=(data.quiz_questions||[]).sort((a,b)=>a.position-b.position)}
    modal(`<div class="modal-head"><h2>${quiz?"Edit quiz":"Create quiz"}</h2><button class="close-btn" data-close><i class="fa-solid fa-xmark"></i></button></div>
      <div class="form-grid"><div class="form-group"><label>Title</label><input id="q-title" value="${esc(quiz?.title||"")}"></div><div class="form-group"><label>Class</label><select id="q-class"><option value="10" ${quiz?.class_no===10?"selected":""}>10</option><option value="12" ${quiz?.class_no===12?"selected":""}>12</option></select></div><div class="form-group"><label>Type</label><select id="q-type">${["Weekly","Monthly","Chapter-wise"].map(x=>`<option ${quiz?.quiz_type===x?"selected":""}>${x}</option>`).join("")}</select></div><div class="form-group"><label>Subject</label><select id="q-subject">${subjects.map(s=>`<option value="${s.id}" ${quiz?.subject_id===s.id?"selected":""}>Class ${s.class_no} • ${esc(s.name)}</option>`).join("")}</select></div><div class="form-group"><label>Duration (minutes)</label><input id="q-duration" type="number" value="${quiz?.duration_minutes||30}"></div><div class="form-group"><label>Total marks</label><input id="q-total" type="number" value="${quiz?.total_marks||0}"></div><div class="form-group"><label>Start</label><input id="q-start" type="datetime-local" value="${localInput(quiz?.start_at)}"></div><div class="form-group"><label>End</label><input id="q-end" type="datetime-local" value="${localInput(quiz?.end_at)}"></div><div class="form-group"><label>Active</label><select id="q-active"><option value="true" ${quiz?.is_active!==false?"selected":""}>Yes</option><option value="false" ${quiz?.is_active===false?"selected":""}>No</option></select></div></div>
      <h3 class="section-title">Questions</h3><div id="question-editor">${questions.map(questionEditor).join("")}</div><button class="small-btn" id="add-question"><i class="fa-solid fa-plus"></i> Add question</button>
      <div class="modal-actions"><button class="small-btn" data-close>Cancel</button><button class="small-btn primary" id="save-quiz">${quiz?"Save changes":"Create quiz"}</button></div>`);
    $$("[data-close]").forEach(x=>x.onclick=closeModal);let idx=questions.length;$("#add-question").onclick=()=>{idx++;$("#question-editor").insertAdjacentHTML("beforeend",questionEditor({position:idx,id:"",question_text:"",option_a:"",option_b:"",option_c:"",option_d:"",correct_option:"A",correct_marks:4,wrong_marks:-1,explanation:""}))};$("#save-quiz").onclick=()=>saveQuiz(quiz?.id||null);
  }
  function questionEditor(q){return `<div class="admin-card q-editor" data-q-editor style="margin-bottom:10px"><div class="form-group"><label>Question</label><textarea data-field="question_text">${esc(q.question_text||"")}</textarea></div><div class="form-grid" style="margin-top:10px">${["a","b","c","d"].map(k=>`<div class="form-group"><label>Option ${k.toUpperCase()}</label><input data-field="option_${k}" value="${esc(q[`option_${k}`]||"")}"></div>`).join("")}<div class="form-group"><label>Correct option</label><select data-field="correct_option">${["A","B","C","D"].map(x=>`<option ${q.correct_option===x?"selected":""}>${x}</option>`).join("")}</select></div><div class="form-group"><label>Correct marks</label><input data-field="correct_marks" type="number" value="${q.correct_marks??4}"></div><div class="form-group"><label>Wrong marks</label><input data-field="wrong_marks" type="number" value="${q.wrong_marks??-1}"></div></div><div class="form-group" style="margin-top:10px"><label>Explanation</label><textarea data-field="explanation">${esc(q.explanation||"")}</textarea></div></div>`}
  function localInput(v){if(!v)return "";const d=new Date(v);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}
  async function saveQuiz(id){
    const editors=$$("[data-q-editor]"),qs=editors.map((box,i)=>{const o={position:i+1};$$( "[data-field]",box).forEach(x=>o[x.dataset.field]=x.value);o.correct_marks=Number(o.correct_marks);o.wrong_marks=Number(o.wrong_marks);return o}).filter(q=>q.question_text.trim());
    const payload={title:$("#q-title").value.trim(),class_no:Number($("#q-class").value),quiz_type:$("#q-type").value,subject_id:$("#q-subject").value,duration_minutes:Number($("#q-duration").value),total_marks:Number($("#q-total").value),start_at:$("#q-start").value?new Date($("#q-start").value).toISOString():null,end_at:$("#q-end").value?new Date($("#q-end").value).toISOString():null,is_active:$("#q-active").value==="true",created_by:state.profile.id};
    if(!payload.title||!qs.length)return toast("Quiz title and at least one question are required.","error");
    loading(true,"Saving quiz...");
    try{let quizId=id;if(id){const {error}=await sb.from("quizzes").update(payload).eq("id",id);if(error)throw error;const {error:e}=await sb.from("quiz_questions").delete().eq("quiz_id",id);if(e)throw e}else{const {data,error}=await sb.from("quizzes").insert(payload).select().single();if(error)throw error;quizId=data.id}
      const {error:e2}=await sb.from("quiz_questions").insert(qs.map(q=>({...q,quiz_id:quizId})));if(e2)throw e2;closeModal();toast("Quiz saved.","success");await renderQuizManager($("#view-container"))
    }catch(e){toast(e.message,"error")}finally{loading(false)}
  }

  async function renderMarks(el){
    const {data,error}=await sb.from("quiz_attempts").select("*,quizzes(title),student_profiles(profiles(full_name,login_id),class_no)").order("submitted_at",{ascending:false}).limit(100);if(error)throw error;
    el.innerHTML=`<div class="page-head"><div><h1>Marks</h1><p>Quiz scores submitted by students.</p></div></div><div class="table-card"><table class="data-table"><thead><tr><th>Student</th><th>ID</th><th>Class</th><th>Quiz</th><th>Score</th><th>Correct</th><th>Wrong</th><th>Date</th></tr></thead><tbody>${(data||[]).map(a=>`<tr><td><strong>${esc(a.student_profiles?.profiles?.full_name)}</strong></td><td>${esc(a.student_profiles?.profiles?.login_id)}</td><td>${a.student_profiles?.class_no}</td><td>${esc(a.quizzes?.title)}</td><td>${a.score}/${a.total_marks}</td><td>${a.correct_count}</td><td>${a.wrong_count}</td><td>${fmtDate(a.submitted_at)}</td></tr>`).join("")||`<tr><td colspan="8">No marks yet.</td></tr>`}</tbody></table></div>`;
  }

  function empty(icon,title,text){return `<div class="empty-state"><i class="${icon}"></i><h3>${title}</h3><p>${text}</p></div>`}
  function emptyInline(t){return `<div class="empty-state"><p>${t}</p></div>`}

  function closeProfileMenu(){const m=$("#profile-menu");m.classList.add("hidden");$("#profile-button").setAttribute("aria-expanded","false")}
  function toggleProfile(){const m=$("#profile-menu"),show=m.classList.contains("hidden");m.classList.toggle("hidden",!show);$("#profile-button").setAttribute("aria-expanded",String(show))}
  async function setup(){
    window.addEventListener("popstate", handlePopState);
    $$(".portal-tab").forEach(b=>b.onclick=()=>{$$(".portal-tab").forEach(x=>x.classList.remove("active"));b.classList.add("active");state.portal=b.dataset.portal;$("#login-hint").textContent=state.portal==="student"?"Student login: use the Student ID given by BCC.":"Teacher login: use the teacher/admin ID given by BCC."});
    $("#login-form").onsubmit=e=>{e.preventDefault();login()};
    $$("[data-toggle-password]").forEach(b=>b.onclick=()=>{const i=$(b.dataset.togglePassword);i.type=i.type==="password"?"text":"password";b.innerHTML=`<i class="fa-regular fa-eye${i.type==="password"?"":"-slash"}"></i>`});
    $$(".logout-btn").forEach(b=>b.onclick=logout);
    $("#profile-button").onclick=e=>{e.stopPropagation();toggleProfile()};document.addEventListener("click",e=>{if(!e.target.closest(".profile-menu-wrap"))closeProfileMenu()});
    $("#sidebar-open").onclick=()=>toggleSidebar(true);$("#sidebar-close").onclick=()=>toggleSidebar(false);$("#mobile-overlay").onclick=()=>toggleSidebar(false);
    $$(".nav-item[data-view]").forEach(b=>b.onclick=()=>navigate(b.dataset.view));
    if(!hasConfig){showLoginScreen();toast("Configure config.js with your Supabase project before logging in.","error");return;}
    if(sb){
      try{
        const {data}=await sb.auth.getSession();
        if(data.session){
          state.session=data.session;
          state.profile=await currentProfile();
          if(state.profile){await enterApp();return;}
        }
      }catch(e){console.error(e);try{await sb.auth.signOut()}catch(_){} }
      showLoginScreen();
    } else showLoginScreen();
  }
  function showLoginScreen(){
    $("#boot-screen")?.classList.add("hidden");
    $("#login-screen")?.classList.remove("hidden");
    $("#app-shell")?.classList.add("hidden");
  }
  function toggleSidebar(open){$("#sidebar").classList.toggle("open",open);$("#mobile-overlay").classList.toggle("open",open)}
  document.addEventListener("DOMContentLoaded",setup);
})();
