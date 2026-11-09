// ============================================================
// ITS — ticket rules (shared by every ITS page)
//
// ITS Standard Ticket Rules live in its_standard_rules.json (maintained
// by ITS — leagues can't change them). Each league picks a mode, stored
// in leagues/{lid}/meta/ticketRules:
//   "its"       ITS Standard only (default)
//   "its_plus"  ITS Standard + the league's own extra rules
//   "custom"    the league's own rules only
// Every rule MUST have all three severities — mild, standard, severe —
// each with a penalty and a description. Anything incomplete is refused
// when saving and ignored when loading, so stewards never see a half rule.
//
// flatten() turns rules into the same row shape IFWL's steward_rules.json
// uses ({ Code, Group, Title, Description, Example, Who, Penalty }), so
// the ported steward / head steward pages can use them unchanged.
// ============================================================
const ITSRules = (() => {
  const SEVERITIES = [
    { key: "mild",     suffix: "mi", label: "Mild" },
    { key: "standard", suffix: "st", label: "Standard" },
    { key: "severe",   suffix: "se", label: "Severe" }
  ];
  const MODES = {
    its:      { label: "ITS Standard rules", hint: "The ITS rulebook, kept up to date for you. Recommended." },
    its_plus: { label: "ITS Standard + our own rules", hint: "Everything in the ITS rulebook, plus extra rules you write for your league." },
    custom:   { label: "Only our own rules", hint: "Your league's own rulebook. You can start from a copy of the ITS Standard." }
  };
  const PENALTY_SUGGESTIONS = ["Warning", "Reprimand", "5s", "10s", "15s", "20s", "25s", "30s", "35s", "45s", "60s", "Drive-through", "Stop-go", "Grid drop", "Race ban", "DQ"];
  const LIMITS = { title: 80, who: 60, penalty: 40, description: 600, example: 400 };
  const LEAGUE_CODE = /^LR\d{1,3}$/;

  let standardPromise = null;
  function loadStandard() {
    if (!standardPromise) {
      standardPromise = fetch("./its_standard_rules.json", { cache: "no-cache" })
        .then(r => { if (!r.ok) throw new Error(`Couldn't load the ITS Standard rules (${r.status}).`); return r.json(); })
        .catch(e => { standardPromise = null; throw e; });
    }
    return standardPromise;
  }

  // Returns a list of problems with one rule ([] = good to go).
  function validateRule(rule) {
    const errs = [];
    if (!rule || typeof rule !== "object") return ["Rule is empty."];
    if (!String(rule.title || "").trim()) errs.push("Give the rule a title.");
    SEVERITIES.forEach(s => {
      const lv = (rule.levels || {})[s.key] || {};
      if (!String(lv.penalty || "").trim()) errs.push(`${s.label}: choose a penalty.`);
      if (!String(lv.description || "").trim()) errs.push(`${s.label}: describe what a ${s.label.toLowerCase()} offence looks like.`);
    });
    Object.entries(LIMITS).forEach(([f, max]) => {
      if (f === "title" || f === "who") { if (String(rule[f] || "").length > max) errs.push(`${f === "who" ? "“Applies to”" : "Title"} is too long (max ${max}).`); }
      else SEVERITIES.forEach(s => { if (String(((rule.levels || {})[s.key] || {})[f] || "").length > max) errs.push(`${s.label}: ${f} is too long (max ${max}).`); });
    });
    return errs;
  }

  // Tidy a rule for saving: trims everything, keeps only known fields.
  function cleanRule(rule) {
    const t = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
    const levels = {};
    SEVERITIES.forEach(s => {
      const lv = (rule.levels || {})[s.key] || {};
      levels[s.key] = { penalty: t(lv.penalty, LIMITS.penalty), description: t(lv.description, LIMITS.description), example: t(lv.example, LIMITS.example) };
    });
    return { group: t(rule.group, 12).toUpperCase(), title: t(rule.title, LIMITS.title), who: t(rule.who, LIMITS.who), levels };
  }

  function nextLeagueCode(rules, standard) {
    const taken = new Set([...(rules || []).map(r => String(r.group).toUpperCase()), ...((standard && standard.rules) || []).map(r => r.group.toUpperCase())]);
    for (let n = 1; n < 1000; n++) if (!taken.has("LR" + n)) return "LR" + n;
    return "LR" + Date.now();
  }

  async function loadLeagueConfig(leagueRef) {
    try {
      const snap = await leagueRef.collection("meta").doc("ticketRules").get();
      const d = snap.exists ? snap.data() : {};
      return { mode: MODES[d.mode] ? d.mode : "its", rules: Array.isArray(d.rules) ? d.rules : [], updatedAt: d.updatedAt || null, updatedBy: d.updatedBy || "", exists: snap.exists };
    } catch (e) {
      console.warn("ticketRules:", e);
      return { mode: "its", rules: [], exists: false, loadError: e };
    }
  }

  // The rules a league's stewards actually use.
  function resolve(standard, cfg) {
    const std = ((standard && standard.rules) || []).map(r => ({ ...r, source: "its" }));
    const own = (cfg.rules || []).filter(r => {
      const bad = validateRule(r);
      if (bad.length) console.warn(`Ignoring incomplete league rule ${r.group}:`, bad);
      return !bad.length;
    }).map(r => ({ ...r, source: "league" }));
    const list = cfg.mode === "custom" ? own : cfg.mode === "its_plus" ? [...std, ...own] : std;
    return { nfa: (standard && standard.nfa) || { code: "NFA", title: "No Further Action", description: "Incident reviewed, no further action required.", example: "" }, rules: list };
  }

  // IFWL steward_rules.json row format.
  function flatten(resolved) {
    const rows = [];
    const n = resolved.nfa;
    rows.push({ Code: "NFA", Group: "NFA", Title: n.title, Description: n.description, Example: n.example || "", Who: "N/A", Penalty: "None", Severity: "", Source: "its" });
    resolved.rules.forEach(r => SEVERITIES.forEach(s => {
      const lv = r.levels[s.key];
      rows.push({ Code: r.group + s.suffix, Group: r.group, Title: r.title, Description: lv.description, Example: lv.example || "", Who: r.who || "", Penalty: lv.penalty, Severity: s.key, Source: r.source });
    }));
    return rows;
  }

  // One call for the steward pages: league -> IFWL-format rows.
  async function loadForLeague(leagueRef) {
    const [standard, cfg] = await Promise.all([loadStandard(), loadLeagueConfig(leagueRef)]);
    return flatten(resolve(standard, cfg));
  }

  return { SEVERITIES, MODES, PENALTY_SUGGESTIONS, LIMITS, LEAGUE_CODE, loadStandard, validateRule, cleanRule, nextLeagueCode, loadLeagueConfig, resolve, flatten, loadForLeague };
})();
