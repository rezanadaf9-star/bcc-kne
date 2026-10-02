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
    quizSessionId: null,
    quizExpiresAt: null,
    quizSecurity: { active: false, submitting: false, allowExit: false, reason: null },
    quizGuardInstalled: false,
    currentLecture: null,
    route: {}
  };

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  const fmtDate = v => v ? new Date(v).toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" }) : "—";
  const fmtDateTime = v => v ? new Date(v).toLocaleString("en-IN", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" }) : "—";
  const initials = n => (n || "B").trim().split(/\s+/).map(x => x[0]).join("").slice(0,2).toUpperCase();
  async function addPhotoUrls(rows) {
    const list = rows || [];
    const paths = [...new Set(list.map(r => r.photo_path).filter(Boolean))];
    if (!paths.length) return list;
    try {
      const { data, error } = await sb.storage.from("student-photos").createSignedUrls(paths, 3600);
      if (error) throw error;
      const map = new Map(paths.map((p,i) => [p, data?.[i]?.signedUrl ? `${data[i].signedUrl}${data[i].signedUrl.includes("?") ? "&" : "?"}photo_v=${encodeURIComponent(p + Date.now())}` : ""]));
      return list.map(r => ({ ...r, photo_url: map.get(r.photo_path) || "" }));
    } catch (e) {
      console.warn("Student photo URLs could not be generated", e);
      return list;
    }
  }
  async function studentPhotoUrl(path) {
    if (!path) return "";
    try {
      const { data, error } = await sb.storage.from("student-photos").createSignedUrl(path, 3600);
      if (error) throw error;
      return data?.signedUrl ? `${data.signedUrl}${data.signedUrl.includes("?") ? "&" : "?"}photo_v=${encodeURIComponent(path + Date.now())}` : "";
    } catch (e) {
      console.warn("Student photo URL could not be generated", e);
      return "";
    }
  }
  async function loadProfileAvatar(path, name) {
    const avatar = $("#profile-avatar");
    if (!avatar) return;
    avatar.innerHTML = esc(initials(name));
    if (!path) return;
    const url = await studentPhotoUrl(path);
    if (!url) return;
    const img = new Image();
    img.className = "avatar-image";
    img.alt = name || "Profile";
    img.onload = () => { avatar.innerHTML = ""; avatar.appendChild(img); };
    img.onerror = () => { avatar.innerHTML = esc(initials(name)); };
    img.src = url;
  }

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
    if (state.profile?.role === "student" && state.quizSecurity?.active && state.view === "quiz-run") {
      const submitted = await submitQuiz(true, "navigation");
      if (!submitted) return;
      if (state.quizSecurity) state.quizSecurity.allowExit = true;
    }
    writeRoute(view, route, replace);
    toggleSidebar(false);
    await renderView();
  }

  async function handlePopState(event) {
    // A running quiz is a locked navigation state. If the browser Back button
    // fires, immediately restore the quiz entry and submit before leaving it.
    if (state.profile?.role === "student" && state.quizSecurity?.active && state.view === "quiz-run" && !state.quizSecurity.allowExit) {
      history.replaceState(
        { bccPortal: true, view: "quiz-run", route: { quizId: state.quiz?.id } },
        "",
        `${location.pathname}${location.search}#quiz-run`
      );
      await submitQuiz(true, "browser_back");
      return;
    }
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
    if (cleanId.toUpperCase() === "ADMIN") return "rezanadaf9@gmail.com";
    const domain = C.AUTH_EMAIL_DOMAIN || "students.bcc-portal.invalid";
    return `${cleanId.toLowerCase().replace(/[^a-z0-9._-]/g, "")}@${domain}`;
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

  async function enterApp(options = {}) {
    $("#boot-screen")?.classList.add("hidden");
    $("#login-screen").classList.add("hidden");
    $("#app-shell").classList.remove("hidden");
    $("#student-nav").classList.toggle("hidden", state.profile.role !== "student");
    $("#admin-nav").classList.toggle("hidden", state.profile.role === "student");
    $("#profile-name").textContent = state.profile.full_name || "BCCian";
    $("#profile-role").textContent = state.profile.role === "student" ? "Student" : roleLabel(state.profile);
    $("#profile-avatar").innerHTML = esc(initials(state.profile.full_name));
    $("#menu-name").textContent = state.profile.full_name || "BCCian";
    $("#menu-id").textContent = state.profile.login_id || "—";
    $("#staff-photo-action")?.classList.toggle("hidden", state.profile.role === "student");
    $("#staff-photo-action")?.querySelector("span") && ($("#staff-photo-action").querySelector("span").textContent = state.profile.photo_path ? "Replace profile photo" : "Add profile photo");
    let homeView;
    normalizeStudentRouteForRole();
    if (state.profile.role === "student") {
      const sp = options.skipStudentFetch && state.student ? state.student : await getStudentProfile();
      state.classNo = sp.class_no;
      state.student = sp;
      await loadProfileAvatar(sp.photo_path, state.profile.full_name || "Student");
      $("#topbar-context").textContent = `${classText(sp.class_no)} • Batch ${sp.batch}`;
      homeView = options.preserveRoute && state.view ? state.view : "dashboard";
    } else {
      state.classNo = null;
      await loadProfileAvatar(state.profile.photo_path, state.profile.full_name || "Administrator");
      $("#topbar-context").textContent = "Teacher & Administration Portal";
      homeView = "admin-dashboard";
    }

    // Create portal history entries as soon as login succeeds. This is what
    // makes the Android/iPhone browser Back button navigate between portal
    // screens instead of immediately leaving the page.
    if (!options.preserveRoute) {
      history.replaceState({ bccPortal: true, view: homeView, route: {} }, "", `${location.pathname}${location.search}#${encodeURIComponent(homeView)}`);
      state.view = homeView;
      state.route = {};
    }

    syncNav();
    saveIdentityCache();
    await renderView();
  }

  async function logout() {
    if (state.profile?.role === "student" && state.quizSecurity?.active) {
      const submitted = await submitQuiz(true, "logout");
      if (!submitted) return;
    }
    if (state.quizTimer) clearInterval(state.quizTimer);
    if (sb) await sb.auth.signOut();
    state.session = null; state.profile = null; state.student = null;
    state.quizSessionId = null; state.quizExpiresAt = null;
    state.quizSecurity = { active:false, submitting:false, allowExit:false, reason:null };
    try { sessionStorage.removeItem("bcc_identity_cache"); } catch (_) {}
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
    $("#topbar-section").textContent = state.view === "leaderboard-class" ? "Leaderboard" : (state.view === "marks-class" ? "Marks" : (active ? active.querySelector("span").textContent : "Dashboard"));
  }

  async function renderView() {
    syncNav();
    const el = $("#view-container");
    const previous = el.innerHTML;
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
        if (state.view === "leaderboard") return await renderStudentLeaderboard(el);
        if (state.view === "student-marks") return await renderStudentMarks(el);
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
        if (state.view === "marks-class") return await renderMarksClass(el, Number(state.route.classNo));
        if (state.view === "leaderboard") return await renderAdminLeaderboard(el);
        if (state.view === "leaderboard-class") return await renderAdminLeaderboardClass(el, Number(state.route.classNo));
      }
    } catch (e) {
      console.error(e);
      if (!el.innerHTML.trim()) el.innerHTML = previous || `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><h3>Could not load this page</h3><p>${esc(e.message)}</p></div>`;
      else toast(e.message || "Something went wrong.", "error");
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
        ${dashboardCard("fa-solid fa-wand-magic-sparkles","AI Study Hub","NotebookLM resources, notes, lectures and doubt-solving links","notebooklm")}
      </div>`;
    $$(`[data-go]`,el).forEach(x=>x.onclick=()=>navigate(x.dataset.go));
  }

  function metric(label,value,sub){return `<div class="feature-card metric-card"><div><small>${label}</small><div class="metric-value">${esc(value)}</div><div class="metric-sub">${sub}</div></div></div>`}


  function rankLabel(rank){
    const n=Number(rank);
    if(!Number.isFinite(n))return "—";
    const mod100=n%100;
    if(mod100>=11&&mod100<=13)return `${n}th`;
    return `${n}${n%10===1?"st":n%10===2?"nd":n%10===3?"rd":"th"}`;
  }

  function leaderboardRow(r, showClass=false, currentStudentId=null){
    const isMe=Boolean(currentStudentId && r.student_id===currentStudentId);
    return `<tr class="${isMe?"leaderboard-me-row":""}">
      <td><strong class="rank-badge">${esc(rankLabel(r.rank))}</strong></td>
      <td><div class="leader-student"><span class="leader-avatar">${r.photo_url?`<img src="${esc(r.photo_url)}" alt="">`:esc(initials(r.full_name))}</span><span><strong>${esc(r.full_name)}${isMe?' <span class="you-badge">YOU</span>':''}</strong><span class="table-sub">${esc(r.login_id)}</span></span></div></td>
      ${showClass?`<td>Class ${esc(r.class_no)}</td>`:""}
      <td>${esc(r.score ?? r.total_score ?? 0)}${r.total_marks != null?` / ${esc(r.total_marks)}`:""}</td>
      ${(r.percentage != null || (r.total_marks != null && r.total_marks > 0))?`<td>${Number(r.percentage != null ? r.percentage : (Number(r.score ?? r.total_score ?? 0) / Number(r.total_marks)) * 100).toFixed(2)}%</td>`:""}
      ${r.attempted_quizzes != null?`<td>${esc(r.attempted_quizzes)}</td>`:""}
      <td>${r.submitted_at?fmtDate(r.submitted_at):"—"}</td>
    </tr>`;
  }

  async function fetchLatestClassQuiz(classNo){
    const {data,error}=await sb.from("quizzes")
      .select("id,title,quiz_type,total_marks,duration_minutes,created_at,start_at,class_no")
      .eq("class_no",classNo)
      .order("created_at",{ascending:false})
      .limit(1)
      .maybeSingle();
    if(error)throw error;
    return data||null;
  }

  async function renderStudentLeaderboard(el){
    const full=state.route?.full===true;
    const [cumulative,history,latestQuiz]=await Promise.all([
      sb.rpc("get_class_leaderboard",{p_class_no:state.classNo}),
      sb.rpc("get_my_quiz_history"),
      fetchLatestClassQuiz(state.classNo)
    ]);
    if(cumulative.error)throw cumulative.error;
    if(history.error)throw history.error;

    let latestRows=[];
    if(latestQuiz){
      const {data,error}=await sb.rpc("get_quiz_leaderboard",{p_quiz_id:latestQuiz.id});
      if(error)throw error;
      latestRows=await addPhotoUrls(data||[]);
    }
    cumulative.data = await addPhotoUrls(cumulative.data||[]);

    const me=(cumulative.data||[]).find(x=>x.student_id===state.profile.id);
    const latestMe=latestRows.find(x=>x.student_id===state.profile.id);
    const top=latestRows.slice(0,5);
    const historyRows=history.data||[];

    el.innerHTML=`
      <div class="page-head">
        <div><h1>Leaderboard</h1><p>${classText(state.classNo)} rankings, latest quiz performance and your quiz history.</p></div>
        ${full?`<button class="small-btn" id="leaderboard-summary"><i class="fa-solid fa-arrow-left"></i> Overview</button>`:""}
      </div>

      <div class="leaderboard-summary-grid">
        <div class="leader-stat-card">
          <span class="leader-stat-icon"><i class="fa-solid fa-ranking-star"></i></span>
          <div><span class="mini-label">Your class rank</span><strong>${me?rankLabel(me.rank):"—"}</strong><small>${me?`${Number(me.percentage).toFixed(2)}% overall`:"No quiz attempts yet"}</small></div>
        </div>
        <div class="leader-stat-card">
          <span class="leader-stat-icon"><i class="fa-solid fa-medal"></i></span>
          <div><span class="mini-label">Total marks</span><strong>${me?`${esc(me.total_score)} / ${esc(me.total_marks)}`:"0 / 0"}</strong><small>${me?`${esc(me.attempted_quizzes)} quiz${Number(me.attempted_quizzes)===1?"":"zes"} attempted`:"No attempts yet"}</small></div>
        </div>
        <div class="leader-stat-card">
          <span class="leader-stat-icon"><i class="fa-solid fa-users"></i></span>
          <div><span class="mini-label">Class size</span><strong>${(cumulative.data||[]).length}</strong><small>${classText(state.classNo)}</small></div>
        </div>
      </div>

      <section class="leaderboard-panel">
        <div class="leaderboard-panel-head">
          <div><span class="pill active">LATEST QUIZ</span><h2>${esc(latestQuiz?.title||"No quiz yet")}</h2><p>${latestQuiz?`${esc(latestQuiz.quiz_type)} • ${esc(latestQuiz.total_marks)} marks • ${fmtDate(latestQuiz.created_at)}`:"A published quiz leaderboard will appear here."}</p></div>
          ${latestQuiz&&latestRows.length?`<button class="small-btn primary" id="see-full-class"><i class="fa-solid fa-users"></i> ${full?"Class leaderboard":"See full class"}</button>`:""}
        </div>
        ${latestQuiz&&latestRows.length?`
          <div class="leaderboard-me-card">
            <div><span class="mini-label">Your latest quiz position</span><strong>${latestMe?rankLabel(latestMe.rank):"Not attempted"}</strong><small>${latestMe?`${esc(latestMe.score)}/${esc(latestMe.total_marks)} marks`:"You have not attempted this quiz."}</small></div>
            <div><i class="fa-solid fa-chart-line"></i></div>
          </div>
          <div class="table-card"><table class="data-table leaderboard-table"><thead><tr><th>Rank</th><th>Student</th><th>Marks</th><th>Date</th></tr></thead><tbody>${(full?latestRows:top).map(r=>leaderboardRow(r,false,state.profile.id)).join("")}</tbody></table></div>
          ${!full&&latestRows.length>5?`<div class="leaderboard-more"><button class="small-btn" id="see-full-class-bottom">See full class</button></div>`:""}
        `:empty("fa-solid fa-ranking-star","No leaderboard yet","The latest quiz has no submitted attempts yet.")}</section>

      <section class="leaderboard-panel">
        <div class="leaderboard-panel-head">
          <div><span class="pill">CUMULATIVE</span><h2>${classText(state.classNo)} overall ranking</h2><p>Overall ranking across all submitted quizzes, using cumulative percentage.</p></div>
          ${(cumulative.data||[]).length&&!full?`<button class="small-btn primary" id="see-full-cumulative"><i class="fa-solid fa-users"></i> See full ranking</button>`:""}
        </div>
        ${(() => {
          const all=cumulative.data||[];
          const top=all.slice(0,5);
          const meRow=all.find(r=>r.student_id===state.profile.id);
          const visible=full?all:(meRow&&!top.some(r=>r.student_id===meRow.student_id)?[...top,meRow]:top);
          return all.length ? `<div class="table-card"><table class="data-table leaderboard-table"><thead><tr><th>Rank</th><th>Student</th><th>Total marks</th><th>Percentage</th><th>Quizzes</th><th>Last submission</th></tr></thead><tbody>${visible.map(r=>leaderboardRow(r,false,state.profile.id)).join("")}</tbody></table></div>` : empty("fa-solid fa-ranking-star","No overall ranking yet","No submitted quiz attempts yet.");
        })()}
      </section>

      <section class="leaderboard-panel">
        <div class="leaderboard-panel-head"><div><span class="pill">HISTORY</span><h2>Your quiz history</h2><p>Your position is calculated within your class for each quiz you have submitted.</p></div></div>
        <div class="table-card"><table class="data-table leaderboard-table"><thead><tr><th>Quiz</th><th>Score</th><th>Rank</th><th>Date</th></tr></thead><tbody>${historyRows.map(r=>`<tr><td><strong>${esc(r.quiz_title)}</strong><span class="table-sub">${esc(r.quiz_type)}</span></td><td>${esc(r.score)} / ${esc(r.total_marks)}</td><td><strong class="rank-badge">${esc(rankLabel(r.rank))}</strong></td><td>${fmtDate(r.submitted_at)}</td></tr>`).join("")||`<tr><td colspan="4">No quiz history yet.</td></tr>`}</tbody></table></div>
      </section>`;

    $("#see-full-class")?.addEventListener("click",()=>navigate("leaderboard",{full:true}));
    $("#see-full-class-bottom")?.addEventListener("click",()=>navigate("leaderboard",{full:true}));
    $("#see-full-cumulative")?.addEventListener("click",()=>navigate("leaderboard",{full:true}));
    $("#leaderboard-summary")?.addEventListener("click",()=>navigate("leaderboard",{full:false}));
  }

  async function renderAdminLeaderboard(el){
    el.innerHTML=`
      <div class="page-head"><div><h1>Leaderboard</h1><p>Open the cumulative ranking and quiz performance for each class.</p></div></div>
      <div class="leader-class-grid">
        <article class="leader-class-card" data-leader-class="10"><span><i class="fa-solid fa-graduation-cap"></i></span><div><h2>Class 10</h2><p>View Class 10 student ranks, marks and quiz performance.</p></div><i class="fa-solid fa-arrow-right"></i></article>
        <article class="leader-class-card" data-leader-class="12"><span><i class="fa-solid fa-graduation-cap"></i></span><div><h2>Class 12</h2><p>View Class 12 student ranks, marks and quiz performance.</p></div><i class="fa-solid fa-arrow-right"></i></article>
      </div>`;
    $$("[data-leader-class]",el).forEach(c=>c.onclick=()=>navigate("leaderboard-class",{classNo:Number(c.dataset.leaderClass)}));
  }

  async function renderAdminLeaderboardClass(el,classNo){
    if(![10,12].includes(classNo))return navigate("leaderboard",{},true);
    const [cumulative,latestQuiz,studentRes]=await Promise.all([
      sb.rpc("get_class_leaderboard",{p_class_no:classNo}),
      fetchLatestClassQuiz(classNo),
      sb.from("student_profiles").select("user_id,class_no,roll_number,phone,photo_path,profiles(full_name,login_id)").eq("class_no",classNo).order("roll_number")
    ]);
    if(cumulative.error)throw cumulative.error;
    if(studentRes.error)throw studentRes.error;
    cumulative.data=await addPhotoUrls(cumulative.data||[]);
    let latestRows=[];
    if(latestQuiz){
      const {data,error}=await sb.rpc("get_quiz_leaderboard",{p_quiz_id:latestQuiz.id});
      if(error)throw error;
      latestRows=await addPhotoUrls(data||[]);
    }

    const students=await addPhotoUrls(studentRes.data||[]);
    const quizRes=await sb.from("quizzes").select("id,title,total_marks,created_at").eq("class_no",classNo).order("created_at",{ascending:false});
    if(quizRes.error)throw quizRes.error;
    const quizzes=quizRes.data||[];
    const quizIds=quizzes.map(q=>q.id);
    let attempts=[];
    if(quizIds.length){
      const {data,error}=await sb.from("quiz_attempts").select("student_id,quiz_id,score,total_marks,submitted_at").in("quiz_id",quizIds).order("submitted_at",{ascending:false});
      if(error)throw error;
      attempts=data||[];
    }
    const cumulativeMap=new Map((cumulative.data||[]).map(r=>[r.student_id,r]));
    const latestMap=new Map((latestRows||[]).map(r=>[r.student_id,r]));
    const attemptMap=new Map();
    for(const a of attempts){
      if(!attemptMap.has(a.student_id))attemptMap.set(a.student_id,[]);
      const arr=attemptMap.get(a.student_id);
      if(!arr.some(x=>x.quiz_id===a.quiz_id))arr.push(a);
    }
    const monitor=students.map(s=>{
      const hist=attemptMap.get(s.user_id)||[];
      const latestAttempt=hist[0]||null;
      const previousAttempt=hist[1]||null;
      const latestPct=latestAttempt&&Number(latestAttempt.total_marks)>0?(Number(latestAttempt.score)/Number(latestAttempt.total_marks))*100:null;
      const previousPct=previousAttempt&&Number(previousAttempt.total_marks)>0?(Number(previousAttempt.score)/Number(previousAttempt.total_marks))*100:null;
      const change=latestPct!=null&&previousPct!=null?latestPct-previousPct:null;
      return {student:s,cumulative:cumulativeMap.get(s.user_id),latest:latestMap.get(s.user_id),latestAttempt,previousAttempt,latestPct,previousPct,change,count:hist.length};
    });
    const rankMap=new Map((cumulative.data||[]).map(r=>[r.student_id,r.rank]));
    monitor.sort((a,b)=>String(a.student.roll_number||"").localeCompare(String(b.student.roll_number||""),undefined,{numeric:true,sensitivity:"base"}));
    const rows=cumulative.data||[];
    el.innerHTML=`
      <div class="back-row"><button class="small-btn" id="back-leaderboard"><i class="fa-solid fa-arrow-left"></i> Back to Classes</button></div>
      <div class="page-head"><div><h1>Class ${classNo} Leaderboard</h1><p>Quiz performance, cumulative ranking and student-wise academic monitoring.</p></div></div>
      <div class="stats-grid">
        ${metric("Students",students.length,`Class ${classNo}`)}
        ${metric("Quiz attempts",rows.reduce((n,x)=>n+Number(x.attempted_quizzes||0),0),"Submitted attempts")}
        ${metric("Top percentage",rows[0]?`${Number(rows[0].percentage).toFixed(2)}%`:"—","Current cumulative leader")}
      </div>
      <section class="leaderboard-panel">
        <div class="leaderboard-panel-head"><div><span class="pill">CUMULATIVE</span><h2>All Class ${classNo} students</h2><p>Overall percentage across all submitted quizzes.</p></div></div>
        <div class="table-card"><table class="data-table leaderboard-table"><thead><tr><th>Rank</th><th>Student</th><th>Total score</th><th>Percentage</th><th>Quizzes</th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong class="rank-badge">${esc(rankLabel(r.rank))}</strong></td><td><div class="leader-student"><span class="leader-avatar">${r.photo_url?`<img src="${esc(r.photo_url)}" alt="">`:esc(initials(r.full_name))}</span><span><strong>${esc(r.full_name)}</strong><span class="table-sub">${esc(r.login_id||"")}</span></span></div></td><td>${esc(r.total_score)} / ${esc(r.total_marks)}</td><td>${Number(r.percentage).toFixed(2)}%</td><td>${esc(r.attempted_quizzes)}</td></tr>`).join("")||`<tr><td colspan="5">No students found.</td></tr>`}</tbody></table></div>
      </section>
      <section class="leaderboard-panel">
        <div class="leaderboard-panel-head"><div><span class="pill active">LATEST QUIZ</span><h2>${esc(latestQuiz?.title||"No quiz yet")}</h2><p>${latestQuiz?"Latest published quiz leaderboard for this class.":"No quiz has been published for this class yet."}</p></div></div>
        <div class="table-card"><table class="data-table leaderboard-table"><thead><tr><th>Rank</th><th>Student</th><th>Marks</th><th>Percentage</th><th>Date</th></tr></thead><tbody>${latestRows.map(r=>leaderboardRow(r)).join("")||`<tr><td colspan="5">No submitted attempts for the latest quiz.</td></tr>`}</tbody></table></div>
      </section>
      <section class="leaderboard-panel">
        <div class="leaderboard-panel-head"><div><span class="pill">STUDENT MONITORING</span><h2>Class ${classNo} quiz performance</h2><p>Individual student progress, marks, percentage and change from the previous submitted quiz.</p></div></div>
        <div class="table-card"><table class="data-table leaderboard-table quiz-monitor-table"><thead><tr><th>Rank</th><th>Student</th><th>Roll</th><th>Total marks</th><th>Overall %</th><th>Latest quiz</th><th>Change</th><th>Quizzes</th></tr></thead><tbody>
          ${monitor.map(x=>{const c=x.cumulative,l=x.latestAttempt;const change=x.change;const changeHtml=change==null?`<span class="trend neutral">—</span>`:change>0?`<span class="trend up"><i class="fa-solid fa-arrow-up"></i> +${change.toFixed(2)}%</span>`:change<0?`<span class="trend down"><i class="fa-solid fa-arrow-down"></i> ${change.toFixed(2)}%</span>`:`<span class="trend neutral"><i class="fa-solid fa-minus"></i> 0.00%</span>`;return `<tr><td><strong class="rank-badge">${esc(rankLabel(rankMap.get(x.student.user_id)))}</strong></td><td><div class="leader-student"><span class="leader-avatar">${x.student.photo_url?`<img src="${esc(x.student.photo_url)}" alt="">`:esc(initials(x.student.profiles?.full_name))}</span><span><strong>${esc(x.student.profiles?.full_name||"Student")}</strong><span class="table-sub">${esc(x.student.profiles?.login_id||"")}</span></span></div></td><td>${esc(x.student.roll_number||"—")}</td><td>${c?`${esc(c.total_score)} / ${esc(c.total_marks)}`:"0 / 0"}</td><td>${c?Number(c.percentage).toFixed(2):"0.00"}%</td><td>${l?`${esc(l.score)} / ${esc(l.total_marks)}<span class="table-sub">${Number(l.total_marks)?((Number(l.score)/Number(l.total_marks))*100).toFixed(2):"0.00"}%</span>`:"Not attempted"}</td><td>${changeHtml}</td><td>${esc(x.count)}</td></tr>`}).join("")||`<tr><td colspan="8">No student performance data yet.</td></tr>`}
        </tbody></table></div>
      </section>`;
    $("#back-leaderboard").onclick=()=>history.back();
  }

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
      <div class="notebook-banner"><div><span class="pill active">BCC AI LEARNING</span><h2>Study smarter with your class resources</h2><p>Notes, lectures, doubt-solving and AI study links are selected by BCC for your class.</p></div><i class="fa-solid fa-wand-magic-sparkles"></i></div>
      <div class="resource-grid">
        ${groups.map(([type,icon,label]) => { const items=rows.filter(r=>r.resource_type===type); return `<section class="resource-group"><div class="resource-group-head"><h2><i class="${icon}"></i> ${label}</h2><span>${items.length}</span></div><div class="resource-list">${items.map(r=>`<article class="resource-card"><div class="resource-card-head"><div><span class="pill">${esc(r.subjects?.name || "Class resource")}</span><h3>${esc(r.title)}</h3></div><i class="${icon}"></i></div>${r.description?`<p>${esc(r.description)}</p>`:""}<button class="resource-link" type="button" data-open-resource="${esc(r.id)}" data-resource-title="${esc(r.title)}" data-resource-url="${esc(r.url)}"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open Gemini</button></article>`).join("") || emptyInline("No resources in this category yet.")}</div></section>`; }).join("")}
      </div>`;
    $$("[data-open-resource]", el).forEach(b=>b.onclick=()=>openStudyResource(b.dataset.resourceTitle,b.dataset.resourceUrl));
  }
  function openStudyResource(title, url) {
    if (!url) return toast("This AI resource has no URL.", "error");
    // NotebookLM/Gemini pages may block iframe embedding. Open the exact
    // resource in its own Gemini/NotebookLM page instead of showing a broken
    // blank frame inside BCC.
    window.location.href = url;
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
    const {data,error}=await sb.from("quizzes").select("*,subjects(name)").eq("id",id).single();
    if(error)return toast(error.message,"error");
    if(data.class_no !== state.classNo)return toast("This quiz is not for your class.","error");
    if(data.start_at && new Date(data.start_at)>new Date())return toast("This quiz has not started yet.","error");
    if(data.end_at && new Date(data.end_at)<new Date())return toast("This quiz has ended.","error");

    loading(true,"Starting secure quiz...");
    try {
      const {data:sessionData,error:sessionError}=await sb.functions.invoke("start-quiz",{body:{quiz_id:id}});
      if(sessionError)throw sessionError;
      if(sessionData?.error)throw new Error(sessionData.error);

      const publicQuestions=(sessionData?.questions||[]).map(q=>({
        id:q.id ?? q.question_id,
        quiz_id:q.quiz_id,
        position:q.position ?? q.question_position,
        question_text:q.question_text,
        option_a:q.option_a,
        option_b:q.option_b,
        option_c:q.option_c,
        option_d:q.option_d
      })).sort((a,b)=>Number(a.position)-Number(b.position));

      if(!publicQuestions.length)return toast("This quiz has no questions yet.","error");
      if(publicQuestions.some(q=>!q.id))return toast("Quiz question data is incomplete. Please contact BCC staff.","error");

      state.quiz=data;
      state.quizQuestions=publicQuestions;
      state.quizAnswers={};
      state.quizStartedAt=sessionData.started_at ? new Date(sessionData.started_at).getTime() : Date.now();
      state.quizSessionId=sessionData.session_id;
      state.quizExpiresAt=sessionData.expires_at ? new Date(sessionData.expires_at).getTime() : null;
      state.quizSecurity={active:true,submitting:false,allowExit:false,reason:null};
      if (pushHistory) writeRoute("quiz-run", { quizId: id });
      await renderView();
    } catch(e) {
      toast(e.message||"Could not start the quiz.","error");
    } finally {
      loading(false);
    }
  }
  async function renderQuizRun(el){
    const qz=state.quiz;if(!qz){writeRoute("quizzes", {}, false);return renderView()}
    const questions=Array.isArray(state.quizQuestions)?state.quizQuestions:[];
    if(!questions.length){return toast("This quiz has no questions yet.","error")}
    document.body.classList.add("quiz-active");
    el.innerHTML=`<div class="quiz-run-shell">
      <div class="quiz-lock-notice"><i class="fa-solid fa-shield-halved"></i><span><strong>Quiz mode is active.</strong> Leaving this page, switching tabs/apps, or using browser Back will submit the quiz automatically.</span></div>
      <div class="quiz-topbar"><div><strong>${esc(qz.title)}</strong><span class="mini-label"> • ${questions.length} question${questions.length===1?"":"s"}</span></div><div class="timer" id="quiz-timer"></div></div>
      <form id="quiz-form">${questions.map((q,i)=>`<div class="question-card"><h3>${i+1}. ${esc(q.question_text)}</h3>${["A","B","C","D"].map(letter=>{const key=`option_${letter.toLowerCase()}`;return q[key]?`<label class="option"><input type="radio" name="q_${q.id}" value="${letter}"><span><strong>${letter}.</strong> ${esc(q[key])}</span></label>`:""}).join("")}</div>`).join("")}<button class="primary-btn" type="submit" style="width:100%">Submit Quiz</button></form></div>`;
    const secondsRemaining=state.quizExpiresAt
      ? Math.max(1,Math.ceil((state.quizExpiresAt-Date.now())/1000))
      : Number(qz.duration_minutes)*60;
    startTimer(secondsRemaining);
    $("#quiz-form").onsubmit=async e=>{e.preventDefault();if(!confirm("Submit this quiz now?"))return;await submitQuiz(false,"manual");};
    installQuizGuards();
  }
  window.renderQuizzes = renderQuizzes;

  function startTimer(seconds){
    if(state.quizTimer)clearInterval(state.quizTimer);
    let left=Math.max(1,Number(seconds)||1);
    const tick=()=>{
      const timer=$("#quiz-timer");
      if(timer){const m=Math.floor(left/60),s=left%60;timer.textContent=`${m}:${String(s).padStart(2,"0")}`;}
      if(left<=0){clearInterval(state.quizTimer);submitQuiz(true,"time_expired");return}
      left--;
    };
    tick();
    state.quizTimer=setInterval(tick,1000);
  }

  function installQuizGuards(){
    if(state.quizGuardInstalled)return;
    state.quizGuardInstalled=true;

    document.addEventListener("visibilitychange",handleQuizVisibility,{capture:true});
    window.addEventListener("pagehide",handleQuizPageHide,{capture:true});
    window.addEventListener("blur",handleQuizBlur,{capture:true});
    window.addEventListener("keydown",handleQuizKeydown,{capture:true});
    document.addEventListener("contextmenu",handleQuizContextMenu,{capture:true});
    document.addEventListener("copy",handleQuizClipboard,{capture:true});
    document.addEventListener("cut",handleQuizClipboard,{capture:true});
    document.addEventListener("paste",handleQuizClipboard,{capture:true});
    document.addEventListener("selectstart",handleQuizSelectStart,{capture:true});
  }

  function handleQuizVisibility(){
    if(document.visibilityState==="hidden" && state.quizSecurity?.active && !state.quizSecurity.submitting){
      submitQuiz(true,"tab_switch");
    }
  }

  function handleQuizPageHide(){
    // visibilitychange normally handles tab/app switches. pagehide is a final
    // best-effort fallback for navigation/closing; it never blocks the browser.
    if(state.quizSecurity?.active && !state.quizSecurity.submitting && navigator.sendBeacon){
      sendQuizBeacon("page_exit");
    }
  }

  function handleQuizBlur(){
    if(!state.quizSecurity?.active || state.quizSecurity.submitting)return;
    setTimeout(()=>{
      if(state.quizSecurity?.active && !state.quizSecurity.submitting && !document.hasFocus()){
        submitQuiz(true,"window_blur");
      }
    },300);
  }

  function handleQuizKeydown(e){
    if(!state.quizSecurity?.active)return;
    const k=String(e.key||"").toLowerCase();
    const blocked=e.key==="F12" ||
      (e.ctrlKey||e.metaKey) && ["c","u","s","p"].includes(k) ||
      (e.ctrlKey||e.metaKey) && e.shiftKey && ["i","j","c"].includes(k);
    if(blocked){e.preventDefault();e.stopPropagation();}
  }
  function handleQuizContextMenu(e){if(state.quizSecurity?.active){e.preventDefault();}}
  function handleQuizClipboard(e){if(state.quizSecurity?.active){e.preventDefault();}}
  function handleQuizSelectStart(e){if(state.quizSecurity?.active && !e.target.closest("input"))e.preventDefault();}

  function collectQuizAnswers(){
    state.quizQuestions.forEach(q=>{
      const r=document.querySelector(`input[name="q_${q.id}"]:checked`);
      state.quizAnswers[q.id]=r?.value||null;
    });
    return state.quizAnswers;
  }

  async function submitQuiz(auto=false, reason=auto?"auto":"manual"){
    if(!state.quiz || !state.quizSessionId || state.quizSecurity?.submitting) return false;
    state.quizSecurity.submitting=true;
    clearInterval(state.quizTimer);
    collectQuizAnswers();
    loading(true, reason==="manual"?"Saving result...":"Submitting quiz...");

    try{
      const {data,error}=await sb.functions.invoke("submit-quiz",{
        body:{
          quiz_id:state.quiz.id,
          session_id:state.quizSessionId,
          answers:state.quizAnswers,
          submission_reason:reason
        }
      });
      if(error)throw error;
      if(data?.error)throw new Error(data.error);
      state.lastAttempt={attempt:data.attempt,answers:data.answers||[]};
      state.quizQuestions=data.questions||state.quizQuestions;
      state.quizSecurity.allowExit=true;
      state.quizSecurity.active=false;
      document.body.classList.remove("quiz-active");
      writeRoute("quiz-result", { quizId: state.quiz.id }, true);
      await renderQuizResult();
      toast(
        reason==="time_expired" ? "Time ended. Your quiz was submitted." :
        reason==="tab_switch" ? "You left the quiz tab. Your quiz was submitted." :
        reason==="browser_back" ? "Browser Back was detected. Your quiz was submitted." :
        reason==="page_exit" ? "You left the quiz. Your quiz was submitted." :
        reason==="window_blur" ? "The quiz window lost focus. Your quiz was submitted." :
        "Quiz submitted successfully.",
        "success"
      );
      return true;
    }catch(e){
      // If the network fails during a visibility/page-exit event, do not
      // silently unlock the quiz. The pagehide beacon is the last fallback.
      state.quizSecurity.submitting=false;
      toast(e.message||"Could not submit quiz.","error");
      return false;
    }finally{loading(false)}
  }

  function sendQuizBeacon(reason){
    try{
      const session=state.session;
      if(!session?.access_token || !state.quizSessionId || !state.quizSecurity?.active)return;
      collectQuizAnswers();
      const url=`${C.SUPABASE_URL}/functions/v1/submit-quiz`;
      const payload=JSON.stringify({
        quiz_id:state.quiz.id,
        session_id:state.quizSessionId,
        answers:state.quizAnswers,
        submission_reason:reason,
        access_token:session.access_token
      });
      navigator.sendBeacon(url,new Blob([payload],{type:"text/plain;charset=UTF-8"}));
    }catch(e){console.warn("Quiz exit beacon failed",e);}
  }
  async function renderQuizResult(){
    document.body.classList.remove("quiz-active");
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
      <div class="form-grid"><div class="form-group"><label>Full name</label><input id="new-name" required></div><div class="form-group"><label>Class</label><select id="new-class"><option value="10">10</option><option value="12">12</option></select></div><div class="form-group"><label>Roll number</label><input id="new-roll"></div><div class="form-group"><label>Batch</label><select id="new-batch"><option value="26">26</option><option value="27">27</option></select></div><div class="form-group"><label>Phone number <span class="mini-label">(optional)</span></label><input id="new-phone" type="tel" inputmode="numeric" placeholder="Optional"></div><div class="form-group"><label>Student photo <span class="mini-label">(optional)</span></label><input id="new-photo" type="file" accept="image/*" capture="environment"></div><div class="form-group"><label>Initial password</label><div class="password-field"><input id="new-password" type="password" minlength="8" autocomplete="new-password" placeholder="Enter initial password"><button type="button" class="password-action" id="toggle-new-password" aria-label="Show password" title="Show password"><i class="fa-regular fa-eye"></i></button><button type="button" class="password-action" id="copy-new-password" aria-label="Copy password" title="Copy password"><i class="fa-regular fa-copy"></i></button></div></div></div>
      <p class="notice" style="margin-top:14px">The system generates the ID as batch + BCC + class + first two letters of the name + random 3 digits. Passwords are handled by Supabase Auth and are not stored in plaintext by this portal.</p>
      <div class="modal-actions"><button class="small-btn" data-close>Cancel</button><button class="small-btn primary" id="save-student">Create</button></div>`);
    $$(`[data-close]`).forEach(x=>x.onclick=closeModal);
    $("#save-student").onclick=createStudent;
    $("#toggle-new-password").onclick=()=>{
      const input=$("#new-password");
      const button=$("#toggle-new-password");
      input.type=input.type==="password"?"text":"password";
      button.innerHTML=`<i class="fa-regular fa-eye${input.type==="password"?"":"-slash"}"></i>`;
      button.setAttribute("aria-label",input.type==="password"?"Show password":"Hide password");
      button.title=input.type==="password"?"Show password":"Hide password";
    };
    $("#copy-new-password").onclick=async()=>{
      const input=$("#new-password");
      const value=input.value;
      if(!value)return toast("Enter a password first.","error");
      try{
        await navigator.clipboard.writeText(value);
        toast("Password copied. You can paste it into WhatsApp or another message.","success");
      }catch(e){
        input.focus();input.select();
        toast("Password selected. Press Cmd/Ctrl+C to copy it.","success");
      }
    };
  }
  async function createStudent(){
    const payload={full_name:$("#new-name").value.trim(),class_no:Number($("#new-class").value),roll_number:$("#new-roll").value.trim(),batch:$("#new-batch").value,password:$("#new-password").value,phone:$("#new-phone").value.trim()||null};
    const photo=$("#new-photo")?.files?.[0]||null;
    if(!payload.full_name||!payload.password||payload.password.length<8)return toast("Name and an 8+ character password are required.","error");
    if(photo && photo.size>5*1024*1024)return toast("Photo must be 5 MB or smaller.","error");
    loading(true,"Creating student...");
    try{
      const {data,error}=await sb.functions.invoke("admin-create-user",{body:{type:"student",...payload}});
      if(error)throw error;if(data?.error)throw new Error(data.error);
      if(photo && data?.user_id){
        const ext=(photo.name.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"")||"jpg";
        const path=`${data.user_id}/profile.${ext}`;
        const upload=await sb.storage.from("student-photos").upload(path,photo,{upsert:true,contentType:photo.type||"image/jpeg"});
        if(upload.error)throw upload.error;
        const update=await sb.from("student_profiles").update({photo_path:path}).eq("user_id",data.user_id);
        if(update.error)throw update.error;
      }
      showStudentCreatedCredentials(data.login_id, payload.password, payload.full_name);
    }catch(e){toast(e.message||"Could not create student.","error")}finally{loading(false)}
  }

  function showStudentCreatedCredentials(loginId, password, fullName){
    const websiteLink = "https://rezanadaf9-star.github.io/bcc-kne/";
    const message = `Website: ${websiteLink}\nUser ID: ${loginId}\nPassword: ${password}`;
    modal(`<div class="modal-head"><h2>Student created successfully</h2><button class="close-btn" data-created-close><i class="fa-solid fa-xmark"></i></button></div>
      <div class="student-created-card">
        <div class="student-created-success"><i class="fa-solid fa-circle-check"></i><div><strong>${esc(fullName)}</strong><span>Login details are ready to send to the student.</span></div></div>
        <div class="student-credential-list">
          <div class="student-credential-row"><span>Website</span><strong>${esc(websiteLink)}</strong></div>
          <div class="student-credential-row"><span>User ID</span><strong>${esc(loginId)}</strong></div>
          <div class="student-credential-row"><span>Password</span><strong>${esc(password)}</strong></div>
        </div>
        <div class="student-created-actions">
          <button class="small-btn" id="copy-student-credentials"><i class="fa-regular fa-copy"></i> Copy login details</button>
          <button class="small-btn primary" id="created-done">Done</button>
        </div>
      </div>`);
    const finish=async()=>{closeModal();toast(`Student created. ID: ${loginId}`,"success");await renderStudents($("#view-container"));};
    $$("[data-created-close]").forEach(x=>x.onclick=finish);
    $("#created-done").onclick=finish;
    $("#copy-student-credentials").onclick=async()=>{
      try{
        await navigator.clipboard.writeText(message);
        toast("Website, User ID and password copied. You can paste them into WhatsApp.","success");
      }catch(e){
        const ta=document.createElement("textarea");
        ta.value=message;ta.style.position="fixed";ta.style.opacity="0";document.body.appendChild(ta);ta.select();
        try{document.execCommand("copy");toast("Login details copied. You can paste them into WhatsApp.","success")}catch(err){toast("Could not copy automatically. Select the details and copy them.","error")}
        ta.remove();
      }
    };
  }
  async function viewStudent(id){
    const {data,error}=await sb.from("student_profiles").select("*,profiles(full_name,login_id)").eq("id",id).single();if(error)return toast(error.message,"error");
    const attempts=await sb.from("quiz_attempts").select("*,quizzes(title)").eq("student_id",data.user_id).order("submitted_at",{ascending:false}).limit(20);
    modal(`<div class="modal-head"><h2>${esc(data.profiles?.full_name)}</h2><button class="close-btn" data-close><i class="fa-solid fa-xmark"></i></button></div>
      <div class="student-admin-profile">${data.photo_path?`<span class="student-admin-avatar" id="student-photo-preview"></span>`:`<span class="student-admin-avatar" id="student-photo-preview">${esc(initials(data.profiles?.full_name))}</span>`}<div><strong>${esc(data.profiles?.full_name)}</strong><span>${esc(data.phone||"No phone number")}</span></div></div><div class="student-photo-upload"><label for="student-photo-file">Profile photo <span class="mini-label">(optional)</span></label><input id="student-photo-file" type="file" accept="image/*" capture="environment"><div class="student-photo-actions"><button class="small-btn primary" id="upload-student-photo"><i class="fa-solid fa-camera"></i> ${data.photo_path?"Replace photo":"Add photo"}</button>${data.photo_path?`<button class="small-btn danger-outline" id="delete-student-photo"><i class="fa-solid fa-trash"></i> Delete photo</button>`:""}</div><span class="mini-label">Photo is saved using this student's Supabase User ID.</span><div id="student-photo-status" class="student-photo-status ${data.photo_path?"saved":""}">${data.photo_path?`Profile photo saved for ${esc(data.profiles?.full_name)}.`:"No profile photo saved yet."}</div></div><div class="stats-grid"><div class="content-card"><span class="mini-label">Student ID</span><h3>${esc(data.profiles?.login_id)}</h3></div><div class="content-card"><span class="mini-label">Class</span><h3>${data.class_no}</h3></div><div class="content-card"><span class="mini-label">Roll / Batch</span><h3>${esc(data.roll_number)} / ${esc(data.batch)}</h3></div></div>
      <h3 class="section-title">Quiz history</h3><div class="table-card"><table class="data-table"><thead><tr><th>Quiz</th><th>Score</th><th>Correct</th><th>Wrong</th><th>Date</th></tr></thead><tbody>${(attempts.data||[]).map(a=>`<tr><td>${esc(a.quizzes?.title)}</td><td>${a.score}/${a.total_marks}</td><td>${a.correct_count}</td><td>${a.wrong_count}</td><td>${fmtDate(a.submitted_at)}</td></tr>`).join("")||`<tr><td colspan="5">No attempts yet.</td></tr>`}</tbody></table></div>`);
    $("[data-close]").onclick=closeModal;
    if(data.photo_path){
      const u=await studentPhotoUrl(data.photo_path);
      const p=$("#student-photo-preview");
      if(p&&u){
        const img=new Image();
        img.alt="Student profile photo";
        img.onload=()=>{p.innerHTML="";p.appendChild(img)};
        img.onerror=()=>{p.innerHTML=esc(initials(data.profiles?.full_name)); const st=$("#student-photo-status"); if(st){st.className="student-photo-status error";st.textContent="Profile photo is saved, but could not be displayed. Check the student-photos Storage policy."}};
        img.src=u;
      }
    }
    $("#upload-student-photo").onclick=()=>uploadStudentPhoto(data.user_id, data.id);
    $("#delete-student-photo")?.addEventListener("click",()=>deleteStudentPhoto(data.user_id, data.id, data.photo_path, data.profiles?.full_name || "Student"));
  }
  async function uploadStudentPhoto(userId, studentProfileId){
    const input=$("#student-photo-file"); const photo=input?.files?.[0];
    if(!photo)return toast("Select a photo first.","error");
    if(photo.size>5*1024*1024)return toast("Photo must be 5 MB or smaller.","error");
    loading(true,"Updating profile photo...");
    try{
      // Always use one stable filename. This prevents old JPG/PNG paths from
      // becoming stale when an admin replaces a student's photo.
      const path=`${userId}/profile.jpg`;
      let file=photo;
      if(photo.type !== "image/jpeg") {
        file=await new Promise((resolve,reject)=>{
          const img=new Image();
          const url=URL.createObjectURL(photo);
          img.onload=()=>{
            try{
              const max=1600, scale=Math.min(1,max/Math.max(img.width,img.height));
              const c=document.createElement("canvas");
              c.width=Math.max(1,Math.round(img.width*scale)); c.height=Math.max(1,Math.round(img.height*scale));
              c.getContext("2d").drawImage(img,0,0,c.width,c.height);
              c.toBlob(b=>{URL.revokeObjectURL(url); b?resolve(new File([b],"profile.jpg",{type:"image/jpeg"})):reject(new Error("Could not process image."));},"image/jpeg",0.9);
            }catch(e){URL.revokeObjectURL(url);reject(e)}
          };
          img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error("Could not read the selected image."))};
          img.src=url;
        });
      }
      const upload=await sb.storage.from("student-photos").upload(path,file,{upsert:true,contentType:"image/jpeg",cacheControl:"0"});
      if(upload.error)throw upload.error;
      // RLS must allow staff to update student_profiles. Request the updated row
      // directly so a blocked/no-row update cannot look like a successful save.
      const update=await sb.from("student_profiles").update({photo_path:path}).eq("user_id",userId).select("photo_path,profiles(full_name)").single();
      if(update.error)throw new Error(update.error.message || "Could not update the student profile record. Run the latest PHOTO_PROFILE_MIGRATION.sql in Supabase.");
      const student=update.data;
      if(student?.photo_path !== path)throw new Error("Photo was uploaded but the profile record was not updated.");
      const name=student.profiles?.full_name || "Student";
      toast(`Profile photo updated for ${name}.`,"success");
      await viewStudent(studentProfileId);
    }catch(e){toast(e.message||"Could not update profile photo.","error")}finally{loading(false)}
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

  function includedAcademicSubjects(exam, record){
    const subjects=exam?.academic_exam_subjects||[];
    const ids=record?.included_subject_ids;
    if(!Array.isArray(ids)||ids.length===0)return subjects;
    const set=new Set(ids.map(String));
    return subjects.filter(s=>set.has(String(s.subject_id)));
  }

  function academicTotals(exam, record){
    const subjects=includedAcademicSubjects(exam,record);
    const marks=record?.marks||{};
    const total=subjects.reduce((n,s)=>n+Number(marks[s.subject_id]??0),0);
    const full=subjects.reduce((n,s)=>n+Number(s.full_marks||0),0);
    return {subjects,total,full,percentage:full?(total/full)*100:null};
  }

  function normalizeStudentRouteForRole(){
    if(!state.profile)return;
    const studentViews=new Set(["dashboard","lectures","lectures-subject","notes","notes-subject","homework","homework-subject","quizzes","leaderboard","student-marks","notebooklm","lecture-player","quiz-run","quiz-result"]);
    const adminViews=new Set(["admin-dashboard","students","content","quiz-manager","marks","marks-class","leaderboard","leaderboard-class"]);
    const allowed=state.profile.role==="student"?studentViews:adminViews;
    if(!allowed.has(state.view)){
      state.view=state.profile.role==="student"?"dashboard":"admin-dashboard";
      state.route={};
    }
  }

  async function renderContent(el){
    const subjects10=await subjectsForClass(10), subjects12=await subjectsForClass(12);
    el.innerHTML=`<div class="page-head"><div><h1>Content</h1><p>Choose a class first. Content is only visible to that class.</p></div></div>
      <div class="two-col"><div class="admin-card"><h3>Upload / add content</h3><p class="mini-label" style="margin:4px 0 15px">PDF/JPG notes and homework use Supabase Storage. Lectures can use an official YouTube URL or an uploaded video.</p>
        <div class="form-grid"><div class="form-group"><label>Class</label><select id="content-class"><option value="10">Class 10</option><option value="12">Class 12</option></select></div><div class="form-group"><label>Content type</label><select id="content-type"><option value="note">Note</option><option value="homework">Homework</option><option value="lecture">Lecture</option></select></div><div class="form-group"><label>Subject</label><select id="content-subject"></select></div><div class="form-group"><label>Title</label><input id="content-title"></div></div>
        <div id="content-extra" style="margin-top:13px"></div><div class="modal-actions"><button class="small-btn primary" id="save-content">Save content</button></div>
      </div>
      <div class="admin-card"><h3>Recent content</h3><div id="recent-content" class="list-stack" style="margin-top:12px"></div></div></div>
      <div class="admin-card notebook-admin-card" style="margin-top:16px"><h3><i class="fa-solid fa-wand-magic-sparkles"></i> AI Study Hub / NotebookLM</h3><p class="mini-label" style="margin:4px 0 15px">Publish a NotebookLM or Gemini resource link for Class 10 or Class 12 Arts students.</p>
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
    try { new URL(payload.url); } catch { return toast("Enter a valid NotebookLM/Gemini URL.","error"); }
    loading(true,"Publishing AI resource...");
    try{const {error}=await sb.from("notebooklm_resources").insert(payload);if(error)throw error;$("#nl-title").value="";$("#nl-url").value="";$("#nl-description").value="";toast("AI resource published.","success");await renderNotebookLMAdmin()}catch(e){toast(e.message||"Could not publish AI resource.","error")}finally{loading(false)}
  }
  async function renderNotebookLMAdmin(){
    const {data,error}=await sb.from("notebooklm_resources").select("id,title,class_no,resource_type,url,is_active,created_at,subjects(name)").order("created_at",{ascending:false}).limit(20);if(error)return;
    $("#notebooklm-admin-list").innerHTML=(data||[]).map(r=>`<div class="list-item"><div class="list-main"><strong>${esc(r.title)}</strong><span>Class ${r.class_no} • ${esc(r.subjects?.name||"General")} • ${esc(r.resource_type)} • ${fmtDate(r.created_at)}</span></div><button class="small-btn danger" data-delete-nl="${r.id}">Remove</button></div>`).join("")||emptyInline("No AI resources published yet.");
    $$('[data-delete-nl]').forEach(b=>b.onclick=async()=>{if(!confirm("Remove this AI resource?"))return;const {error:e}=await sb.from("notebooklm_resources").delete().eq("id",b.dataset.deleteNl);if(e)return toast(e.message,"error");toast("AI resource removed.","success");await renderNotebookLMAdmin()});
  }

  async function renderRecentContent(){
    const [l,n,h]=await Promise.all([sb.from("lectures").select("id,title,created_at,class_no,file_path,subjects(name)").order("created_at",{ascending:false}).limit(5),sb.from("notes").select("id,title,created_at,class_no,file_path,subjects(name)").order("created_at",{ascending:false}).limit(5),sb.from("homework").select("id,title,created_at,class_no,file_path,subjects(name)").order("created_at",{ascending:false}).limit(5)]);
    const rows=[...(l.data||[]).map(x=>({...x,type:"Lecture"})),...(n.data||[]).map(x=>({...x,type:"Note"})),...(h.data||[]).map(x=>({...x,type:"Homework"}))].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,8);
    $("#recent-content").innerHTML=rows.map(x=>`<div class="list-item"><div class="list-main"><strong>${esc(x.title)}</strong><span>${x.type} • Class ${x.class_no} • ${esc(x.subjects?.name||"")}</span></div><button class="small-btn danger" data-delete-content="${esc(x.id)}" data-content-type="${x.type.toLowerCase()}" data-content-path="${esc(x.file_path||"")}"><i class="fa-solid fa-trash"></i> Delete</button></div>`).join("")||emptyInline("No content yet.");
    $$('[data-delete-content]').forEach(b=>b.onclick=()=>deleteContentItem(b.dataset.deleteContent,b.dataset.contentType,b.dataset.contentPath));
  }

  async function deleteContentItem(id,type,path){
    if(!confirm("Delete this content permanently?")) return;
    const table=type==="lecture"?"lectures":type==="note"?"notes":"homework";
    loading(true,"Deleting content...");
    try {
      const {error}=await sb.from(table).delete().eq("id",id);
      if(error) throw error;
      if(path){ const {error:e}=await sb.storage.from("bcc-content").remove([path]); if(e) console.warn("Storage cleanup failed:",e.message); }
      toast("Content deleted.","success");
      await renderRecentContent();
    } catch(e){ toast(e.message||"Could not delete content.","error"); }
    finally{ loading(false); }
  }

  async function uploadFile(file,path){const {error}=await sb.storage.from("bcc-content").upload(path,file,{upsert:false,contentType:file.type});if(error)throw error;return path}
  async function signedUrl(path,seconds=3600){if(!path)return null;const {data,error}=await sb.storage.from("bcc-content").createSignedUrl(path,seconds);if(error){console.error(error);return null}return data?.signedUrl||null}
  async function downloadFile(path,name){
    const url=await signedUrl(path,300);
    if(!url)return toast("Could not create download link. Check BCC storage access.","error");
    try{
      const res=await fetch(url);
      if(!res.ok)throw new Error(`Download failed (${res.status})`);
      const blob=await res.blob();
      const objectUrl=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=objectUrl;
      a.download=name||path.split("/").pop()||"bcc-file";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);
    }catch(e){
      console.error(e);
      toast(e.message||"Could not download file.","error");
    }
  }

  async function renderQuizManager(el){
    const [qzs,subs10,subs12]=await Promise.all([sb.from("quizzes").select("*,subjects(name)").order("created_at",{ascending:false}),subjectsForClass(10),subjectsForClass(12)]);
    if(qzs.error)throw qzs.error;
    el.innerHTML=`<div class="page-head"><div><h1>Quiz Manager</h1><p>Create weekly, monthly and chapter-wise quizzes with configurable scoring.</p></div><button class="small-btn primary" id="new-quiz"><i class="fa-solid fa-plus"></i> New quiz</button></div>
      <div class="list-stack">${(qzs.data||[]).map(x=>`<div class="quiz-card"><div class="inline" style="justify-content:space-between"><div><h3>${esc(x.title)}</h3><div class="quiz-meta"><span class="pill">${esc(x.quiz_type)}</span><span class="pill">${esc(x.subjects?.name||"All")}</span><span class="pill">${x.total_marks} marks</span><span class="pill">${x.duration_minutes} min</span>${x.is_active?`<span class="pill active">Active</span>`:`<span class="pill">Inactive</span>`}</div></div><div class="inline"><button class="small-btn" data-edit-quiz="${x.id}">Edit</button><button class="small-btn danger" data-delete-quiz="${x.id}"><i class="fa-solid fa-trash"></i> Delete</button></div></div></div>`).join("")||emptyInline("No quizzes yet.")}</div>`;
    $("#new-quiz").onclick=()=>showQuizEditor(null,[...subs10,...subs12]);$$("[data-edit-quiz]").forEach(b=>b.onclick=()=>showQuizEditor(b.dataset.editQuiz,[...subs10,...subs12]));$$('[data-delete-quiz]').forEach(b=>b.onclick=()=>deleteQuiz(b.dataset.deleteQuiz));
  }
  async function deleteStudentPhoto(userId, studentProfileId, photoPath, name){
    if(!confirm(`Delete profile photo for ${name}?`)) return;
    loading(true,"Deleting profile photo...");
    try {
      const path = photoPath || `${userId}/profile.jpg`;
      const del = await sb.storage.from("student-photos").remove([path]);
      if (del.error) throw del.error;
      const update = await sb.from("student_profiles").update({photo_path:null}).eq("user_id",userId).select("photo_path").single();
      if (update.error) throw update.error;
      toast(`Profile photo deleted for ${name}.`,"success");
      await viewStudent(studentProfileId);
    } catch(e) {
      toast(e.message || "Could not delete profile photo.","error");
    } finally { loading(false); }
  }

  async function uploadStaffPhoto(){
    const input=$("#staff-photo-file");
    const photo=input?.files?.[0];
    if(!photo) return;
    if(photo.size>5*1024*1024) return toast("Photo must be 5 MB or smaller.","error");
    loading(true,"Updating profile photo...");
    try {
      const path=`staff/${state.session.user.id}/profile.jpg`;
      let file=photo;
      if(photo.type !== "image/jpeg") {
        file=await new Promise((resolve,reject)=>{
          const img=new Image(), url=URL.createObjectURL(photo);
          img.onload=()=>{
            try {
              const max=1600, scale=Math.min(1,max/Math.max(img.width,img.height));
              const c=document.createElement("canvas"); c.width=Math.max(1,Math.round(img.width*scale)); c.height=Math.max(1,Math.round(img.height*scale));
              c.getContext("2d").drawImage(img,0,0,c.width,c.height);
              c.toBlob(b=>{URL.revokeObjectURL(url); b?resolve(new File([b],"profile.jpg",{type:"image/jpeg"})):reject(new Error("Could not process image."));},"image/jpeg",0.9);
            } catch(e){URL.revokeObjectURL(url);reject(e)}
          };
          img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error("Could not read the selected image."))}; img.src=url;
        });
      }
      const upload=await sb.storage.from("student-photos").upload(path,file,{upsert:true,contentType:"image/jpeg",cacheControl:"0"});
      if(upload.error) throw upload.error;
      const update=await sb.rpc("set_my_profile_photo",{p_path:path});
      if(update.error) throw update.error;
      state.profile={...(await currentProfile())};
      saveIdentityCache();
      await loadProfileAvatar(path,state.profile.full_name || "Administrator");
      $("#staff-photo-action")?.querySelector("span") && ($("#staff-photo-action").querySelector("span").textContent="Replace profile photo");
      toast(`Profile photo updated for ${state.profile.full_name || "Administrator"}.`,"success");
      input.value="";
    } catch(e) { toast(e.message || "Could not update profile photo.","error"); } finally { loading(false); }
  }

  async function deleteQuiz(id){
    if(!confirm("Delete this quiz permanently? Its questions and submitted attempts will also be deleted.")) return;
    loading(true,"Deleting quiz...");
    try{const {error}=await sb.from("quizzes").delete().eq("id",id);if(error)throw error;toast("Quiz deleted.","success");await renderQuizManager($("#view-container"));}catch(e){toast(e.message||"Could not delete quiz.","error")}finally{loading(false)}
  }
  async function showQuizEditor(id,subjects){
    let quiz=null,questions=[];
    if(id){const {data,error}=await sb.from("quizzes").select("*,quiz_questions(*)").eq("id",id).single();if(error)return toast(error.message,"error");quiz=data;questions=(data.quiz_questions||[]).sort((a,b)=>a.position-b.position)}
    modal(`<div class="modal-head"><h2>${quiz?"Edit quiz":"Create quiz"}</h2><button class="close-btn" data-close><i class="fa-solid fa-xmark"></i></button></div>
      <div class="form-grid"><div class="form-group"><label>Title</label><input id="q-title" value="${esc(quiz?.title||"")}"></div><div class="form-group"><label>Class</label><select id="q-class"><option value="10" ${quiz?.class_no===10?"selected":""}>10</option><option value="12" ${quiz?.class_no===12?"selected":""}>12</option></select></div><div class="form-group"><label>Type</label><select id="q-type">${["Weekly","Monthly","Chapter-wise"].map(x=>`<option ${quiz?.quiz_type===x?"selected":""}>${x}</option>`).join("")}</select></div><div class="form-group"><label>Subject</label><select id="q-subject">${subjects.map(s=>`<option value="${s.id}" ${quiz?.subject_id===s.id?"selected":""}>Class ${s.class_no} • ${esc(s.name)}</option>`).join("")}</select></div><div class="form-group"><label>Duration (minutes)</label><input id="q-duration" type="number" value="${quiz?.duration_minutes||30}"></div><div class="form-group"><label>Total marks</label><input id="q-total" type="number" value="${quiz ? (quiz.total_marks ?? 0) : 0}" readonly><span class="mini-label">Automatically equals the number of questions.</span></div><div class="form-group"><label>Start</label><input id="q-start" type="datetime-local" value="${localInput(quiz?.start_at)}"></div><div class="form-group"><label>End</label><input id="q-end" type="datetime-local" value="${localInput(quiz?.end_at)}"></div><div class="form-group"><label>Active</label><select id="q-active"><option value="true" ${quiz?.is_active!==false?"selected":""}>Yes</option><option value="false" ${quiz?.is_active===false?"selected":""}>No</option></select></div></div>
      <h3 class="section-title">Questions</h3><div id="question-editor">${questions.map(questionEditor).join("")}</div><button class="small-btn" id="add-question"><i class="fa-solid fa-plus"></i> Add question</button>
      <div class="modal-actions"><button class="small-btn" data-close>Cancel</button><button class="small-btn primary" id="save-quiz">${quiz?"Save changes":"Create quiz"}</button></div>`);
    $$("[data-close]").forEach(x=>x.onclick=closeModal);let idx=questions.length;$("#add-question").onclick=()=>{idx++;$("#question-editor").insertAdjacentHTML("beforeend",questionEditor({position:idx,id:"",question_text:"",option_a:"",option_b:"",option_c:"",option_d:"",correct_option:"A",correct_marks:1,wrong_marks:0,explanation:""}))};$("#save-quiz").onclick=()=>saveQuiz(quiz?.id||null);
  }
  function questionEditor(q){return `<div class="admin-card q-editor" data-q-editor style="margin-bottom:10px"><div class="form-group"><label>Question</label><textarea data-field="question_text">${esc(q.question_text||"")}</textarea></div><div class="form-grid" style="margin-top:10px">${["a","b","c","d"].map(k=>`<div class="form-group"><label>Option ${k.toUpperCase()}</label><input data-field="option_${k}" value="${esc(q[`option_${k}`]||"")}"></div>`).join("")}<div class="form-group"><label>Correct option</label><select data-field="correct_option">${["A","B","C","D"].map(x=>`<option ${q.correct_option===x?"selected":""}>${x}</option>`).join("")}</select></div><div class="form-group"><label>Correct marks</label><input type="number" value="1" readonly><span class="mini-label">Fixed default</span></div><div class="form-group"><label>Wrong marks</label><input type="number" value="0" readonly><span class="mini-label">Fixed default</span></div></div><div class="form-group" style="margin-top:10px"><label>Explanation</label><textarea data-field="explanation">${esc(q.explanation||"")}</textarea></div></div>`}
  function localInput(v){if(!v)return "";const d=new Date(v);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}
  async function saveQuiz(id){
    const editors=$$("[data-q-editor]"),qs=editors.map((box,i)=>{const o={position:i+1};$$( "[data-field]",box).forEach(x=>o[x.dataset.field]=x.value);o.correct_marks=1;o.wrong_marks=0;return o}).filter(q=>q.question_text.trim());
    const payload={title:$("#q-title").value.trim(),class_no:Number($("#q-class").value),quiz_type:$("#q-type").value,subject_id:$("#q-subject").value,duration_minutes:Number($("#q-duration").value),total_marks:qs.length,start_at:$("#q-start").value?new Date($("#q-start").value).toISOString():null,end_at:$("#q-end").value?new Date($("#q-end").value).toISOString():null,is_active:$("#q-active").value==="true",created_by:state.profile.id};
    if(!payload.title||!qs.length)return toast("Quiz title and at least one question are required.","error");
    loading(true,"Saving quiz...");
    try{let quizId=id;if(id){const {error}=await sb.from("quizzes").update(payload).eq("id",id);if(error)throw error;const {error:e}=await sb.from("quiz_questions").delete().eq("quiz_id",id);if(e)throw e}else{const {data,error}=await sb.from("quizzes").insert(payload).select().single();if(error)throw error;quizId=data.id}
      const {error:e2}=await sb.from("quiz_questions").insert(qs.map(q=>({...q,quiz_id:quizId})));if(e2)throw e2;closeModal();toast("Quiz saved.","success");await renderQuizManager($("#view-container"))
    }catch(e){toast(e.message,"error")}finally{loading(false)}
  }

  async function renderMarks(el){
    const [exams, staffStudents] = await Promise.all([
      sb.from("academic_exam_sets").select("id,class_no,exam_name,created_at").order("created_at",{ascending:false}),
      sb.from("student_profiles").select("user_id,class_no,roll_number,profiles(full_name,login_id)").order("class_no").order("roll_number")
    ]);
    if(exams.error)throw exams.error;
    if(staffStudents.error)throw staffStudents.error;
    const rows=staffStudents.data||[];
    const counts=new Map([10,12].map(c=>[c,0]));
    rows.forEach(s=>counts.set(Number(s.class_no),(counts.get(Number(s.class_no))||0)+1));
    const grouped={10:(exams.data||[]).filter(x=>x.class_no===10),12:(exams.data||[]).filter(x=>x.class_no===12)};
    el.innerHTML=`
      <div class="page-head"><div><h1>Marks</h1><p>School exam marks are entered here. Quiz marks and quiz performance are available in Leaderboard.</p></div></div>
      <div class="marks-class-grid">
        ${[10,12].map(c=>`<article class="marks-class-card" data-marks-class="${c}"><span class="marks-class-icon"><i class="fa-solid fa-graduation-cap"></i></span><div><h2>Class ${c}</h2><p>${counts.get(c)||0} students • ${grouped[c].length} saved exam${grouped[c].length===1?"":"s"}</p></div><i class="fa-solid fa-arrow-right"></i></article>`).join("")}
      </div>
      <section class="marks-exam-history"><div class="leaderboard-panel-head"><div><span class="pill">EXAM RECORDS</span><h2>Saved exams</h2><p>Open a class to create a new exam or continue an unfinished entry.</p></div></div>
        <div class="marks-exam-grid">${[10,12].map(c=>`<div class="marks-exam-column"><h3>Class ${c}</h3>${grouped[c].map(e=>`<button class="marks-exam-item" data-open-exam="${esc(e.id)}"><span><strong>${esc(e.exam_name)}</strong><small>${fmtDate(e.created_at)}</small></span><i class="fa-solid fa-chevron-right"></i></button>`).join("")||`<div class="marks-empty">No exam records yet.</div>`}</div>`).join("")}</div>
      </section>`;
    $$("[data-marks-class]",el).forEach(c=>c.onclick=()=>navigate("marks-class",{classNo:Number(c.dataset.marksClass)}));
    $$("[data-open-exam]",el).forEach(b=>b.onclick=()=>{const x=(exams.data||[]).find(e=>e.id===b.dataset.openExam);navigate("marks-class",{classNo:x?.class_no||10,examId:b.dataset.openExam})});
  }

  async function renderMarksClass(el,classNo){
    if(![10,12].includes(classNo))return navigate("marks",{},true);
    const [{data:students,error:studentError},{data:exams,error:examError}]=await Promise.all([
      sb.from("student_profiles").select("user_id,class_no,roll_number,profiles(full_name,login_id)").eq("class_no",classNo),
      sb.from("academic_exam_sets").select("id,class_no,exam_name,created_at,academic_exam_subjects(subject_id,subject_name,full_marks)").eq("class_no",classNo).order("created_at",{ascending:false})
    ]);
    if(studentError)throw studentError;if(examError)throw examError;
    const list=(students||[]).sort((a,b)=>String(a.roll_number||"").localeCompare(String(b.roll_number||""),undefined,{numeric:true,sensitivity:"base"}));
    const examList=exams||[];
    el.innerHTML=`
      <div class="back-row"><button class="small-btn" id="marks-back"><i class="fa-solid fa-arrow-left"></i> Back to Marks</button></div>
      <div class="page-head"><div><h1>Class ${classNo} Marks</h1><p>Students are arranged by roll number. Create an exam once, then enter each student's subject marks.</p></div><button class="small-btn primary" id="new-academic-exam"><i class="fa-solid fa-plus"></i> New Exam</button></div>
      <section class="admin-card marks-student-section"><div class="marks-entry-head"><div><span class="pill">STUDENTS</span><h2>Student list</h2><p>${list.length} students in Class ${classNo}.</p></div></div>
        <div class="marks-student-grid">${list.map((s,i)=>`<button class="marks-student-card" data-academic-student="${esc(s.user_id)}"><span class="marks-student-number">${i+1}</span><span class="marks-student-avatar">${esc(initials(s.profiles?.full_name))}</span><span class="marks-student-info"><strong>${esc(s.profiles?.full_name||"Student")}</strong><small>Roll No. ${esc(s.roll_number||"—")} • ${classText(classNo)}</small></span><i class="fa-solid fa-chevron-right"></i></button>`).join("")||`<div class="marks-empty">No students found in this class.</div>`}</div>
      </section>
      <section class="marks-exam-history"><div class="marks-entry-head"><div><span class="pill active">EXAMS</span><h2>Exam setups</h2><p>Continue any unfinished exam or review completed entries.</p></div></div>
        <div class="marks-exam-grid single">${examList.map(e=>`<button class="marks-exam-item wide" data-resume-exam="${esc(e.id)}"><span><strong>${esc(e.exam_name)}</strong><small>${(e.academic_exam_subjects||[]).length} subjects configured • ${fmtDate(e.created_at)}</small></span><i class="fa-solid fa-arrow-right"></i></button>`).join("")||`<div class="marks-empty">No exam has been created for Class ${classNo} yet.</div>`}</div>
      </section>`;
    $("#marks-back").onclick=()=>navigate("marks");
    $("#new-academic-exam").onclick=()=>openAcademicExamSetup(classNo);
    $$(`[data-academic-student]`,el).forEach(b=>b.onclick=()=>showAdminStudentAcademicOverview(classNo,b.dataset.academicStudent));
    $$("[data-resume-exam]",el).forEach(b=>b.onclick=()=>startAcademicMarksEntry(classNo,b.dataset.resumeExam));
    if(state.route.examId)startAcademicMarksEntry(classNo,state.route.examId);
  }

  async function openAcademicExamSetup(classNo){
    const subjects=await subjectsForClass(classNo);
    if(!subjects.length)return toast(`No subjects are configured for Class ${classNo}.`,"error");
    modal(`<div class="modal-head"><h2>Set up Class ${classNo} exam</h2><button class="close-btn" data-close-modal><i class="fa-solid fa-xmark"></i></button></div>
      <p class="mini-label" style="margin-bottom:14px">Enter the exam name and full marks once. <strong>Only subjects where you enter full marks will be included in this exam.</strong> Leave a subject blank if the coaching does not teach it for this exam.</p>
      <div class="form-grid"><div class="form-group" style="grid-column:1/-1"><label>Exam name</label><input id="academic-exam-name" placeholder="e.g. First Terminal Examination"></div></div>
      <div class="marks-full-grid">${subjects.map(s=>`<div class="form-group"><label>${esc(s.name)} — Full marks</label><input class="academic-full-mark" data-subject-id="${esc(s.id)}" data-subject-name="${esc(s.name)}" type="number" min="1" step="0.01" placeholder="Leave blank if not taught"></div>`).join("")}</div>
      <div class="modal-actions"><button class="small-btn" data-close-modal>Cancel</button><button class="small-btn primary" id="create-academic-exam"><i class="fa-solid fa-check"></i> Create & Start</button></div>`);
    $$("[data-close-modal]").forEach(b=>b.onclick=()=>$("#modal-root").innerHTML="");
    $("#create-academic-exam").onclick=async()=>{
      const examName=$("#academic-exam-name").value.trim(), inputs=$$(".academic-full-mark");
      if(!examName)return toast("Enter the exam name.","error");
      const subjectRows=inputs.filter(i=>i.value.trim()!=="").map(i=>({subject_id:i.dataset.subjectId,subject_name:i.dataset.subjectName,full_marks:Number(i.value)}));
      if(!subjectRows.length)return toast("Enter full marks for at least one subject.","error");
      if(subjectRows.some(x=>!Number.isFinite(x.full_marks)||x.full_marks<=0))return toast("Full marks must be greater than 0.","error");
      loading(true,"Creating exam...");
      try{
        const {data:exam,error}=await sb.from("academic_exam_sets").insert({class_no:classNo,exam_name:examName,created_by:state.profile.id}).select().single();
        if(error)throw error;
        const {error:subError}=await sb.from("academic_exam_subjects").insert(subjectRows.map(x=>({...x,exam_id:exam.id})));
        if(subError)throw subError;
        $("#modal-root").innerHTML="";toast("Exam created. Start entering marks.","success");await startAcademicMarksEntry(classNo,exam.id);
      }catch(e){toast(e.message||"Could not create exam.","error")}finally{loading(false)}
    };
  }

  async function chooseStudentForMarks(classNo,studentId){
    const {data:exams,error}=await sb.from("academic_exam_sets").select("id,exam_name,created_at").eq("class_no",classNo).order("created_at",{ascending:false});
    if(error)throw error;
    if(!(exams||[]).length)return openAcademicExamSetup(classNo);
    modal(`<div class="modal-head"><h2>Select exam</h2><button class="close-btn" data-close-modal><i class="fa-solid fa-xmark"></i></button></div><p class="mini-label">Choose the exam for this student.</p>
      <div class="marks-exam-select-list">${exams.map(e=>`<button class="marks-exam-item" data-select-exam="${esc(e.id)}"><span><strong>${esc(e.exam_name)}</strong><small>${fmtDate(e.created_at)}</small></span><i class="fa-solid fa-chevron-right"></i></button>`).join("")}</div>`);
    $$("[data-close-modal]").forEach(b=>b.onclick=()=>$("#modal-root").innerHTML="");
    $$("[data-select-exam]").forEach(b=>b.onclick=()=>{$("#modal-root").innerHTML="";startAcademicMarksEntry(classNo,b.dataset.selectExam,studentId)});
  }

  async function startAcademicMarksEntry(classNo,examId,startStudentId=null){
    const [{data:exam,error:examError},{data:students,error:studentError},{data:records,error:recordError}]=await Promise.all([
      sb.from("academic_exam_sets").select("id,class_no,exam_name,created_at,academic_exam_subjects(subject_id,subject_name,full_marks)").eq("id",examId).single(),
      sb.from("student_profiles").select("user_id,class_no,roll_number,profiles(full_name,login_id)").eq("class_no",classNo),
      sb.from("student_exam_marks").select("student_id,status,included_subject_ids").eq("exam_id",examId)
    ]);
    if(examError)throw examError;if(studentError)throw studentError;if(recordError)throw recordError;
    const list=(students||[]).sort((a,b)=>String(a.roll_number||"").localeCompare(String(b.roll_number||""),undefined,{numeric:true,sensitivity:"base"}));
    const subjects=exam.academic_exam_subjects||[],recordMap=new Map((records||[]).map(r=>[r.student_id,r]));
    if(!list.length)return toast("No students found.","error");
    let idx;if(startStudentId){idx=list.findIndex(s=>s.user_id===startStudentId);if(idx<0)idx=0}else{idx=list.findIndex(s=>recordMap.get(s.user_id)?.status!=="completed");if(idx<0)idx=0}
    await showAcademicStudentCard({classNo,exam,list,subjects,index:idx});
  }

  async function saveAcademicStudentMarks(examId,studentId,inputs,status,includedSubjectIds=null){
    const marks={};
    for(const i of inputs){const raw=i.value.trim();if(raw==="")throw new Error("Enter marks for every selected subject before saving.");const v=Number(raw),max=Number(i.max);if(!Number.isFinite(v)||v<0||v>max)throw new Error(`Marks must be between 0 and ${max}.`);marks[i.dataset.subjectId]=v}
    const payload={exam_id:examId,student_id:studentId,marks,status,updated_at:new Date().toISOString()};
    if(Array.isArray(includedSubjectIds))payload.included_subject_ids=includedSubjectIds;
    const {error}=await sb.from("student_exam_marks").upsert(payload,{onConflict:"exam_id,student_id"});if(error)throw error;
  }

  async function updateStudentFM(exam,studentId,subjects,currentIds){
    const defaultIds=subjects.map(s=>String(s.subject_id));
    const selected=new Set(Array.isArray(currentIds)&&currentIds.length?currentIds.map(String):defaultIds);
    modal(`<div class="modal-head"><div><span class="pill active">FM UPDATE</span><h2>Subjects for this student</h2><p class="modal-subtitle">Uncheck a subject only if this student is not taking it. Full marks for the exam remain unchanged for other students.</p></div><button class="close-btn" data-close-modal><i class="fa-solid fa-xmark"></i></button></div>
      <div class="fm-update-list">${subjects.map(s=>`<label class="fm-update-row"><span><strong>${esc(s.subject_name)}</strong><small>Full marks: ${esc(s.full_marks)}</small></span><input type="checkbox" class="fm-subject-toggle" data-subject-id="${esc(s.subject_id)}" ${selected.has(String(s.subject_id))?"checked":""}></label>`).join("")}</div>
      <div class="notice fm-update-note">Only the checked subjects will appear in this student's marks card and calculation. The next student will automatically start with all exam subjects.</div>
      <div class="modal-actions"><button class="small-btn" data-close-modal>Cancel</button><button class="small-btn fm-update-action" id="save-fm-update"><i class="fa-solid fa-sliders"></i> Update FM</button></div>`);
    $$('[data-close-modal]').forEach(b=>b.onclick=closeModal);
    $('#save-fm-update').onclick=async()=>{
      const ids=$$('.fm-subject-toggle').filter(x=>x.checked).map(x=>x.dataset.subjectId);
      if(!ids.length)return toast('Keep at least one subject for this student.','error');
      const existing=await sb.from('student_exam_marks').select('marks,status').eq('exam_id',exam.id).eq('student_id',studentId).maybeSingle();
      if(existing.error)throw existing.error;
      const marks=existing.data?.marks||{};Object.keys(marks).forEach(k=>{if(!ids.includes(String(k)))delete marks[k]});
      const status=existing.data?.status||'draft';
      const {error}=await sb.from('student_exam_marks').upsert({exam_id:exam.id,student_id:studentId,marks,status,included_subject_ids:ids,updated_at:new Date().toISOString()},{onConflict:'exam_id,student_id'});
      if(error)throw error;closeModal();toast('FM updated for this student.','success');await startAcademicMarksEntry(exam.class_no,exam.id,studentId);
    };
  }

  async function showAcademicStudentCard({classNo,exam,list,subjects,index}){
    const student=list[index];
    const {data:existing,error}=await sb.from('student_exam_marks').select('marks,status,updated_at,included_subject_ids').eq('exam_id',exam.id).eq('student_id',student.user_id).maybeSingle();
    if(error)throw error;
    const allSubjectIds=subjects.map(s=>String(s.subject_id));
    const includedIds=Array.isArray(existing?.included_subject_ids)&&existing.included_subject_ids.length?existing.included_subject_ids.map(String):allSubjectIds;
    const activeSubjects=subjects.filter(s=>includedIds.includes(String(s.subject_id)));
    const saved=existing?.marks||{},completed=existing?.status==='completed',next=index+1<list.length?index+1:null,prev=index>0?index-1:null;
    modal(`<div class="modal-head"><div><span class="pill active">${esc(exam.exam_name)}</span><h2>${esc(student.profiles?.full_name||'Student')}</h2><p class="modal-subtitle">Roll No. ${esc(student.roll_number||'—')} • Class ${classNo} • Student ${index+1} of ${list.length}</p></div><button class="close-btn" data-close-modal><i class="fa-solid fa-xmark"></i></button></div>
      <div class="marks-student-meta"><span><strong>${esc(student.profiles?.full_name||'Student')}</strong></span><span>Roll No. ${esc(student.roll_number||'—')}</span><span>${classText(classNo)}</span><span>${activeSubjects.length} subject${activeSubjects.length===1?'':'s'}</span>${completed?'<span class="status-chip success">Completed</span>':'<span class="status-chip">Pending / Draft</span>'}</div>
      <div class="marks-input-grid">${activeSubjects.map(s=>`<div class="form-group"><label>${esc(s.subject_name)}</label><div class="marks-input-with-full"><input class="academic-mark-input" data-subject-id="${esc(s.subject_id)}" type="number" min="0" max="${esc(s.full_marks)}" step="0.01" value="${saved[s.subject_id]!=null?esc(saved[s.subject_id]):''}" placeholder="0"><span>/ ${esc(s.full_marks)}</span></div></div>`).join('')}</div>
      <div class="marks-total-preview"><span>Total: <strong id="academic-total-preview">0</strong> / ${activeSubjects.reduce((n,s)=>n+Number(s.full_marks||0),0)}</span><span id="academic-percent-preview">0.00%</span></div>
      <div class="modal-actions marks-entry-actions"><button class="small-btn" id="marks-prev" ${prev===null?'disabled':''}><i class="fa-solid fa-arrow-left"></i> Previous</button><button class="small-btn fm-update-action" id="marks-fm-update"><i class="fa-solid fa-sliders"></i> FM Update</button><span class="marks-entry-spacer"></span><button class="small-btn save-action" id="marks-save"><i class="fa-solid fa-floppy-disk"></i> Save</button><button class="small-btn done-action" id="marks-done"><i class="fa-solid fa-check"></i> Done</button></div>`);
    $$('[data-close-modal]').forEach(b=>b.onclick=closeModal);
    const inputs=$$('.academic-mark-input');
    const updatePreview=()=>{let total=0;inputs.forEach(i=>{const v=Number(i.value);if(Number.isFinite(v)&&v>=0)total+=v});const full=activeSubjects.reduce((n,s)=>n+Number(s.full_marks||0),0);$('#academic-total-preview').textContent=total.toFixed(2).replace(/\.00$/,'');$('#academic-percent-preview').textContent=full?`${((total/full)*100).toFixed(2)}%`:'0.00%'};
    inputs.forEach(i=>i.addEventListener('input',updatePreview));updatePreview();
    $('#marks-prev').onclick=()=>{if(prev!==null)showAcademicStudentCard({classNo,exam,list,subjects,index:prev})};
    $('#marks-fm-update').onclick=()=>updateStudentFM(exam,student.user_id,subjects,includedIds);
    $('#marks-save').onclick=async()=>{try{await saveAcademicStudentMarks(exam.id,student.user_id,inputs,'draft',includedIds);closeModal();toast(`Progress saved for ${student.profiles?.full_name||'this student'}. You can continue from the first unfinished student later.`,'success')}catch(e){toast(e.message||'Could not save progress.','error')}};
    $('#marks-done').onclick=async()=>{try{await saveAcademicStudentMarks(exam.id,student.user_id,inputs,'completed',includedIds);if(next!==null){toast(`${student.profiles?.full_name||'Student'} completed. Next student loaded.`,'success');await showAcademicStudentCard({classNo,exam,list,subjects,index:next})}else{closeModal();toast(`All ${list.length} students have been processed for ${exam.exam_name}.`,'success');await renderView()}}catch(e){toast(e.message||'Could not save marks.','error')}};
  }

  async function renderStudentMarks(el){
    const {data:exams,error:examError}=await sb.from("academic_exam_sets").select("id,class_no,exam_name,created_at,academic_exam_subjects(subject_id,subject_name,full_marks)").eq("class_no",state.classNo).order("created_at",{ascending:false});
    if(examError)throw examError;const examList=exams||[];
    if(!examList.length){
      el.innerHTML=`<div class="page-head"><div><h1>Marks</h1><p>${classText(state.classNo)} academic marks and examination performance.</p></div></div><section class="marks-student-leaderboard"><div class="marks-student-rank-head"><div><span class="pill active">EXAM LEADERBOARD</span><h2>Your class position</h2><p>The leaderboard will appear automatically after the first school exam is completed.</p></div></div><div class="marks-empty student-marks-empty-card"><i class="fa-solid fa-ranking-star"></i><strong>No academic exam has been added yet.</strong><span>Your rank and the top students will appear here after your teacher publishes marks.</span></div></section><section class="marks-exam-cards"><div class="marks-student-rank-head"><div><span class="pill">EXAMS</span><h2>Your exam records</h2><p>Exam cards will appear here when your teacher creates them.</p></div></div><div class="student-exam-grid empty-exam-placeholders">${[1,2,3].map(i=>`<div class="student-exam-card empty-exam-card"><span class="exam-card-icon"><i class="fa-solid fa-file-lines"></i></span><span><strong>Exam ${i}</strong><small>Not added yet</small></span></div>`).join('')}</div></section>`;return;
    }
    const latest=examList[0];
    const {data:records,error:recordError}=await sb.from('student_exam_marks').select('student_id,marks,status,included_subject_ids').eq('exam_id',latest.id).eq('status','completed');
    if(recordError)throw recordError;
    const ranked=(records||[]).map(r=>{const t=academicTotals(latest,r);return {...r,total_score:t.total,total_full_marks:t.full,percentage:t.percentage||0}}).sort((a,b)=>b.percentage-a.percentage||b.total_score-a.total_score);
    const meIndex=ranked.findIndex(r=>r.student_id===state.profile.id),me=meIndex>=0?{...ranked[meIndex],rank:meIndex+1}:null,top3=ranked.slice(0,3);
    const ids=ranked.map(r=>r.student_id),nameMap=new Map();if(ids.length){const {data:profiles}=await sb.from('profiles').select('id,full_name').in('id',ids);(profiles||[]).forEach(p=>nameMap.set(p.id,p.full_name));}
    el.innerHTML=`<div class="page-head"><div><h1>Marks</h1><p>${classText(state.classNo)} academic marks and examination performance.</p></div></div><section class="marks-student-leaderboard"><div class="marks-student-rank-head"><div><span class="pill active">LATEST EXAM LEADERBOARD</span><h2>${esc(latest.exam_name)}</h2><p>Rank is calculated from the subjects included for each student.</p></div></div><div class="marks-podium-grid">${top3.map((r,i)=>`<div class="marks-podium-card ${r.student_id===state.profile.id?'is-me':''}"><span class="podium-place">${i+1}</span><span class="marks-student-avatar">${esc(initials(nameMap.get(r.student_id)||'Student'))}</span><strong>${esc(nameMap.get(r.student_id)||'Student')}</strong><small>${Number(r.percentage).toFixed(2)}% • ${esc(r.total_score)} / ${esc(r.total_full_marks)}</small></div>`).join('')}${me&&!top3.some(r=>r.student_id===me.student_id)?`<div class="marks-your-rank"><span>Your rank</span><strong>${rankLabel(me.rank)}</strong><small>${Number(me.percentage).toFixed(2)}%</small></div>`:''}${!top3.length?`<div class="marks-your-rank" style="grid-column:1/-1"><span>No completed marks yet</span><strong>—</strong><small>Your position will appear after marks are completed.</small></div>`:''}</div>${me?`<div class="marks-current-rank"><span><i class="fa-solid fa-ranking-star"></i> Your current rank in ${esc(latest.exam_name)}</span><strong>${rankLabel(me.rank)}</strong><small>${Number(me.percentage).toFixed(2)}% overall</small></div>`:`<div class="marks-empty">Your marks have not been completed for the latest exam yet.</div>`}</section><section class="marks-exam-cards"><div class="marks-student-rank-head"><div><span class="pill">EXAMS</span><h2>Your exam records</h2><p>Tap any exam to see subject-wise marks, percentage and full marks.</p></div></div><div class="student-exam-grid">${examList.map(e=>`<button class="student-exam-card" data-student-exam="${esc(e.id)}"><span class="exam-card-icon"><i class="fa-solid fa-file-lines"></i></span><span><strong>${esc(e.exam_name)}</strong><small>${(e.academic_exam_subjects||[]).length} subjects • ${fmtDate(e.created_at)}</small></span><i class="fa-solid fa-chevron-right"></i></button>`).join('')}</div></section>`;
    $$('[data-student-exam]',el).forEach(b=>b.onclick=()=>openStudentExamDetail(b.dataset.studentExam));
  }

  async function openStudentExamDetail(examId){
    const [{data:exam,error:examError},{data:record,error:recordError}]=await Promise.all([sb.from('academic_exam_sets').select('id,class_no,exam_name,created_at,academic_exam_subjects(subject_id,subject_name,full_marks)').eq('id',examId).single(),sb.from('student_exam_marks').select('marks,status,updated_at,included_subject_ids').eq('exam_id',examId).eq('student_id',state.profile.id).maybeSingle()]);
    if(examError)throw examError;if(recordError)throw recordError;if(!record||record.status!=='completed')return toast('Your marks for this exam are not published yet.','error');
    const t=academicTotals(exam,record);
    const {data:classRecords,error:rankError}=await sb.from('student_exam_marks').select('student_id,marks,status,included_subject_ids').eq('exam_id',examId).eq('status','completed');if(rankError)throw rankError;
    const ranked=(classRecords||[]).map(r=>{const x=academicTotals(exam,r);return {student_id:r.student_id,pct:x.percentage||0}}).sort((a,b)=>b.pct-a.pct);const rank=ranked.findIndex(r=>r.student_id===state.profile.id)+1;
    const subs=t.subjects,marks=record.marks||{};
    modal(`<div class="modal-head"><div><span class="pill active">${esc(exam.exam_name)}</span><h2>${esc(state.profile.full_name)}</h2><p class="modal-subtitle">${classText(state.classNo)} • Detailed marks</p></div><button class="close-btn" data-close-modal><i class="fa-solid fa-xmark"></i></button></div><div class="marks-detail-summary"><div><span>Total marks</span><strong>${t.total} / ${t.full}</strong></div><div><span>Percentage</span><strong>${t.full?((t.total/t.full)*100).toFixed(2):'0.00'}%</strong></div><div><span>Class rank</span><strong>${rank>0?rankLabel(rank):'—'}</strong></div><div><span>Subjects counted</span><strong>${subs.length}</strong></div></div><div class="table-card"><table class="data-table marks-detail-table"><thead><tr><th>Subject</th><th>Marks</th><th>Full marks</th><th>Percentage</th></tr></thead><tbody>${subs.map(s=>{const m=Number(marks[s.subject_id]||0),fm=Number(s.full_marks||0);return `<tr><td><strong>${esc(s.subject_name)}</strong></td><td>${m}</td><td>${fm}</td><td>${fm?((m/fm)*100).toFixed(2):'0.00'}%</td></tr>`}).join('')}</tbody></table></div><div class="modal-actions"><button class="small-btn primary" data-close-modal>Done</button></div>`);
    $$('[data-close-modal]').forEach(b=>b.onclick=closeModal);
  }

  async function renderAdminAcademicExamSummary(classNo){
    const {data:exams,error}=await sb.from("academic_exam_sets").select("id,class_no,exam_name,created_at,academic_exam_subjects(subject_id,subject_name,full_marks)").eq("class_no",classNo).order("created_at",{ascending:false});
    if(error)throw error;const container=$("#admin-academic-exams");if(!container)return;
    container.innerHTML=(exams||[]).map(e=>`<button class="marks-exam-item wide" data-admin-exam="${esc(e.id)}"><span><strong>${esc(e.exam_name)}</strong><small>${(e.academic_exam_subjects||[]).length} subjects • ${fmtDate(e.created_at)}</small></span><i class="fa-solid fa-chevron-right"></i></button>`).join("")||`<div class="marks-empty">No school exam records yet.</div>`;
    $$("[data-admin-exam]",container).forEach(b=>b.onclick=()=>showAdminExamStudentPerformance(b.dataset.adminExam,classNo));
  }

  async function showAdminExamStudentPerformance(examId,classNo){
    const [{data:exam,error:examError},{data:students,error:studentError},{data:records,error:recordError}]=await Promise.all([
      sb.from("academic_exam_sets").select("id,class_no,exam_name,created_at,academic_exam_subjects(subject_id,subject_name,full_marks)").eq("id",examId).single(),
      sb.from("student_profiles").select("user_id,roll_number,profiles(full_name,login_id)").eq("class_no",classNo),
      sb.from("student_exam_marks").select("student_id,marks,status,updated_at").eq("exam_id",examId)
    ]);
    if(examError)throw examError;if(studentError)throw studentError;if(recordError)throw recordError;
    const map=new Map((records||[]).map(r=>[r.student_id,r])),rows=(students||[]).sort((a,b)=>String(a.roll_number||"").localeCompare(String(b.roll_number||""),undefined,{numeric:true}));
    modal(`<div class="modal-head"><div><span class="pill active">${esc(exam.exam_name)}</span><h2>Class ${classNo} student performance</h2><p class="modal-subtitle">Click a student to open complete subject-wise marks.</p></div><button class="close-btn" data-close-modal><i class="fa-solid fa-xmark"></i></button></div>
      <div class="marks-student-grid">${rows.map((s,i)=>{const r=map.get(s.user_id),marks=r?.marks||{},subs=includedAcademicSubjects(exam,r),total=subs.reduce((a,x)=>a+Number(marks[x.subject_id]||0),0),full=subs.reduce((a,x)=>a+Number(x.full_marks||0),0);return `<button class="marks-student-card" data-admin-student="${esc(s.user_id)}"><span class="marks-student-number">${i+1}</span><span class="marks-student-avatar">${esc(initials(s.profiles?.full_name))}</span><span class="marks-student-info"><strong>${esc(s.profiles?.full_name||"Student")}</strong><small>Roll No. ${esc(s.roll_number||"—")} • ${r?.status==="completed"?`${total}/${full} • ${full?((total/full)*100).toFixed(2):"0.00"}%`:"Not completed"}</small></span><i class="fa-solid fa-chevron-right"></i></button>`}).join("")}</div>`);
    $$("[data-close-modal]").forEach(b=>b.onclick=()=>$("#modal-root").innerHTML="");
    $$("[data-admin-student]").forEach(b=>b.onclick=()=>showAdminStudentExamDetail(exam,b.dataset.adminStudent,rows));
  }

  async function showAdminStudentAcademicOverview(classNo,studentId){
    const [{data:student,error:studentError},{data:exams,error:examError}]=await Promise.all([
      sb.from("student_profiles").select("user_id,class_no,roll_number,batch,phone,photo_path,profiles(full_name,login_id)").eq("user_id",studentId).eq("class_no",classNo).single(),
      sb.from("academic_exam_sets").select("id,class_no,exam_name,created_at,academic_exam_subjects(subject_id,subject_name,full_marks)").eq("class_no",classNo).order("created_at",{ascending:false})
    ]);
    if(studentError)throw studentError;if(examError)throw examError;
    const profile=(await addPhotoUrls([student]))[0]||student;
    const examList=exams||[];
    let records=[];
    if(examList.length){const {data,error}=await sb.from("student_exam_marks").select("exam_id,student_id,marks,status,updated_at").in("exam_id",examList.map(e=>e.id));if(error)throw error;records=data||[];}
    const recordMap=new Map(records.map(r=>[r.exam_id,r]));
    const stats=examList.map((exam,index)=>{const r=recordMap.get(exam.id),marks=r?.marks||{},subjects=includedAcademicSubjects(exam,r),full=subjects.reduce((n,s)=>n+Number(s.full_marks||0),0),total=subjects.reduce((n,s)=>n+Number(marks[s.subject_id]||0),0),percentage=full?total/full*100:null;return {exam,r,marks,subjects,full,total,percentage,index};});
    const completed=stats.filter(x=>x.r?.status==="completed"&&x.percentage!=null);
    const rankings=new Map();
    for(const x of completed){
      const {data:classRecords,error}=await sb.from("student_exam_marks").select("student_id,marks,status,included_subject_ids").eq("exam_id",x.exam.id).eq("status","completed");
      if(error)throw error;
      const ranked=(classRecords||[]).map(rec=>{const rt=academicTotals(x.exam,rec);return {student_id:rec.student_id,pct:rt.percentage||0}}).sort((a,b)=>b.pct-a.pct);
      const mine=ranked.findIndex(r=>r.student_id===studentId);rankings.set(x.exam.id,mine>=0?mine+1:null);
    }
    const latest=completed[0]||null,previous=completed[1]||null,overallAvg=completed.length?completed.reduce((n,x)=>n+x.percentage,0)/completed.length:0,latestChange=latest&&previous?latest.percentage-previous.percentage:null;
    const performance=overallAvg>=75?"Strong performance":overallAvg>=50?"Good progress":overallAvg>=35?"Needs attention":"Needs support";
    const photo=profile.photo_url?`<img class="admin-academic-profile-photo" src="${esc(profile.photo_url)}" alt="">`:esc(initials(profile.profiles?.full_name));
    modal(`<div class="modal-head"><div><span class="pill active">ACADEMIC PROFILE</span><h2>${esc(profile.profiles?.full_name||"Student")}</h2><p class="modal-subtitle">Class ${classNo} • Roll No. ${esc(profile.roll_number||"—")}</p></div><button class="close-btn" data-close-modal><i class="fa-solid fa-xmark"></i></button></div>
      <div class="admin-academic-profile-head"><span class="admin-academic-profile-avatar">${photo}</span><div><strong>${esc(profile.profiles?.full_name||"Student")}</strong><span>Roll No. ${esc(profile.roll_number||"—")} • ${classText(classNo)} • Batch ${esc(profile.batch||"—")}</span><span><i class="fa-solid fa-phone"></i> ${esc(profile.phone||"No phone number")}</span></div></div>
      <div class="marks-detail-summary admin-academic-summary"><div><span>Average percentage</span><strong>${overallAvg.toFixed(2)}%</strong></div><div><span>Exams completed</span><strong>${completed.length} / ${examList.length}</strong></div><div><span>Latest rank</span><strong>${latest?rankLabel(rankings.get(latest.exam.id)):"—"}</strong></div><div><span>Performance</span><strong>${performance}</strong></div></div>
      ${latestChange!=null?`<div class="academic-progress-banner ${latestChange>0?"improved":latestChange<0?"declined":"same"}"><i class="fa-solid ${latestChange>0?"fa-arrow-trend-up":latestChange<0?"fa-arrow-trend-down":"fa-minus"}"></i><div><strong>${latestChange>0?"Improved":latestChange<0?"Declined":"No change"} by ${Math.abs(latestChange).toFixed(2)} percentage points</strong><span>${esc(latest.exam.exam_name)} compared with ${esc(previous.exam.exam_name)}.</span></div></div>`:""}
      <div class="admin-academic-exam-details">${stats.map(x=>{const older=stats.slice(x.index+1).find(y=>y.r?.status==="completed"&&y.percentage!=null),change=x.percentage!=null&&older?x.percentage-older.percentage:null;return `<section class="admin-academic-exam-card"><div class="admin-academic-exam-head"><div><span class="pill">${esc(x.exam.exam_name)}</span><h3>${x.r?.status==="completed"?`${x.total} / ${x.full} • ${x.percentage.toFixed(2)}%`:`Not completed`}</h3><small>${fmtDate(x.exam.created_at)} • Rank ${x.r?.status==="completed"?rankLabel(rankings.get(x.exam.id)):"—"}</small></div>${change!=null?`<span class="trend ${change>0?"up":change<0?"down":"neutral"}"><i class="fa-solid ${change>0?"fa-arrow-up":change<0?"fa-arrow-down":"fa-minus"}"></i> ${change>0?"+":""}${change.toFixed(2)}%</span>`:""}</div><div class="table-card"><table class="data-table marks-detail-table"><thead><tr><th>Subject</th><th>Marks</th><th>Full marks</th><th>Percentage</th></tr></thead><tbody>${x.subjects.map(s=>{const m=Number(x.marks[s.subject_id]||0),fm=Number(s.full_marks||0);return `<tr><td><strong>${esc(s.subject_name)}</strong></td><td>${x.r?.status==="completed"?m:"—"}</td><td>${fm}</td><td>${x.r?.status==="completed"&&fm?((m/fm)*100).toFixed(2)+"%":"—"}</td></tr>`}).join("")}</tbody></table></div></section>`}).join("")||`<div class="marks-empty">No academic exams have been created for this class yet.</div>`}</div>
      <div class="modal-actions"><button class="small-btn primary" data-close-modal>Done</button></div>`);
    $$(`[data-close-modal]`).forEach(b=>b.onclick=()=>closeModal());
  }

  async function showAdminStudentExamDetail(exam,studentId,rows){
    const student=rows.find(s=>s.user_id===studentId);
    const {data:record,error}=await sb.from("student_exam_marks").select("marks,status,updated_at,included_subject_ids").eq("exam_id",exam.id).eq("student_id",studentId).maybeSingle();
    if(error)throw error;const marks=record?.marks||{},subs=includedAcademicSubjects(exam,record),total=subs.reduce((a,s)=>a+Number(marks[s.subject_id]||0),0),full=subs.reduce((a,s)=>a+Number(s.full_marks||0),0);
    modal(`<div class="modal-head"><div><span class="pill active">${esc(exam.exam_name)}</span><h2>${esc(student?.profiles?.full_name||"Student")}</h2><p class="modal-subtitle">Roll No. ${esc(student?.roll_number||"—")} • Class ${exam.class_no}</p></div><button class="close-btn" data-close-modal><i class="fa-solid fa-xmark"></i></button></div>
      <div class="marks-detail-summary"><div><span>Total marks</span><strong>${total} / ${full}</strong></div><div><span>Percentage</span><strong>${full?((total/full)*100).toFixed(2):"0.00"}%</strong></div><div><span>Status</span><strong>${record?.status==="completed"?"Completed":"Pending"}</strong></div></div>
      <div class="table-card"><table class="data-table marks-detail-table"><thead><tr><th>Subject</th><th>Marks</th><th>Full marks</th><th>Percentage</th></tr></thead><tbody>${subs.map(s=>{const m=Number(marks[s.subject_id]||0),fm=Number(s.full_marks||0);return `<tr><td><strong>${esc(s.subject_name)}</strong></td><td>${m}</td><td>${fm}</td><td>${fm?((m/fm)*100).toFixed(2):"0.00"}%</td></tr>`}).join("")}</tbody></table></div>
      <div class="modal-actions"><button class="small-btn primary" data-close-modal>Done</button></div>`);
    $$("[data-close-modal]").forEach(b=>b.onclick=()=>$("#modal-root").innerHTML="");
  }


  function empty(icon,title,text){return `<div class="empty-state"><i class="${icon}"></i><h3>${title}</h3><p>${text}</p></div>`}
  function emptyInline(t){return `<div class="empty-state"><p>${t}</p></div>`}

  function closeProfileMenu(){const m=$("#profile-menu");m.classList.add("hidden");$("#profile-button").setAttribute("aria-expanded","false")}
  function toggleProfile(){const m=$("#profile-menu"),show=m.classList.contains("hidden");m.classList.toggle("hidden",!show);$("#profile-button").setAttribute("aria-expanded",String(show))}
  function saveIdentityCache() {
    try {
      if (!state.session?.user?.id || !state.profile) return;
      sessionStorage.setItem("bcc_identity_cache", JSON.stringify({
        userId: state.session.user.id,
        profile: state.profile,
        student: state.student || null
      }));
    } catch (_) {}
  }

  function readIdentityCache(userId) {
    try {
      const raw = sessionStorage.getItem("bcc_identity_cache");
      if (!raw) return null;
      const cached = JSON.parse(raw);
      return cached?.userId === userId && cached?.profile ? cached : null;
    } catch (_) { return null; }
  }

  async function refreshIdentityInBackground() {
    try {
      const freshProfile = await currentProfile();
      if (!freshProfile) return;
      let freshStudent = null;
      if (freshProfile.role === "student") freshStudent = await getStudentProfile();
      const changed = JSON.stringify(freshProfile) !== JSON.stringify(state.profile) || JSON.stringify(freshStudent) !== JSON.stringify(state.student);
      state.profile = freshProfile;
      state.student = freshStudent;
      state.classNo = freshStudent?.class_no ?? null;
      saveIdentityCache();
      if (changed && document.visibilityState !== "hidden") await enterApp({ preserveRoute: true, skipStudentFetch: true });
    } catch (e) { console.warn("Background identity refresh failed", e); }
  }

  async function setup(){
    window.addEventListener("popstate", handlePopState);
    $$(".portal-tab").forEach(b=>b.onclick=()=>{$$(".portal-tab").forEach(x=>x.classList.remove("active"));b.classList.add("active");state.portal=b.dataset.portal;$("#login-hint").textContent=state.portal==="student"?"Student login: use the Student ID given by BCC.":"Teacher login: use the teacher/admin ID given by BCC."});
    $("#login-form").onsubmit=e=>{e.preventDefault();login()};
    $$("[data-toggle-password]").forEach(b=>b.onclick=()=>{const i=$(b.dataset.togglePassword);i.type=i.type==="password"?"text":"password";b.innerHTML=`<i class="fa-regular fa-eye${i.type==="password"?"":"-slash"}"></i>`});
    $$(".logout-btn").forEach(b=>b.onclick=logout);
    $("#staff-photo-action")?.addEventListener("click",()=>$("#staff-photo-file")?.click());
    $("#staff-photo-file")?.addEventListener("change",uploadStaffPhoto);
    $("#profile-button").onclick=e=>{e.stopPropagation();toggleProfile()};document.addEventListener("click",e=>{if(!e.target.closest(".profile-menu-wrap"))closeProfileMenu()});
    $("#sidebar-open").onclick=()=>toggleSidebar(true);$("#sidebar-close").onclick=()=>toggleSidebar(false);$("#mobile-overlay").onclick=()=>toggleSidebar(false);
    $$(".nav-item[data-view]").forEach(b=>b.onclick=()=>navigate(b.dataset.view));
    if(!hasConfig){showLoginScreen();toast("Configure config.js with your Supabase project before logging in.","error");return;}
    if(sb){
      try{
        const {data}=await sb.auth.getSession();
        if(data.session){
          state.session=data.session;
          const cached = readIdentityCache(data.session.user.id);
          if(cached){
            state.profile = cached.profile;
            state.student = cached.student;
            state.classNo = cached.student?.class_no ?? null;
            await enterApp({ preserveRoute: false, skipStudentFetch: true });
            // The cached identity makes refresh feel immediate; the server copy
            // is still checked in the background for correctness.
            refreshIdentityInBackground();
            return;
          }
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
  function toggleSidebar(open){
    const mobile=window.matchMedia("(max-width:900px) and (pointer: coarse), (max-width:760px)").matches;
    if(!mobile){ $("#sidebar").classList.remove("open"); $("#mobile-overlay").classList.remove("open"); return; }
    $("#sidebar").classList.toggle("open",open);
    $("#mobile-overlay").classList.toggle("open",open);
  }
  function syncResponsiveLayout(){
    const mobile=window.matchMedia("(max-width:900px) and (pointer: coarse), (max-width:760px)").matches;
    if(!mobile){ $("#sidebar").classList.remove("open"); $("#mobile-overlay").classList.remove("open"); }
    document.body.classList.toggle("is-mobile",mobile);
  }
  window.addEventListener("resize",syncResponsiveLayout,{passive:true});
  window.addEventListener("orientationchange",()=>setTimeout(syncResponsiveLayout,80),{passive:true});
  document.addEventListener("DOMContentLoaded",()=>{syncResponsiveLayout();setup();});
})();