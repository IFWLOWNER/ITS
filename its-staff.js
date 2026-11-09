// ============================================================
// ITS — staff page bootstrap (steward.html, headsteward.html)
//
// One set of pages for every league. When a steward signs in this:
//   1. finds which league(s) they're staff in (users/{email}.leagues),
//      asks them to pick if there's more than one (?league=<id> also works)
//   2. checks their role and sends them to the right dashboard
//   3. checks the league is approved
//   4. applies the league's own name + logo to the page
//   5. exposes LID / LREF / LEAGUE / ITS_CTX for the page's own code
// Also: driver history (tickets + imported spreadsheet records) and the
// links drivers use to submit tickets and statements.
// ============================================================
var LID = null, LREF = null, LEAGUE = null, ITS_CTX = null, ITS_CURRENT_TICKET = null;

const ITSStaff = (() => {
  // Must match PRIVACY_VERSION in functions/index.js and owner.html. Cross-
  // league records only work once the league owner has confirmed it.
  const PRIVACY_VERSION = "2026-11-09";
  const networkOn = () => !!(LEAGUE && LEAGUE.privacyConfirmation && LEAGUE.privacyConfirmation.version === PRIVACY_VERSION);
  const BASE = new URL("./", location.href).href;
  const ROLE_LABEL = { owner: "Owner", headsteward: "Head Steward", seniorsteward: "Senior Steward", steward: "Steward", moderator: "Moderator" };
  const HEAD_ROLES = ["owner", "headsteward"];
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // Every steward comment carries its league, so the 7-day activity
  // panels can query across tickets for this league only.
  (function tagStewardComments() {
    try {
      const fs = firebase.firestore;
      const tag = (ref, data) => (ref && ref.path && ref.path.includes("/steward_comments") && LID && data && typeof data === "object" && !data.leagueId) ? { ...data, leagueId: LID } : data;
      const CR = fs.CollectionReference.prototype, DR = fs.DocumentReference.prototype, WB = fs.WriteBatch && fs.WriteBatch.prototype;
      const add = CR.add; CR.add = function (data) { return add.call(this, tag(this, data)); };
      const set = DR.set; DR.set = function (data, opts) { return set.call(this, tag(this, data), opts); };
      if (WB) { const bset = WB.set; WB.set = function (ref, data, opts) { return bset.call(this, ref, tag(ref, data), opts); }; }
      const TX = fs.Transaction && fs.Transaction.prototype;
      if (TX) { const tset = TX.set; TX.set = function (ref, data, opts) { return tset.call(this, ref, tag(ref, data), opts); }; }
    } catch (e) { console.warn("ITS: could not tag steward comments", e); }
  })();

  // ---------- overlay (sign-in / picker / messages) ----------
  function ensureOverlay() {
    let ov = document.getElementById("itsGate");
    if (ov) return ov;
    const css = document.createElement("style");
    css.textContent = `
      #itsGate{ position:fixed; inset:0; z-index:10000; display:flex; align-items:flex-start; justify-content:center; padding:60px 16px; overflow:auto;
        background:radial-gradient(circle at 12% -4%, rgba(79,70,229,.15), transparent 34%), radial-gradient(circle at 88% 0%, rgba(219,39,119,.12), transparent 38%), #f5f4fd; }
      #itsGate .itsBox{ width:min(520px,100%); background:#fff; border:1px solid #e4e0fb; border-radius:22px; box-shadow:0 18px 40px rgba(79,70,229,.13); padding:22px; font-family:Inter, ui-sans-serif, system-ui, sans-serif; color:#111827; }
      #itsGate h2{ margin:0 0 6px; font-family:Manrope, Inter, sans-serif; font-size:19px; color:#0f172a; }
      #itsGate p{ margin:6px 0; color:#64748b; font-size:13px; font-weight:600; line-height:1.45; }
      #itsGate .itsBtns{ display:flex; gap:10px; flex-wrap:wrap; margin-top:16px; }
      #itsGate button{ min-height:42px; padding:10px 16px; border-radius:999px; border:1px solid #e4e0fb; background:#fff; font-weight:750; font-size:13px; cursor:pointer; }
      #itsGate button.p{ background:linear-gradient(135deg,#4f46e5,#7c3aed 55%,#db2777); color:#fff; border-color:transparent; }
      #itsGate .itsPick{ display:flex; align-items:center; gap:12px; width:100%; text-align:left; border-radius:14px; margin-top:8px; }
      #itsGate .itsPick img{ width:34px; height:34px; border-radius:9px; object-fit:contain; background:#f5f4fd; }
      #itsGate .itsWarn{ border:1px solid #fde68a; background:#fffbeb; color:#92400e; border-radius:12px; padding:10px 12px; font-size:12.5px; font-weight:700; margin-top:10px; }
      #itsGate .itsErr{ color:#9f1239; font-size:12.5px; font-weight:700; margin-top:10px; }`;
    document.head.appendChild(css);
    ov = document.createElement("div");
    ov.id = "itsGate";
    document.body.appendChild(ov);
    return ov;
  }
  function show(html) { const ov = ensureOverlay(); ov.innerHTML = `<div class="itsBox">${html}</div>`; ov.style.display = "flex"; return ov; }
  function hide() { const ov = document.getElementById("itsGate"); if (ov) ov.style.display = "none"; }
  function signOutBtn() { return `<button data-its="signout">Sign out</button>`; }
  function wire(ov, handlers) {
    ov.querySelectorAll("[data-its]").forEach(b => {
      const k = b.dataset.its;
      if (k === "signout") b.onclick = async () => { await auth.signOut(); location.reload(); };
      else if (handlers && handlers[k]) b.onclick = () => handlers[k](b);
    });
  }
  function inAppBrowser() { return /Discord|FBAN|FBAV|Instagram|Line\/|Twitter|; wv\)/i.test(navigator.userAgent || ""); }

  function showSignIn(title) {
    const ov = show(`
      <h2>${esc(title || "Staff sign in")}</h2>
      <p>Sign in with the Google account your league owner added you with.</p>
      ${inAppBrowser() ? `<div class="itsWarn">You're in an in-app browser (e.g. Discord) — Google blocks sign-in here. Use the ⋯ menu → “Open in browser”.</div>` : ""}
      <div class="itsBtns"><button class="p" data-its="google">Continue with Google</button></div>
      <div class="itsErr" id="itsGateErr"></div>`);
    wire(ov, {
      google: async () => {
        const p = new firebase.auth.GoogleAuthProvider();
        p.setCustomParameters({ prompt: "select_account" });
        try { await auth.signInWithPopup(p); }
        catch (e) {
          if (e && e.code === "auth/popup-blocked") { try { await auth.signInWithRedirect(p); return; } catch (e2) { e = e2; } }
          if (e && e.code === "auth/popup-closed-by-user") return;
          document.getElementById("itsGateErr").textContent = (e && e.message || String(e)).replace(/^Firebase:\s*/, "");
        }
      }
    });
  }
  function message(title, text, extraBtns = "") {
    const ov = show(`<h2>${esc(title)}</h2><p>${text}</p><div class="itsBtns">${extraBtns}${signOutBtn()}</div>`);
    wire(ov, {
      owner: () => location.href = BASE + "owner.html",
      steward: () => location.href = BASE + "steward.html?league=" + encodeURIComponent(LID || ""),
      retry: () => location.reload()
    });
  }

  function pickLeague(options) {
    return new Promise(resolve => {
      const ov = show(`<h2>Which league?</h2><p>You're staff in more than one league. Choose one — you can switch any time by signing in again.</p>
        <div>${options.map((o, i) => `<button class="itsPick" data-its="pick${i}">${o.logoUrl ? `<img src="${esc(o.logoUrl)}" alt="" onerror="this.style.visibility='hidden'">` : ""}<span><strong>${esc(o.name)}</strong><br><span style="font-weight:600;color:#64748b;font-size:12px;">${esc(ROLE_LABEL[o.role] || o.role)}</span></span></button>`).join("")}</div>
        <div class="itsBtns">${signOutBtn()}</div>`);
      const handlers = {};
      options.forEach((o, i) => handlers["pick" + i] = () => resolve(o.id));
      wire(ov, handlers);
    });
  }

  function remember(lid) { try { localStorage.setItem("ITS_LAST_LEAGUE", lid); } catch (e) { /* private mode */ } }
  function lastLeague() { try { return localStorage.getItem("ITS_LAST_LEAGUE"); } catch (e) { return null; } }

  // ---------- the gate ----------
  // page: "steward" | "headsteward". Returns ctx, or null if the page must stop.
  async function gate(user, page) {
    if (!user) { showSignIn(page === "headsteward" ? "Head Steward sign in" : "Steward sign in"); return null; }
    const email = (user.email || "").toLowerCase().trim();
    show(`<h2>Loading your league…</h2><p>Signed in as ${esc(email)}</p>`);

    let leagues = {};
    try {
      const u = await db.collection("users").doc(email).get();
      leagues = (u.exists && u.data().leagues) || {};
    } catch (e) {
      message("Couldn't load your account", esc(e.message || e), `<button class="p" data-its="retry">Try again</button>`);
      return null;
    }
    const ids = Object.keys(leagues);
    if (!ids.length) {
      message("No league access", `<strong>${esc(email)}</strong> isn't staff in any league on ITS yet. Ask your league owner to add this exact Google account on their Owner Dashboard (Staff tab), then sign in again.`);
      return null;
    }

    const wanted = new URLSearchParams(location.search).get("league");
    let lid = (wanted && ids.includes(wanted)) ? wanted : null;
    if (!lid && ids.length === 1) lid = ids[0];
    if (!lid && ids.includes(lastLeague())) lid = lastLeague();
    if (!lid) {
      const opts = await Promise.all(ids.map(async id => {
        try { const s = await db.collection("leagues").doc(id).get(); const d = s.data() || {}; return { id, name: d.name || id, logoUrl: d.logoUrl || "", role: leagues[id] }; }
        catch (e) { return { id, name: id, logoUrl: "", role: leagues[id] }; }
      }));
      lid = await pickLeague(opts);
    }
    remember(lid);
    LID = lid;
    LREF = db.collection("leagues").doc(lid);

    let staffDoc, leagueSnap;
    try {
      [staffDoc, leagueSnap] = await Promise.all([LREF.collection("staff").doc(email).get(), LREF.get()]);
    } catch (e) {
      message("You no longer have access", `Your access to this league may have been removed. If you think that's wrong, ask your league owner.<br><br><small>${esc(e.message || e)}</small>`);
      return null;
    }
    if (!staffDoc.exists || !leagueSnap.exists) {
      message("You no longer have access", "Your league owner has removed you from this league's staff, or the league no longer exists.");
      return null;
    }
    const role = staffDoc.data().role;
    LEAGUE = leagueSnap.data();

    let status = LEAGUE.status || "pending";
    const until = LEAGUE.accessUntil ? (LEAGUE.accessUntil.toMillis ? LEAGUE.accessUntil.toMillis() : Number(LEAGUE.accessUntil)) : null;
    if (["active", "approved", "beta"].includes(status) && until != null && until <= Date.now()) status = "expired";
    if (!["active", "approved", "beta"].includes(status)) {
      message(status === "pending" ? "League waiting for approval" : status === "expired" ? "ITS plan ended" : "League not active",
        status === "pending"
          ? `<strong>${esc(LEAGUE.name)}</strong> hasn't been approved by ITS yet. Stewarding switches on as soon as it is.`
          : status === "expired"
          ? `<strong>${esc(LEAGUE.name)}</strong>'s ITS plan has ended, so stewarding is paused. Nothing has been lost — it all comes back as soon as the league owner extends the plan.`
          : `<strong>${esc(LEAGUE.name)}</strong> is currently <strong>${esc(status)}</strong>. Contact your league owner.`,
        role === "owner" ? `<button class="p" data-its="owner">Open Owner Dashboard</button>` : "");
      return null;
    }

    let seniorMode = false;
    if (role === "seniorsteward") {
      try { const m = await LREF.collection("meta").doc("seniorStewardMode").get(); seniorMode = !!(m.exists && m.data().enabled === true); } catch (e) { seniorMode = false; }
    }
    const isHeadLevel = HEAD_ROLES.includes(role) || (role === "seniorsteward" && seniorMode);
    const q = "?league=" + encodeURIComponent(lid);

    if (role === "moderator") {
      message("Moderator access", `You're a Moderator in <strong>${esc(LEAGUE.name)}</strong>. The moderator dashboard isn't available yet.`);
      return null;
    }
    if (page === "steward" && isHeadLevel) { location.replace(BASE + "headsteward.html" + q); return null; }
    if (page === "headsteward" && !isHeadLevel) { location.replace(BASE + "steward.html" + q); return null; }
    if (!wanted || wanted !== lid) { try { history.replaceState(null, "", location.pathname + q + location.hash); } catch (e) { /* ignore */ } }

    let privateCfg = {};
    if (isHeadLevel) {
      try { const p = await LREF.collection("private").doc("config").get(); privateCfg = p.exists ? p.data() : {}; }
      catch (e) { console.warn("ITS: webhooks not readable for this role", e); }
    }

    ITS_CTX = { email, lid, role, roleLabel: ROLE_LABEL[role] || role, isOwner: role === "owner", isHeadLevel, seniorMode, league: LEAGUE, privateCfg };
    applyBranding(page);
    injectNetCss();
    watchTicketList();
    hide();
    return ITS_CTX;
  }

  function applyBranding(page) {
    const name = LEAGUE.name || "League";
    const pageName = page === "headsteward" ? "Head Steward Dashboard" : "Steward Dashboard";
    document.title = `${name} — ${pageName}`;
    document.querySelectorAll("[data-its-title]").forEach(el => el.textContent = `${name} — ${pageName}`);
    document.querySelectorAll("[data-its-league-name]").forEach(el => el.textContent = name);
    document.querySelectorAll("img[data-its-logo]").forEach(img => {
      if (LEAGUE.logoUrl) { img.onerror = () => { img.style.display = "none"; }; img.src = LEAGUE.logoUrl; img.alt = name; img.style.display = ""; }
      else img.style.display = "none";
    });
    const ownerBtn = document.getElementById("itsOwnerBtn");
    if (ownerBtn) { ownerBtn.style.display = ITS_CTX.isOwner ? "" : "none"; ownerBtn.onclick = () => location.href = BASE + "owner.html"; }
    const stBtn = document.getElementById("itsStatementLinkBtn");
    if (stBtn) stBtn.onclick = async (e) => {
      e.stopPropagation();
      let id = ""; try { id = selectedTicketId; } catch (err) { id = ""; } // the page's own selected ticket
      if (!id) { if (typeof toast === "function") toast("Open a ticket first."); return; }
      const url = statementLink(id);
      try { await navigator.clipboard.writeText(url); if (typeof toast === "function") toast("Statement link copied — post it for the drivers involved:\n" + url); }
      catch (err) { prompt("Statement link for this ticket:", url); }
    };
    const linkBtn = document.getElementById("itsTicketLinkBtn");
    if (linkBtn) linkBtn.onclick = async () => {
      const url = ticketLink();
      try { await navigator.clipboard.writeText(url); if (typeof toast === "function") toast("Driver ticket link copied:\n" + url); }
      catch (e) { prompt("Your league's ticket link for drivers:", url); }
    };
  }


  // ---------- ITS network: other leagues + ban alerts ----------
  function injectNetCss() {
    if (document.getElementById("itsNetCss")) return;
    const css = document.createElement("style");
    css.id = "itsNetCss";
    css.textContent = `
      @keyframes itsBanPulse{ 0%,100%{ background:#e11d48; box-shadow:0 0 0 0 rgba(225,29,72,.55); } 50%{ background:#9f1239; box-shadow:0 0 0 7px rgba(225,29,72,0); } }
      .itsBanBadge{ display:inline-flex; align-items:center; gap:5px; margin-left:8px; padding:3px 9px; border-radius:999px; color:#fff; font-size:11px; font-weight:900; letter-spacing:.05em; text-transform:uppercase; animation:itsBanPulse 1.1s ease-in-out infinite; vertical-align:middle; cursor:help; white-space:nowrap; }
      .itsBanFlag{ position:relative; z-index:2; display:flex; align-items:center; gap:8px; margin:0 0 8px; padding:6px 10px; border-radius:10px; color:#fff; font-size:11.5px; font-weight:900; letter-spacing:.04em; animation:itsBanPulse 1.1s ease-in-out infinite; }
      .itsBanFlag small{ font-weight:700; letter-spacing:0; opacity:.95; text-transform:none; }
      .itsNet{ margin-top:10px; border-top:1px dashed #e4e0fb; padding-top:8px; }
      .itsNetHead{ font-size:12px; font-weight:850; color:#0f172a; margin-bottom:6px; }
      .itsNetBan{ border:1px solid #fecdd6; background:#fff1f4; color:#9f1239; border-radius:12px; padding:8px 10px; font-size:12px; font-weight:800; line-height:1.35; margin-bottom:8px; }
      .itsNetBan small{ display:block; font-weight:650; margin-top:3px; }
      .itsNetItem{ border:1px solid #e4e0fb; border-radius:12px; background:#fff; padding:8px 10px; font-size:12px; line-height:1.35; margin-top:6px; }
      .itsNetItem .muted{ font-size:11.5px; }
      .itsSev{ display:inline-block; padding:1px 7px; border-radius:999px; font-size:10.5px; font-weight:850; margin-left:4px; }
      .itsSev.mild{ background:#fffbeb; color:#92400e; border:1px solid #fde68a; }
      .itsSev.standard{ background:#fff7ed; color:#9a3412; border:1px solid #fdba74; }
      .itsSev.severe{ background:#fff1f4; color:#9f1239; border:1px solid #fecdd6; }`;
    document.head.appendChild(css);
  }

  const netCache = new Map();
  let ownBansCache = null, ownBansAt = 0;
  async function ownBans() {
    if (ownBansCache && Date.now() - ownBansAt < 60000) return ownBansCache;
    ownBansCache = new Map();
    try { const s = await LREF.collection("bans").get(); s.forEach(d => ownBansCache.set(d.id, d.data())); }
    catch (e) { console.warn("ITS bans:", e); }
    ownBansAt = Date.now();
    return ownBansCache;
  }
  async function summary(key) {
    if (!key || !networkOn()) return null;
    const c = netCache.get("s:" + key);
    if (c && Date.now() - c.at < 60000) return c.v;
    let v = null;
    try { const s = await db.collection("itsDrivers").doc(key).get(); v = s.exists ? s.data() : null; }
    catch (e) { console.warn("ITS network summary:", e); }
    netCache.set("s:" + key, { v, at: Date.now() });
    return v;
  }
  async function otherLeagueRecords(key) {
    if (!networkOn()) return [];
    const c = netCache.get("r:" + key);
    if (c && Date.now() - c.at < 60000) return c.v;
    let v = [];
    try {
      const s = await db.collection("itsDrivers").doc(key).collection("records").limit(100).get();
      v = s.docs.map(d => d.data()).filter(r => r.leagueId !== LID).sort((a, b) => tMs({ timestamp: b.date }) - tMs({ timestamp: a.date }));
    } catch (e) { console.warn("ITS network records:", e); }
    netCache.set("r:" + key, { v, at: Date.now() });
    return v;
  }
  // { own: ban doc | null, elsewhere: [{leagueName, reason}] }
  async function banStatus(key) {
    if (!key) return { own: null, elsewhere: [] };
    const [s, mine] = await Promise.all([summary(key), ownBans()]);
    const elsewhere = ((s && s.bannedIn) || []).filter(b => b.leagueId !== LID);
    return { own: mine.get(key) || null, elsewhere };
  }
  const banTitle = (st, who) => [st.own ? `${who} is on YOUR league's ban list${st.own.reason ? " — " + st.own.reason : ""}.` : "", ...st.elsewhere.map(b => `Banned in ${b.leagueName}${b.reason ? " — " + b.reason : ""}.`)].filter(Boolean).join("\n") + "\nBe mindful: a ban elsewhere doesn't ban them from your league.";
  const isBanned = (st) => !!(st.own || st.elsewhere.length);

  function describeRecord(r) {
    const when = tMs({ timestamp: r.date }) ? new Date(tMs({ timestamp: r.date })).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "";
    if (r.type === "import") return { line: `${esc(r.outcome || "Outcome not recorded")} <span class="muted">(imported record)</span>`, sub: [when].filter(Boolean).map(esc).join(" · ") };
    const sev = r.severity ? `<span class="itsSev ${esc(r.severity)}">${esc(r.severity.charAt(0).toUpperCase() + r.severity.slice(1))}</span>` : "";
    const what = r.nfa ? `No further action${r.ruleTitle && !/no further action/i.test(r.ruleTitle) ? " — " + esc(r.ruleTitle) : ""}` : `${esc(r.penalty || r.outcome || "Penalty")} — ${esc(r.ruleTitle || r.ruleCode || "rule not recorded")}${sev}`;
    return { line: what, sub: [r.event, when].filter(Boolean).map(esc).join(" · ") };
  }

  async function renderNetwork(container, names, key) {
    if (!container) return;
    container.querySelectorAll(".itsNet").forEach(n => n.remove());
    const wrap = document.createElement("div");
    wrap.className = "itsNet";
    container.appendChild(wrap);
    if (!networkOn()) {
      const own = key ? (await ownBans()).get(key) : null;
      wrap.innerHTML = `<div class="itsNetHead">Across ITS</div>${own ? `<div class="itsNetBan">⛔ ${esc(names[0] || "@" + key)} is on your league's ban list${own.reason ? `<small>${esc(own.reason)}</small>` : ""}</div>` : ""}<div class="driverHistoryEmpty">Cross-league records are switched off for your league until your league owner confirms the ITS Privacy &amp; Data Rules on the Owner Dashboard.</div>`;
      return;
    }
    if (!key) { wrap.innerHTML = `<div class="itsNetHead">Across ITS</div><div class="driverHistoryEmpty">No Discord username on this ticket, so other ITS leagues can't be checked.</div>`; return; }
    wrap.innerHTML = `<div class="itsNetHead">Across ITS</div><div class="driverHistoryEmpty">Checking other leagues…</div>`;
    const [recs, st] = await Promise.all([otherLeagueRecords(key), banStatus(key)]);
    const who = esc(names[0] || "@" + key);
    const bans = (st.own ? `<div class="itsNetBan">⛔ ${who} is on your league's ban list${st.own.reason ? `<small>${esc(st.own.reason)}</small>` : ""}</div>` : "")
      + st.elsewhere.map(b => `<div class="itsNetBan">⛔ ${who} is BANNED in ${esc(b.leagueName)}${b.reason ? `<small>Reason given: ${esc(b.reason)}</small>` : ""}<small>Be mindful — this doesn't ban them from your league.</small></div>`).join("");
    const leagues = [...new Set(recs.map(r => r.leagueName || r.leagueId))];
    const penalties = recs.filter(r => !r.nfa).length;
    const head = recs.length
      ? `${who} has ${penalties} confirmed penalt${penalties === 1 ? "y" : "ies"} in ${leagues.length} other ITS league${leagues.length === 1 ? "" : "s"}`
      : `${who} has no records in other ITS leagues.`;
    const items = recs.slice(0, 15).map(r => { const d = describeRecord(r); return `<div class="itsNetItem"><div><strong>${esc(r.leagueName || r.leagueId)}</strong>: ${d.line}</div>${d.sub ? `<div class="muted">${d.sub}</div>` : ""}</div>`; }).join("");
    wrap.innerHTML = `<div class="itsNetHead">Across ITS</div>${bans}<div style="font-size:12px;font-weight:750;color:#334155;">${head}</div>${items}${recs.length > 15 ? `<div class="driverHistoryEmpty">…and ${recs.length - 15} more.</div>` : ""}<div class="driverHistoryEmpty" style="margin-top:6px;">Confirmed penalties and bans only. Treat as information, not an automatic ban — don't copy, screenshot or share outside ITS.</div>`;
  }

  // Flashing BANNED badge next to a driver's name on the open ticket.
  async function badgeName(role, names, key) {
    const el = document.getElementById(`sum${role}`);
    if (!el) return;
    el.parentElement.querySelectorAll(".itsBanBadge").forEach(b => b.remove());
    if (!key) return;
    const st = await banStatus(key);
    if (!isBanned(st)) return;
    const b = document.createElement("span");
    b.className = "itsBanBadge";
    b.textContent = "⛔ Banned";
    b.title = banTitle(st, names[0] || "@" + key);
    el.insertAdjacentElement("afterend", b);
  }

  // Flashing BANNED strip on any ticket card in the list whose accused or
  // reporter is banned (here or in another ITS league).
  let flagTimer = null, flagging = false;
  async function flagTicketCards() {
    if (flagging) return;
    flagging = true;
    try {
      const list = document.getElementById("ticketList");
      if (!list) return;
      const cards = [...list.querySelectorAll("[data-ticket-id]")];
      if (!cards.length) return;
      let tickets = await allTickets();
      if (cards.some(c => !tickets.find(t => t.id === c.dataset.ticketId))) { ticketCache = null; tickets = await allTickets(); }
      const byId = new Map(tickets.map(t => [t.id, t]));
      for (const card of cards) {
        const t = byId.get(card.dataset.ticketId);
        if (!t) continue;
        const parts = [];
        for (const [label, nameVal, d] of [["Accused", t.accused, t.accusedDiscord], ["Reporter", t.reporter, t.reporterDiscord]]) {
          const key = discKey(d);
          if (!key) continue;
          const st = await banStatus(key);
          if (isBanned(st)) parts.push({ label, name: asNames(nameVal)[0] || "@" + key, st });
        }
        const existing = card.querySelector(":scope > .itsBanFlag");
        if (!parts.length) { if (existing) existing.remove(); continue; }
        const text = parts.map(p => `${p.label} ${p.name}: ${[p.st.own ? "your ban list" : "", ...p.st.elsewhere.map(b => b.leagueName)].filter(Boolean).join(", ")}`).join(" · ");
        const flag = existing || document.createElement("div");
        flag.className = "itsBanFlag";
        flag.innerHTML = `⛔ BANNED <small>${esc(text)}</small>`;
        flag.title = parts.map(p => banTitle(p.st, p.name)).join("\n\n");
        if (!existing) card.insertBefore(flag, card.firstChild);
      }
    } catch (e) { console.warn("ITS ban flags:", e); }
    finally { flagging = false; }
  }
  function watchTicketList() {
    const list = document.getElementById("ticketList");
    if (!list || list.__itsWatched) return;
    list.__itsWatched = true;
    new MutationObserver((muts) => {
      if (muts.every(m => [...m.addedNodes].every(n => n.nodeType !== 1 || (n.classList && n.classList.contains("itsBanFlag"))))) return;
      clearTimeout(flagTimer); flagTimer = setTimeout(flagTicketCards, 400);
    }).observe(list, { childList: true, subtree: true });
    setTimeout(flagTicketCards, 800);
  }

  // ---------- links ----------
  function ticketLink(lid) { return `${BASE}ticket.html?l=${encodeURIComponent(lid || LID)}`; }
  function statementLink(ticketId, lid) { return `${ticketLink(lid)}&statement=${encodeURIComponent(ticketId)}`; }
  function stewardLink(lid) { return `${BASE}steward.html?league=${encodeURIComponent(lid || LID)}`; }

  // ---------- driver history ----------
  // Matches past tickets by Discord username first (the link across ITS),
  // then by name; and adds records imported from the league's old
  // spreadsheet system (leagues/{lid}/driverHistory).
  const histNameKey = (n) => String(n || "").replace(/^\s*[\[(][^\])]*[\])]\s*-?\s*/, "").trim().toLowerCase();
  const asNames = (raw) => Array.isArray(raw) ? raw.filter(Boolean) : (typeof raw === "string" && raw.trim() ? [raw.trim()] : []);
  const discKey = (v) => String(v || "").trim().replace(/^@/, "").toLowerCase();
  const tMs = (t) => { const v = t && (t.timestamp || t.createdAt || t.submittedAt || t.finalisedAt); try { if (v && v.toDate) return v.toDate().getTime(); if (typeof v === "string" || typeof v === "number") { const d = new Date(v); return isNaN(d) ? 0 : d.getTime(); } } catch (e) { /* ignore */ } return 0; };
  let ticketCache = null, ticketCacheAt = 0;
  const importedCache = new Map();

  async function allTickets() {
    if (ticketCache && Date.now() - ticketCacheAt < 60000) return ticketCache;
    try { const s = await LREF.collection("tickets").limit(1500).get(); ticketCache = s.docs.map(d => ({ id: d.id, ...(d.data() || {}) })); }
    catch (e) { console.warn("ITS history tickets:", e); ticketCache = []; }
    ticketCacheAt = Date.now();
    return ticketCache;
  }
  async function imported(key) {
    if (!key) return [];
    if (importedCache.has(key)) return importedCache.get(key);
    let rows = [];
    try { const s = await LREF.collection("driverHistory").where("discordKey", "==", key).limit(50).get(); rows = s.docs.map(d => d.data()); }
    catch (e) { console.warn("ITS imported history:", e); }
    importedCache.set(key, rows);
    return rows;
  }

  async function renderColumn(role, names, discord, excludeId, onOpen) {
    const labelEl = document.getElementById(`history${role}Label`), listEl = document.getElementById(`history${role}List`);
    if (!labelEl || !listEl) return;
    const key = discKey(discord);
    listEl.parentElement.querySelectorAll(".itsNet").forEach(n => n.remove());
    labelEl.textContent = (names[0] || "—") + (key ? ` (@${key})` : "");
    if (!names.length && !key) { listEl.innerHTML = `<div class="driverHistoryEmpty">No driver recorded on this ticket.</div>`; return; }
    listEl.innerHTML = `<div class="driverHistoryEmpty">Loading…</div>`;
    const [tickets, old] = await Promise.all([allTickets(), imported(key)]);
    const nameKeys = names.map(histNameKey).filter(Boolean);
    const hit = (nameVal, discVal) => (key && discKey(discVal) === key) || asNames(nameVal).some(n => nameKeys.includes(histNameKey(n)));
    const entries = [];
    tickets.forEach(t => {
      if (t.id === excludeId) return;
      if (hit(t.accused, t.accusedDiscord)) entries.push({ t, role: "Accused" });
      else if (hit(t.reporter, t.reporterDiscord)) entries.push({ t, role: "Reporter" });
    });
    entries.sort((a, b) => tMs(b.t) - tMs(a.t));
    const html = entries.slice(0, 12).map(({ t, role: r }) => `
      <div class="driverHistoryItem" data-ticket-id="${esc(t.id)}">
        <div><span class="roleTag">${r}</span> — ${esc(t.event || "Unknown event")}</div>
        <div class="muted">${esc(t.finalPenaltyCode || t.ruleBreach || t.postRaceCode || "No rule/code listed")} &middot; ${esc(t.status || "Under Review")} &middot; ${esc(tMs(t) ? new Date(tMs(t)).toLocaleString() : "—")}</div>
      </div>`).join("")
      + old.slice(0, 20).map(h => `
      <div class="driverHistoryItem" style="cursor:default;">
        <div><span class="roleTag">Imported record</span> — ${esc(h.outcome || "No outcome recorded")}</div>
        <div class="muted">${esc(h.driverName || "")}${h.comments ? " &middot; " + esc(h.comments) : ""}</div>
      </div>`).join("");
    listEl.innerHTML = html || `<div class="driverHistoryEmpty">No other tickets or imported records in this league.</div>`;
    listEl.querySelectorAll("[data-ticket-id]").forEach(el => el.onclick = () => onOpen && onOpen(el.dataset.ticketId));
    await renderNetwork(listEl.parentElement, names, key);
  }

  function renderDriverHistory(ticketId, t, onOpen) {
    injectNetCss();
    renderColumn("Accused", asNames(t.accused), t.accusedDiscord, ticketId, onOpen);
    renderColumn("Reporter", asNames(t.reporter), t.reporterDiscord, ticketId, onOpen);
    badgeName("Accused", asNames(t.accused), discKey(t.accusedDiscord));
    badgeName("Reporter", asNames(t.reporter), discKey(t.reporterDiscord));
  }

  return { BASE, ROLE_LABEL, PRIVACY_VERSION, networkOn, gate, ticketLink, statementLink, stewardLink, renderDriverHistory };
})();
