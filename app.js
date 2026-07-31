/* ============================================================
   个人工作台 · Personal Workbench
   本地存储 + 模块联动 + 莫兰迪配色
   v2: 体重记录/预测 · 月经周期 · 热量差值 · 手机 App 布局
   ============================================================ */
(function () {
  "use strict";

  const STORE_KEY = "personalWorkbenchData_v1";

  let state = load();
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // 与 defaultState 合并，防止旧备份/部分导入缺少新字段时渲染报错
        return Object.assign(defaultState(), parsed);
      }
    } catch (e) {}
    return defaultState();
  }
  function save() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    schedulePush();
  }

  /* ---------- 云同步（跨设备共享，无需安装 App） ---------- */
  const SYNC_CFG_KEY = "wbSync_v1";
  const SYNC_LAST_KEY = "wbLastSync_v1";
  let syncCfg = loadSyncCfg();
  function loadSyncCfg() {
    try {
      return JSON.parse(localStorage.getItem(SYNC_CFG_KEY)) || { key: "", auto: false };
    } catch (e) {
      return { key: "", auto: false };
    }
  }
  function persistSyncCfg() {
    localStorage.setItem(SYNC_CFG_KEY, JSON.stringify(syncCfg));
  }
  function getLastSync() {
    return Number(localStorage.getItem(SYNC_LAST_KEY) || 0);
  }
  function setLastSync(t) {
    localStorage.setItem(SYNC_LAST_KEY, String(t));
  }
  let pushTimer = null;
  function schedulePush() {
    if (!syncCfg.auto || !syncCfg.key) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushSync().catch(() => {});
    }, 1000);
  }
  function syncUrl(key) {
    // 预览代理通常只把根路径 '/' 转发到沙箱端口，非根路径如 /sync 会被代理拦截。
    // 因此使用根路径 + ?__sync=1 触发同步，同时保留 x-cs-sandbox-id 等路由参数。
    const u = new URL(location.href);
    u.searchParams.set("__sync", "1");
    u.searchParams.set("key", key);
    return u.href;
  }
  /* ---------- GitHub 私有仓库云同步后端（纯静态站点可用，无需服务器） ---------- */
  const GH_API = "https://api.github.com";
  const GH_SYNC_REPO = "pw-sync-store";   // 自动创建的私有仓库名
  const GH_SYNC_FILE = "sync.json";
  function ghToken() { return localStorage.getItem("wbGhToken_v1") || ""; }
  function ghLogin() { return localStorage.getItem("wbGhLogin_v1") || ""; }
  function b64enc(str) {                     // UTF-8 安全 base64
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    bytes.forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin);
  }
  function b64dec(b64) {
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  async function ghApi(method, path, body) {
    const tk = ghToken();
    if (!tk) throw new Error("请先在上方填写 GitHub 私人令牌");
    let r;
    try {
      r = await fetch(GH_API + path, {
        method,
        headers: {
          "Authorization": "Bearer " + tk,
          "Content-Type": "application/json",
          "Accept": "application/vnd.github+json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new Error("网络请求失败：" + e.message);
    }
    if (r.status === 401) throw new Error("GitHub 令牌无效或权限不足（需 repo 权限）");
    if (r.status === 403) throw new Error("GitHub 限流，请稍后重试");
    if (r.status === 204) return null;
    if (!r.ok && !(r.status === 404 && method === "GET")) throw new Error("GitHub 错误(" + r.status + ")");
    return r.json();
  }
  async function ghLoginGet() {
    if (ghLogin()) return ghLogin();
    const u = await ghApi("GET", "/user");
    localStorage.setItem("wbGhLogin_v1", u.login);
    return u.login;
  }
  async function ghEnsureRepo(owner) {
    const r = await ghApi("GET", "/repos/" + owner + "/" + GH_SYNC_REPO);
    if (r) return;
    await ghApi("POST", "/user/repos", {
      name: GH_SYNC_REPO,
      private: true,
      description: "个人工作台云同步私有仓库",
      auto_init: false,
    });
  }
  async function ghReadAll() {
    const owner = await ghLoginGet();
    await ghEnsureRepo(owner);
    const r = await ghApi("GET", "/repos/" + owner + "/" + GH_SYNC_REPO + "/contents/" + GH_SYNC_FILE);
    if (!r) return { _meta: "personal-workbench-sync", slots: {} };
    try { return JSON.parse(b64dec(r.content)); } catch (e) { return { _meta: "personal-workbench-sync", slots: {} }; }
  }
  async function ghWriteAll(all) {
    const owner = await ghLoginGet();
    await ghEnsureRepo(owner);
    const content = b64enc(JSON.stringify(all));
    let sha = null;
    try {
      const cur = await ghApi("GET", "/repos/" + owner + "/" + GH_SYNC_REPO + "/contents/" + GH_SYNC_FILE);
      if (cur && cur.sha) sha = cur.sha;
    } catch (e) { /* 文件不存在则创建 */ }
    await ghApi("PUT", "/repos/" + owner + "/" + GH_SYNC_REPO + "/contents/" + GH_SYNC_FILE,
      { message: "sync", content, sha });
  }

  /* ---------- 原后端服务器同步（自托管 / 预览环境可用） ---------- */
  async function pushSyncServer() {
    if (!syncCfg.key) return false;
    const url = syncUrl(syncCfg.key);
    let r;
    try {
      r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
    } catch (e) {
      throw new Error("网络请求失败：" + e.message);
    }
    if (!r.ok) throw new Error("上传失败(" + r.status + ")");
    const j = await r.json();
    setLastSync(j.savedAt || Date.now());
    return true;
  }
  async function pullSyncServer(force) {
    if (!syncCfg.key) return false;
    const url = syncUrl(syncCfg.key);
    let r;
    try {
      r = await fetch(url);
    } catch (e) {
      throw new Error("网络请求失败：" + e.message);
    }
    if (r.status === 404) return false;
    if (!r.ok) throw new Error("下载失败(" + r.status + ")");
    const j = await r.json();
    if (!j.data) return false;
    if (!force && getLastSync() && j.savedAt && j.savedAt <= getLastSync()) return false;
    // 合并默认结构，防止云端旧数据缺少字段导致渲染报错
    state = Object.assign(defaultState(), j.data);
    save();
    setLastSync(j.savedAt || Date.now());
    renderCurrentView();
    return true;
  }

  /* ---------- 统一入口：有 GitHub 令牌走 Gist，否则走后端服务器 ---------- */
  async function pushSync() {
    if (ghToken()) {
      if (!syncCfg.key) syncCfg.key = "default";
      const all = await ghReadAll();
      all.slots = all.slots || {};
      all.slots[syncCfg.key] = { data: state, savedAt: Date.now() };
      await ghWriteAll(all);
      setLastSync(Date.now());
      return true;
    }
    return pushSyncServer();
  }
  async function pullSync(force) {
    if (ghToken()) {
      if (!syncCfg.key) syncCfg.key = "default";
      const all = await ghReadAll();
      const slot = all.slots && all.slots[syncCfg.key];
      if (!slot || !slot.data) return false;
      if (!force && getLastSync() && slot.savedAt && slot.savedAt <= getLastSync()) return false;
      // 合并默认结构，防止云端旧数据缺少字段导致渲染报错
      state = Object.assign(defaultState(), slot.data);
      save();
      setLastSync(slot.savedAt || Date.now());
      renderCurrentView();
      return true;
    }
    return pullSyncServer(force);
  }

  function openSyncModal() {
    modal.innerHTML = `
      <h3>☁ 云同步（GitHub）</h3>
      <p class="muted">数据存到你 GitHub 账号下的一个<strong>私有仓库 pw-sync-store</strong>（首次同步自动创建），手机和电脑用<strong>同一个令牌</strong>即可同步。令牌仅保存在本机浏览器，可随时在 GitHub 撤销。<br>获取令牌：github.com → 头像 → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token → <strong>勾选 repo</strong> → 30 天 → 复制填下面。</p>
      <label class="muted" style="display:block;margin:12px 0 4px;font-weight:600">GitHub 私人令牌</label>
      <input class="modal-input" id="s-token" type="password" value="${ghToken()}" placeholder="ghp_..." autocomplete="off" />
      <label class="muted" style="display:block;margin:12px 0 4px;font-weight:600">同步槽（可选，留空=default）</label>
      <input class="modal-input" id="s-key" type="text" value="${syncCfg.key && syncCfg.key !== "default" ? syncCfg.key : ""}" placeholder="default" />
      <label style="display:flex;align-items:center;gap:8px;margin:12px 0;font-size:13px;color:var(--ink-2)">
        <input type="checkbox" id="s-auto" ${syncCfg.auto ? "checked" : ""}/> 自动同步（改动后自动上传；打开网页时自动拉取）
      </label>
      <div id="s-status" class="muted" style="min-height:18px;margin-bottom:8px"></div>
      <div class="modal-actions">
        <button class="link-btn" id="s-close">关闭</button>
        <button class="ghost-btn" id="s-down">从云端下载</button>
        <button class="primary-btn" id="s-up">上传到云端</button>
      </div>`;
    mask.hidden = false;
    const st = () => $("#s-status");
    $("#s-close").onclick = closeModal;
    $("#s-token").addEventListener("input", () => {
      localStorage.setItem("wbGhToken_v1", $("#s-token").value.trim());
    });
    $("#s-key").addEventListener("input", () => {
      syncCfg.key = $("#s-key").value.trim() || "default";
      persistSyncCfg();
    });
    $("#s-auto").addEventListener("change", () => {
      syncCfg.auto = $("#s-auto").checked;
      persistSyncCfg();
    });
    $("#s-up").onclick = async () => {
      syncCfg.key = $("#s-key").value.trim() || "default";
      syncCfg.auto = $("#s-auto").checked;
      persistSyncCfg();
      localStorage.setItem("wbGhToken_v1", $("#s-token").value.trim());
      if (!ghToken()) { st().textContent = "请先填写 GitHub 私人令牌"; return; }
      st().textContent = "上传中…";
      try {
        await pushSync();
        st().textContent = "✅ 已上传到云端(GitHub 私有仓库)";
      } catch (e) { st().textContent = "❌ " + e.message; }
    };
    $("#s-down").onclick = async () => {
      syncCfg.key = $("#s-key").value.trim() || "default";
      syncCfg.auto = $("#s-auto").checked;
      persistSyncCfg();
      localStorage.setItem("wbGhToken_v1", $("#s-token").value.trim());
      if (!ghToken()) { st().textContent = "请先填写 GitHub 私人令牌"; return; }
      if (!confirm("从云端下载会覆盖本机当前数据，确定继续？")) return;
      st().textContent = "下载中…";
      try {
        const ok = await pullSync(true);
        st().textContent = ok ? "✅ 已下载并覆盖本机" : "云端暂无数据(该同步槽为空)";
      } catch (e) { st().textContent = "❌ " + e.message; }
    };
  }

  /* ---------- 工具 ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const pad = (n) => String(n).padStart(2, "0");

  function monthKey() {
    return $("#month-input").value;
  }
  function ym() {
    const [y, m] = monthKey().split("-").map(Number);
    return { y, m };
  }
  function daysInMonth() {
    const { y, m } = ym();
    return new Date(y, m, 0).getDate();
  }
  function firstOffset() {
    const { y, m } = ym();
    const jsDay = new Date(y, m - 1, 1).getDay();
    return (jsDay + 6) % 7; // 周一为首列
  }
  function todayKey() {
    const t = new Date();
    return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  }
  function parseDate(s) {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  }
  function diffDays(a, b) {
    return Math.round((parseDate(b) - parseDate(a)) / 86400000);
  }
  function addDays(s, n) {
    const t = parseDate(s) + n * 86400000;
    const dt = new Date(t);
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  }

  /* ---------- 热量着色 ---------- */
  function calClass(v) {
    if (v == null || v === "") return "";
    v = Number(v);
    if (isNaN(v)) return "";
    if (v < 1200) return "c-green";
    if (v < 1600) return "c-blue";
    if (v < 1800) return "c-orange";
    if (v <= 2500) return "c-red";
    return "c-darkred";
  }

  /* ---------- 心情 ---------- */
  const MOOD = {
    "-2": { t: "非常不开心", c: "m-2" },
    "-1": { t: "不开心", c: "m-1" },
    "0": { t: "一般", c: "m0" },
    "1": { t: "开心", c: "m1" },
    "2": { t: "非常开心", c: "m2" },
  };

  /* ---------- 工作忙碌度渐变 ---------- */
  function hexToRgb(h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function lerpColor(a, b, t) {
    const A = hexToRgb(a),
      B = hexToRgb(b);
    return `rgb(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(
      A[1] + (B[1] - A[1]) * t
    )},${Math.round(A[2] + (B[2] - A[2]) * t)})`;
  }
  function busyColor(v) {
    if (v == null || v === "") return "";
    const t = Math.max(0, Math.min(1, Number(v) / 100));
    return lerpColor("#E7DFD0", "#9B7FB0", t);
  }
  function busyLabel(v) {
    v = Number(v);
    if (v < 20) return "轻松";
    if (v < 40) return "适中";
    if (v < 60) return "较忙";
    if (v < 80) return "忙碌";
    return "非常忙碌";
  }
  /* 三档忙碌度分类与配色：不忙碌(0-49)绿 / 适中(50)蓝 / 忙碌(51-100)橘 */
  const LEVEL = {
    low: { label: "不忙碌", color: "#3FA34D" },
    mid: { label: "适中", color: "#3B82F6" },
    high: { label: "忙碌", color: "#E08A3C" },
  };
  function busyLevel(v) {
    v = Number(v);
    if (v == null || isNaN(v)) return null;
    if (v <= 49) return "low";
    if (v === 50) return "mid";
    return "high";
  }
  function levelColor(v) {
    const lv = busyLevel(v);
    return lv ? LEVEL[lv].color : "rgba(0,0,0,.06)";
  }

  /* ---------- 月经相位 ---------- */
  const PHASE = {
    menstrual: { label: "经期", color: "#E4A9B0", retention: 1.8 },
    follicular: { label: "卵泡期", color: "#C7D7C2", retention: 0 },
    ovulation: { label: "排卵期(微储水)", color: "#C9C2E0", retention: 0.6 },
    luteal: { label: "黄体期(经前储水)", color: "#E6B583", retention: 1.2 },
  };
  function phaseForDay(y, m, d) {
    const mn = state.menstrual;
    if (!mn || !mn.lastStart) return { phase: null, cycleDay: null, retention: 0, label: "未设置" };
    const cycleLen = Number(mn.cycleLen) || 28;
    const periodLen = Number(mn.periodLen) || 5;
    let dd = diffDays(mn.lastStart, `${y}-${pad(m)}-${pad(d)}`);
    dd = ((dd % cycleLen) + cycleLen) % cycleLen; // 0..cycleLen-1
    const cycleDay = dd + 1;
    let phase;
    if (cycleDay <= periodLen) phase = "menstrual";
    else if (cycleDay >= cycleLen - 16 && cycleDay <= cycleLen - 12) phase = "ovulation";
    else if (cycleDay > cycleLen - 12) phase = "luteal";
    else phase = "follicular";
    return { phase, cycleDay, retention: PHASE[phase].retention, label: PHASE[phase].label };
  }
  function nextPeriodKey() {
    const mn = state.menstrual;
    if (!mn || !mn.lastStart) return null;
    const cycleLen = Number(mn.cycleLen) || 28;
    let base = mn.lastStart;
    const cm = `${ym().y}-${pad(ym().m)}-01`;
    let guard = 0;
    while (diffDays(base, cm) > 0 && guard < 60) {
      base = addDays(base, cycleLen);
      guard++;
    }
    while (diffDays(todayKey(), base) <= 0 && guard < 60) {
      base = addDays(base, cycleLen);
      guard++;
    }
    return base;
  }
  // 真实"今天"所处的月经相位（与所查看的月份无关）
  function currentPhase() {
    const t = new Date();
    return phaseForDay(t.getFullYear(), t.getMonth() + 1, t.getDate());
  }

  /* ---------- 身体参数 / BMR / TDEE ---------- */
  function getWeightForBMR() {
    const { y, m } = ym();
    const wm = state.weight[monthKey()];
    if (wm) {
      const days = Object.keys(wm)
        .map(Number)
        .sort((a, b) => b - a);
      for (const d of days) if (wm[d] != null) return Number(wm[d]);
    }
    return Number(state.profile.target) || 55;
  }
  function computeBMR() {
    const p = state.profile;
    const w = getWeightForBMR();
    if (!p.age || !p.height) return null;
    const base = 10 * w + 6.25 * p.height - 5 * p.age;
    return p.gender === "男" ? base + 5 : base - 161;
  }
  function computeTDEE() {
    const bmr = computeBMR();
    if (bmr == null) return null;
    return bmr * (Number(state.profile.activity) || 1.375);
  }

  /* ---------- ensure ---------- */
  function ensureCal() {
    const k = monthKey();
    if (!state.calories[k]) state.calories[k] = { days: {}, notes: {} };
    return state.calories[k];
  }
  function ensureWeight() {
    const k = monthKey();
    if (!state.weight[k]) state.weight[k] = {};
    return state.weight[k];
  }
  function ensureExercise() {
    const k = monthKey();
    if (!state.exercise[k]) state.exercise[k] = {};
    return state.exercise[k];
  }
  function ensureMood() {
    const k = monthKey();
    if (!state.mood[k]) state.mood[k] = {};
    return state.mood[k];
  }
  function ensureWork() {
    const k = monthKey();
    if (!state.work[k])
      state.work[k] = {
        busy: {},
        ot: { days: "", hours: "", satDays: "", satHours: "", mixed: "" },
        summary: "",
      };
    return state.work[k];
  }
  function ensureMonthly() {
    const k = monthKey();
    if (!state.monthly[k])
      state.monthly[k] = {
        finance: { income: "", expense: "", note: "" },
        reading: { books: "", count: "", note: "" },
        exercise: { days: "", detail: "" },
        body: "",
        entertainment: "",
        review: "",
        thoughts: "",
        wNote: "",
        mNote: "",
        woNote: "",
      };
    return state.monthly[k];
  }

  /* ---------- 弹层 ---------- */
  const mask = $("#modal-mask");
  const modal = $("#modal");
  function closeModal() {
    mask.hidden = true;
    modal.innerHTML = "";
  }
  mask.addEventListener("click", (e) => {
    if (e.target === mask) closeModal();
  });

  /* ============================================================
     1) 体重管理（含体重预测 / 月经 / 热量差值）
     ============================================================ */
  function renderWeight() {
    const cal = ensureCal();
    const wt = ensureWeight();
    const ex = ensureExercise();
    const total = daysInMonth();
    const tdee = computeTDEE();

    /* —— 身体参数 + 月经相位卡 —— */
    const curPhase = currentPhase();
    const np = nextPeriodKey();
    const daysToNext = np ? diffDays(todayKey(), np) : null;
    const latestW = getLatestWeightInMonth();
    $("#profile-stats").innerHTML = [
      ["基础代谢 BMR", computeBMR() ? Math.round(computeBMR()) : "—", "大卡"],
      ["每日消耗 TDEE", tdee ? Math.round(tdee) : "—", "大卡"],
      ["目标体重", state.profile.target || "—", "kg"],
      ["最新体重", latestW ? latestW.toFixed(1) : "—", "kg"],
      ["当前相位", state.menstrual.lastStart ? curPhase.label : "未设置", ""],
      ["距下次经期", daysToNext != null ? daysToNext : "—", "天"],
    ]
      .map(
        ([k, n, u]) =>
          `<div class="stat"><div class="k">${k}</div><div class="n">${n}<span class="u">${u}</span></div></div>`
      )
      .join("");

    if (!state.menstrual.lastStart) {
      $("#phase-msg").textContent = "尚未设置月经周期，点击右上「月经设置」。";
      $("#phase-msg").style.display = "block";
      $("#phase-strip").style.display = "none";
      $("#phase-legend").style.display = "none";
    } else {
      $("#phase-msg").style.display = "none";
      $("#phase-strip").style.display = "grid";
      $("#phase-legend").style.display = "flex";
      let html = "";
      const off = firstOffset();
      for (let i = 0; i < off; i++) html += `<div class="pseg"></div>`;
      for (let d = 1; d <= total; d++) {
        const ph = phaseForDay(ym().y, ym().m, d);
        html += `<div class="pseg" style="background:${PHASE[ph.phase].color}" title="${d}日 ${ph.label}"></div>`;
      }
      $("#phase-strip").innerHTML = html;
      $("#phase-legend").innerHTML = Object.keys(PHASE)
        .map((k) => `<span class="lg"><span class="dot" style="background:${PHASE[k].color}"></span>${PHASE[k].label}</span>`)
        .join("");
    }

    /* —— 热量热力表 —— */
    $("#weight-legend").innerHTML = [
      ["<1200 大卡", "var(--c-green)"],
      ["1200–1600", "var(--c-blue)"],
      ["1600–1800", "var(--c-orange)"],
      [">1800（正红）", "var(--c-red)"],
      [">2500（深红）", "var(--c-darkred)"],
    ]
      .map(([t, c]) => `<span class="lg"><span class="dot" style="background:${c}"></span>${t}</span>`)
      .join("");

    const hm = $("#weight-heatmap");
    let html = "";
    const off = firstOffset();
    for (let i = 0; i < off; i++) html += `<div></div>`;
    for (let d = 1; d <= total; d++) {
      const v = cal.days[d];
      const w = wt[d];
      const cls = calClass(v);
      const valTxt = v == null ? "—" : Number(v);
      html += `<div class="hcell ${cls}" data-day="${d}">
        <span class="d">${d}</span>
        <span class="v ${v == null ? "" : "vsmall"}">${valTxt}</span>
        ${w != null ? `<span class="sub">${Number(w).toFixed(1)}kg</span>` : ""}
      </div>`;
    }
    hm.innerHTML = html;
    $$(".hcell", hm).forEach((cell) => {
      if (!cell.dataset.day) return;
      cell.addEventListener("click", () => openWeightModal(Number(cell.dataset.day)));
    });

    /* —— 热量 + 差值统计 —— */
    const calVals = Object.values(cal.days).filter((x) => x != null).map(Number);
    const avg = calVals.length ? Math.round(calVals.reduce((a, b) => a + b, 0) / calVals.length) : 0;
    const over = calVals.filter((v) => v > 1800).length;
    const low = calVals.filter((v) => v < 1200).length;
    // 热量差值累计
    let cumDef = 0,
      defDays = 0;
    for (let d = 1; d <= total; d++) {
      if (cal.days[d] != null && tdee != null) {
        const exK = ex[d] ? Number(ex[d]) : 0;
        cumDef += Number(cal.days[d]) - tdee - exK;
        defDays++;
      }
    }
    const fatKg = defDays ? -(cumDef / 7700) : 0; // 负差值=减脂
    $("#weight-stats").innerHTML = [
      ["录入天数", calVals.length, "天"],
      ["平均热量", avg, "大卡"],
      ["超标天数 (>1800)", over, "天"],
      ["低热量天数 (<1200)", low, "天"],
      ["日均热量差值", tdee ? Math.round(cumDef / defDays) : "—", "大卡"],
      ["累计热量差值", tdee ? Math.round(cumDef) : "—", "大卡"],
      ["预计减脂", defDays ? fatKg.toFixed(2) : "—", "kg"],
    ]
      .map(
        ([k, n, u]) =>
          `<div class="stat"><div class="k">${k}</div><div class="n">${n}<span class="u">${u}</span></div></div>`
      )
      .join("");

    /* —— 超标诱因表 —— */
    const tb = $("#weight-over-table tbody");
    const overRows = [];
    for (let d = 1; d <= total; d++)
      if (cal.days[d] != null && Number(cal.days[d]) > 1800)
        overRows.push([d, Number(cal.days[d]), cal.notes[d] || ""]);
    tb.innerHTML = overRows.length
      ? overRows
          .map(([d, v, note]) => {
            const cls = calClass(v);
            const colorVar =
              cls === "c-red" ? "var(--c-red)" : cls === "c-darkred" ? "var(--c-darkred)" : "var(--c-orange)";
            return `<tr><td>${monthKey()}-${pad(d)}</td><td><span class="pill" style="background:${colorVar};color:#fff">${v}</span></td><td>${
              note || '<span style="color:var(--ink-3)">（未填诱因）</span>'
            }</td></tr>`;
          })
          .join("")
      : `<tr class="empty-row"><td colspan="3">本月暂无热量超标（&gt;1800）记录 🎉</td></tr>`;

    /* —— 低热量诱因表 —— */
    const utb = $("#weight-under-table tbody");
    const underRows = [];
    for (let d = 1; d <= total; d++)
      if (cal.days[d] != null && Number(cal.days[d]) < 1200)
        underRows.push([d, Number(cal.days[d]), cal.notes[d] || ""]);
    utb.innerHTML = underRows.length
      ? underRows
          .map(([d, v, note]) => {
            const cls = calClass(v);
            const colorVar = cls === "c-green" ? "var(--c-green)" : "var(--c-blue)";
            return `<tr><td>${monthKey()}-${pad(d)}</td><td><span class="pill" style="background:${colorVar};color:#fff">${v}</span></td><td>${
              note || '<span style="color:var(--ink-3)">（未填诱因）</span>'
            }</td></tr>`;
          })
          .join("")
      : `<tr class="empty-row"><td colspan="3">本月暂无低热量（&lt;1200）记录</td></tr>`;

    /* —— 热量失控预警 —— */
    renderCalorieAlert(cal, total);

    /* —— 体重表 + 图表 + 分析 —— */
    renderWeightTableAndChart(cal, wt, ex, total, tdee);
    renderWeightAnalysis(wt, total, tdee);
  }

  function getLatestWeightInMonth() {
    const wt = state.weight[monthKey()];
    if (!wt) return null;
    const days = Object.keys(wt).map(Number).sort((a, b) => b - a);
    for (const d of days) if (wt[d] != null) return Number(wt[d]);
    return null;
  }

  let weightChart;
  function renderWeightTableAndChart(cal, wt, ex, total, tdee) {
    const { y, m } = ym();
    const pts = [];
    for (let d = 1; d <= total; d++) if (wt[d] != null) pts.push([d, Number(wt[d])]);

    // 表格
    const tb = $("#weight-table tbody");
    const rows = [];
    for (let d = 1; d <= total; d++) {
      if (wt[d] != null) {
        const ph = phaseForDay(y, m, d);
        let diff = "—";
        if (cal.days[d] != null && tdee != null)
          diff = Math.round(Number(cal.days[d]) - tdee - (ex[d] ? Number(ex[d]) : 0));
        rows.push(
          `<tr><td>${monthKey()}-${pad(d)}</td><td>${Number(wt[d]).toFixed(1)}</td><td>${
            diff === "—" ? diff : (diff > 0 ? "+" : "") + diff
          }</td><td>${ph.phase ? ph.label : "—"}</td></tr>`
        );
      }
    }
    tb.innerHTML = rows.length
      ? rows.join("")
      : `<tr class="empty-row"><td colspan="4">本月暂无体重记录</td></tr>`;

    // 预测：线性回归
    const actual = new Array(total).fill(null);
    const adjusted = new Array(total).fill(null);
    const predicted = new Array(total).fill(null);
    pts.forEach(([d, w]) => {
      actual[d - 1] = w;
      const ph = phaseForDay(y, m, d);
      adjusted[d - 1] = +(w - ph.retention).toFixed(2);
    });
    if (pts.length >= 2) {
      const n = pts.length;
      const sx = pts.reduce((a, p) => a + p[0], 0);
      const sy = pts.reduce((a, p) => a + p[1], 0);
      const sxx = pts.reduce((a, p) => a + p[0] * p[0], 0);
      const sxy = pts.reduce((a, p) => a + p[0] * p[1], 0);
      const b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
      const a = (sy - b * sx) / n;
      const lastDay = pts[pts.length - 1][0];
      predicted[lastDay - 1] = pts[pts.length - 1][1];
      for (let d = lastDay + 1; d <= total; d++) {
        const ph = phaseForDay(y, m, d);
        predicted[d - 1] = +(a + b * d + ph.retention).toFixed(2);
      }
    }

    const pointColors = new Array(total).fill("#B6A6D6");
    for (let d = 1; d <= total; d++) {
      const ph = phaseForDay(y, m, d);
      if (ph.phase) pointColors[d - 1] = PHASE[ph.phase].color;
    }

    const labels = [];
    for (let d = 1; d <= total; d++) labels.push(d);

    if (weightChart) weightChart.destroy();
    if (typeof Chart === "undefined") return;
    weightChart = new Chart($("#weight-chart"), {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "记录体重",
            data: actual,
            borderColor: "#9B7FB0",
            backgroundColor: "rgba(155,127,176,.12)",
            fill: false,
            tension: 0.3,
            pointRadius: 4,
            pointBackgroundColor: pointColors,
            spanGaps: true,
          },
          {
            label: "去水后(真实减脂)",
            data: adjusted,
            borderColor: "#7FA8B0",
            borderDash: [6, 4],
            fill: false,
            tension: 0.3,
            pointRadius: 0,
            spanGaps: true,
          },
          {
            label: "预测(含储水)",
            data: predicted,
            borderColor: "#B0A89A",
            borderDash: [3, 3],
            fill: false,
            tension: 0.3,
            pointRadius: 0,
            spanGaps: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { title: { display: true, text: "kg" } } },
        plugins: { legend: { display: true, labels: { boxWidth: 12, font: { size: 11 } } } },
      },
    });
  }

  /* —— 热量即将失控预警 —— */
  function renderCalorieAlert(cal, total) {
    const card = $("#calorie-alert-card");
    const box = $("#calorie-alert");
    const days = [];
    for (let d = 1; d <= total; d++) if (cal.days[d] != null) days.push([d, Number(cal.days[d])]);
    if (!days.length) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    const { y, m } = ym();
    const today = Number(todayKey().split("-")[2]);
    const warnings = [];

    const [ld, lv] = days[days.length - 1];
    if (lv > 1800)
      warnings.push({ lv: 4, msg: `🚨 最近记录日(${monthKey()}-${pad(ld)}) 热量 ${lv} 大卡已超标，建议后续 2–3 天回调到 1200–1600 区间。` });
    else if (lv >= 1600)
      warnings.push({ lv: 3, msg: `⚠️ 最近记录日(${monthKey()}-${pad(ld)}) 热量 ${lv} 大卡，已进入橙色临界区，距超标线(1800)仅 ${1800 - lv} 大卡，注意控制。` });

    const recent = days.slice(-7).map((x) => x[1]);
    if (recent.length >= 3) {
      const avg7 = Math.round(recent.reduce((a, b) => a + b, 0) / recent.length);
      if (avg7 > 1600)
        warnings.push({ lv: 3, msg: `⚠️ 近 ${recent.length} 次记录平均 ${avg7} 大卡，已高于 1600 临界线，热量持续偏高，有失控趋势。` });
    }

    let maxRun = 0, run = 0;
    for (let d = 1; d <= total; d++) {
      if (cal.days[d] != null && Number(cal.days[d]) < 1200) {
        run++;
        if (run > maxRun) maxRun = run;
      } else run = 0;
    }
    if (maxRun >= 3)
      warnings.push({ lv: 2, msg: `⚠️ 已连续 ${maxRun} 天低热量(&lt;1200)，身体可能进入"节能模式"，谨防后续暴食反弹，建议回归 1200–1600 区间。` });

    // 联动心情/工作：若最近记录日心情差或忙碌高，点明诱因
    const moodDay = state.mood[monthKey()];
    const workDay = (state.work[monthKey()] || {}).busy;
    const lvMood = moodDay ? moodDay[ld] : undefined;
    const lvBusy = workDay ? workDay[ld] : undefined;
    if (warnings.length && (lvMood != null || lvBusy != null)) {
      const parts = [];
      if (lvMood != null) parts.push(`心情指数 ${lvMood}`);
      if (lvBusy != null) parts.push(`忙碌度 ${lvBusy}`);
      if (lvMood != null && lvMood <= -1)
        warnings.push({ lv: 3, msg: `💡 预警日(${monthKey()}-${pad(ld)}) 当天${parts.join("、")}——负面情绪易诱发情绪性进食，请提前安排替代解压方式。` });
      else if (lvBusy != null && lvBusy >= 80)
        warnings.push({ lv: 3, msg: `💡 预警日(${monthKey()}-${pad(ld)}) 当天${parts.join("、")}——高压忙碌常伴随漏餐或外卖超标，注意备餐。` });
    }

    if (!warnings.length) {
      box.className = "cal-alert cal-ok";
      box.innerHTML = `✅ 当前热量平稳，最近 ${days.length} 条记录均在安全区间，无超标或失控风险。`;
    } else {
      warnings.sort((a, b) => b.lv - a.lv);
      box.className = "cal-alert cal-warn";
      box.innerHTML = warnings.map((w) => `<div class="cal-warn-item">${w.msg}</div>`).join("");
    }
  }

  function renderWeightAnalysis(wt, total, tdee) {
    const { y, m } = ym();
    const cal = state.calories[monthKey()] || { days: {}, notes: {} };
    const mood = state.mood[monthKey()] || {};
    const work = (state.work[monthKey()] || {}).busy || {};
    const pts = [];
    for (let d = 1; d <= total; d++) if (wt[d] != null) pts.push([d, Number(wt[d])]);
    const box = $("#weight-analysis");
    let html = "";
    let note = "";
    if (pts.length < 2) {
      html = `<p class="muted">体重记录满 2 天后，这里会生成趋势与预测分析。</p>`;
    } else {
    const first = pts[0],
      last = pts[pts.length - 1];
    const change = last[1] - first[1];
    // 去水趋势斜率(kg/月)
    const n = pts.length;
    const sx = pts.reduce((a, p) => a + p[0], 0);
    const sy = pts.reduce((a, p) => a + p[1], 0);
    const sxx = pts.reduce((a, p) => a + p[0] * p[0], 0);
    const sxy = pts.reduce((a, p) => a + p[0] * p[1], 0);
    const b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const a = (sy - b * sx) / n;
    const slopeMonth = b * 30;

    const np = nextPeriodKey();
    const phNow = currentPhase();

    html = `<div class="stat-grid" style="margin-bottom:14px">
      <div class="stat"><div class="k">体重变化(记录期)</div><div class="n">${
        change > 0 ? "+" : ""
      }${change.toFixed(1)}<span class="u">kg</span></div></div>
      <div class="stat"><div class="k">去水趋势</div><div class="n">${slopeMonth > 0 ? "+" : ""}${slopeMonth.toFixed(
      2
    )}<span class="u">kg/月</span></div></div>
      <div class="stat"><div class="k">当前相位</div><div class="n">${
        state.menstrual.lastStart ? phNow.label : "未设置"
      }</div></div>
      <div class="stat"><div class="k">距下次经期</div><div class="n">${
        np ? diffDays(todayKey(), np) : "—"
      }<span class="u">天</span></div></div>
    </div>`;

    note = "";
    if (state.menstrual.lastStart) {
      note = `<p class="muted" style="line-height:1.8">
        💡 <b>经期 / 经前储水：</b>黄体期（排卵后）雌激素下降、孕激素上升，身体容易<strong>储水 1–2kg</strong>，
        经期开始后随激素回落逐渐排出。因此经期前后体重上涨<strong>多是水分而非脂肪</strong>，请勿恐慌或误判减脂效果。<br>
        💡 <b>排卵期：</b>约在周期第 14 天前后雌激素达峰值，部分人会伴随<strong>轻微储水 / 腹胀</strong>（约 0.3–0.6kg），体重可能小幅上扬；图表中"去水线"已扣除这部分，仍可作为观察真实减脂的窗口。<br>
        💡 <b>怎么看：</b>图表中<strong>虚线（去水后体重）</strong>剔除了储水，更贴近真实脂肪变化；
        实线受激素波动影响会"假涨"。若去水线持续下行，说明减脂有效。<br>`;
      if (np) {
        const predWater = +(a + b * Number(np.split("-")[2])).toFixed(1);
        note += `📅 预计至下次经期（${np}），按当前趋势去水体重约 <strong>${predWater}kg</strong>；
          若当时处于经期/经前，称重组读数可能因储水再高约 1–2kg。`;
      }
    } else {
      note = `<p class="muted">设置月经周期后，这里会结合排卵期与经期储水给出更精准的体重解读与预测。</p>`;
    }
    }
    box.innerHTML = html + note + buildReasonAnalysis(cal, mood, work);
  }

  /* —— 热量原因深挖：超标 + 低热量双线分析，并联动心情/工作 —— */
  function buildReasonAnalysis(cal, mood, work) {
    const notes = cal.notes || {};
    const days = cal.days || {};
    const overList = [],
      lowList = [];
    Object.keys(days).forEach((d) => {
      const v = Number(days[d]);
      if (isNaN(v)) return;
      const n = notes[d] || "";
      if (v > 1800) overList.push([Number(d), v, n, mood[d], work[d]]);
      else if (v < 1200) lowList.push([Number(d), v, n, mood[d], work[d]]);
    });
    overList.sort((a, b) => a[0] - b[0]);
    lowList.sort((a, b) => a[0] - b[0]);
    if (!overList.length && !lowList.length)
      return `<div class="reason-block muted" style="margin-top:16px">📝 在有备注的超标日(&gt;1800)或低热量日(&lt;1200)录入「诱因」后，这里会结合<strong>心情 / 工作忙碌度</strong>帮你分析饮食失控与节食模式。</div>`;

    const avgMood = (arr) => {
      const vals = arr.map((x) => x[3]).filter((x) => x != null).map(Number);
      return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : null;
    };
    const avgBusy = (arr) => {
      const vals = arr.map((x) => x[4]).filter((x) => x != null).map(Number);
      return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    };
    const moodTxt = (v) => (v == null ? "—" : v <= -1 ? "偏低(易焦虑)" : v >= 1 ? "偏高" : "中性");
    const busyTxt = (v) => (v == null ? "—" : v >= 80 ? "很高" : v >= 60 ? "偏高" : "一般");

    let html = `<div class="reason-block" style="margin-top:18px">
      <h3 style="font-size:15px;margin-bottom:10px">🔍 热量原因深挖（超标 &amp; 低热量）</h3>`;

    if (overList.length) {
      const am = avgMood(overList),
        ab = avgBusy(overList);
      html += `<div class="reason-sub"><b>超标日（${overList.length} 天 &gt;1800）</b><span class="reason-meta">平均心情 ${am == null ? "—" : moodTxt(am)} · 平均忙碌度 ${ab == null ? "—" : busyTxt(ab)}</span></div>
        <ul class="reason-list">` +
        overList
          .map(
            ([d, v, n, mv, bv]) =>
              `<li><span class="pill" style="background:var(--c-red);color:#fff">${v}</span> ${monthKey()}-${pad(d)}：${
                n || '<span class="muted">（未填诱因）</span>'
              } <span class="reason-tag">心情 ${mv == null ? "—" : mv} / 忙碌 ${bv == null ? "—" : bv}</span></li>`
          )
          .join("") +
        `</ul>`;
      const txt = overList.map((x) => x[2]).join(" ");
      const tips = [];
      if (/聚餐|宴|饭局|聚会|喝酒|酒/.test(txt)) tips.push("社交聚餐是主要超标来源，可提前规划「先吃菜、少喝酒、七分饱」。");
      if (/情绪|压力|焦虑|心情|emo|烦/.test(txt)) tips.push("情绪性进食明显，建议用散步/倾诉/音乐替代进食。");
      if (/外卖|宵夜|熬夜|夜|炸|奶茶/.test(txt)) tips.push("外卖/宵夜偏多，注意睡前 3 小时不再进食、少点高油高糖。");
      if (am != null && Number(am) <= -1) tips.push("超标日心情普遍偏低，负面情绪是重要诱因，需先照顾情绪再谈控制饮食。");
      if (ab != null && Number(ab) >= 80) tips.push("超标日忙碌度普遍很高，高压下更依赖外卖/快餐，建议周末提前备餐。");
      if (tips.length) html += `<p class="reason-tip">💡 ${tips.join(" ")}</p>`;
    }

    if (lowList.length) {
      const am = avgMood(lowList),
        ab = avgBusy(lowList);
      html += `<div class="reason-sub"><b>低热量日（${lowList.length} 天 &lt;1200）</b><span class="reason-meta">平均心情 ${am == null ? "—" : moodTxt(am)} · 平均忙碌度 ${ab == null ? "—" : busyTxt(ab)}</span></div>
        <ul class="reason-list">` +
        lowList
          .map(
            ([d, v, n, mv, bv]) =>
              `<li><span class="pill" style="background:var(--c-green);color:#fff">${v}</span> ${monthKey()}-${pad(d)}：${
                n || '<span class="muted">（未填诱因）</span>'
              } <span class="reason-tag">心情 ${mv == null ? "—" : mv} / 忙碌 ${bv == null ? "—" : bv}</span></li>`
          )
          .join("") +
        `</ul>`;
      const txt = lowList.map((x) => x[2]).join(" ");
      const tips = [];
      if (/忙|加班|忘记|没空|赶|会议|出差/.test(txt)) tips.push("多因忙碌漏餐，建议工位常备便携加餐（坚果/酸奶/香蕉）避免断食过久。");
      if (/病|不舒服|肠胃|没胃口|生理期|痛经/.test(txt)) tips.push("因身体不适低热量，康复后请循序渐进恢复饮食，勿骤然暴饮暴食。");
      if (/节食|减肥|控制|断食|水煮/.test(txt)) tips.push("主动节食偏多，长期过低热量会降低代谢、诱发反弹，建议回到 1200–1600 区间。");
      if (am != null && Number(am) <= -1) tips.push("低热量日心情也偏低，可能是情绪低落导致食欲不振，请关注心理状态。");
      if (ab != null && Number(ab) >= 80) tips.push("低热量日忙碌度很高，是「忙到没空吃」而非主动节制，需把吃饭排进日程。");
      if (tips.length) html += `<p class="reason-tip">💡 ${tips.join(" ")}</p>`;
      html += `<p class="reason-warn">⚠️ 连续低热量易触发身体"节能模式"与后续暴食反弹，请关注整体趋势而非单日数字。</p>`;
    }

    // 综合联动结论
    const oa = avgMood(overList),
      ob = avgBusy(overList),
      la = avgMood(lowList),
      lb = avgBusy(lowList);
    let corr = "";
    if (oa != null && oa <= -1) corr += "超标更多发生在心情偏低时；";
    if (ob != null && ob >= 80) corr += "超标更多发生在忙碌度很高时；";
    if (la != null && la <= -1) corr += "低热量更多伴随心情偏低（可能食欲不振）；";
    if (lb != null && lb >= 80) corr += "低热量更多因忙碌漏餐；";
    if (corr) html += `<p class="reason-summary">🧩 联动结论：${corr} 调理饮食前，先留意当天的情绪与工作安排。</p>`;

    html += `</div>`;
    return html;
  }

  function openWeightModal(day) {
    const cal = ensureCal();
    const wt = ensureWeight();
    const ex = ensureExercise();
    const curC = cal.days[day] != null ? cal.days[day] : "";
    const curW = wt[day] != null ? wt[day] : "";
    const curE = ex[day] != null ? ex[day] : "";
    const note = cal.notes[day] || "";
    modal.innerHTML = `
      <h3>${monthKey()}-${pad(day)} · 记录</h3>
      <p class="muted">热量来自薄荷健康；体重/运动消耗用于差值与预测</p>
      <label class="muted" style="display:block;margin:10px 0 4px;font-weight:600">热量（大卡）</label>
      <input class="modal-input" id="m-cal" type="number" min="0" step="10" value="${curC}" placeholder="例如 1520" />
      <label class="muted" style="display:block;margin:10px 0 4px;font-weight:600">体重（kg）</label>
      <input class="modal-input" id="m-wt" type="number" min="0" step="0.1" value="${curW}" placeholder="例如 55.2" />
      <label class="muted" style="display:block;margin:10px 0 4px;font-weight:600">运动消耗（大卡）</label>
      <input class="modal-input" id="m-ex" type="number" min="0" step="10" value="${curE}" placeholder="例如 200" />
      <label class="muted" style="display:block;margin:10px 0 4px;font-weight:600">备注 / 诱因（超标或低热量原因）</label>
      <textarea id="m-note" placeholder="超标原因：聚餐 / 情绪性进食……  或  低热量原因：忙碌漏餐 / 身体不适……">${note}</textarea>
      <div class="modal-actions">
        <button class="link-btn" id="m-del">清除</button>
        <button class="primary-btn" id="m-save">保存</button>
      </div>`;
    mask.hidden = false;
    $("#m-cal").focus();
    $("#m-save").onclick = () => {
      const c = $("#m-cal").value,
        w = $("#m-wt").value,
        e = $("#m-ex").value;
      cal.days[day] = c === "" ? undefined : Number(c);
      wt[day] = w === "" ? undefined : Number(w);
      ex[day] = e === "" ? undefined : Number(e);
      cal.notes[day] = $("#m-note").value.trim();
      if (cal.days[day] == null) delete cal.notes[day];
      save();
      closeModal();
      renderWeight();
    };
    $("#m-del").onclick = () => {
      delete cal.days[day];
      delete wt[day];
      delete ex[day];
      delete cal.notes[day];
      save();
      closeModal();
      renderWeight();
    };
  }

  function openProfileModal() {
    const p = state.profile;
    modal.innerHTML = `
      <h3>身体参数</h3>
      <p class="muted">用于估算基础代谢(BMR)与每日消耗(TDEE)</p>
      <div class="mp-grid">
        <div class="field"><label>性别</label>
          <select id="p-gender" class="modal-input">
            <option ${p.gender === "女" ? "selected" : ""}>女</option>
            <option ${p.gender === "男" ? "selected" : ""}>男</option>
          </select></div>
        <div class="field"><label>年龄</label><input id="p-age" class="modal-input" type="number" value="${
          p.age || ""
        }" /></div>
        <div class="field"><label>身高(cm)</label><input id="p-height" class="modal-input" type="number" value="${
          p.height || ""
        }" /></div>
        <div class="field"><label>目标体重(kg)</label><input id="p-target" class="modal-input" type="number" step="0.1" value="${
          p.target || ""
        }" /></div>
      </div>
      <div class="field" style="margin-top:12px"><label>活动系数</label>
        <select id="p-activity" class="modal-input">
          ${[
            [1.2, "久坐(很少运动)"],
            [1.375, "轻度(每周1-3次)"],
            [1.55, "中度(每周3-5次)"],
            [1.725, "高度(每周6-7次)"],
            [1.9, "极高(体力劳动/运动员)"],
          ]
            .map(([v, t]) => `<option value="${v}" ${Number(p.activity) === v ? "selected" : ""}>${t}</option>`)
            .join("")}
        </select></div>
      <div class="modal-actions">
        <button class="link-btn" id="p-cancel">取消</button>
        <button class="primary-btn" id="p-save">保存</button>
      </div>`;
    mask.hidden = false;
    $("#p-save").onclick = () => {
      state.profile = {
        gender: $("#p-gender").value,
        age: Number($("#p-age").value) || 0,
        height: Number($("#p-height").value) || 0,
        activity: Number($("#p-activity").value),
        target: Number($("#p-target").value) || 0,
      };
      save();
      closeModal();
      renderWeight();
    };
    $("#p-cancel").onclick = closeModal;
  }

  function openMenstrualModal() {
    const mn = state.menstrual;
    modal.innerHTML = `
      <h3>月经周期设置</h3>
      <p class="muted">用于计算相位、储水与体重预测</p>
      <label class="muted" style="display:block;margin:10px 0 4px;font-weight:600">末次经期第一天</label>
      <input class="modal-input" id="mn-start" type="date" value="${mn.lastStart || ""}" />
      <div class="mp-grid" style="margin-top:12px">
        <div class="field"><label>周期长度(天)</label><input id="mn-cycle" class="modal-input" type="number" value="${
          mn.cycleLen || 28
        }" /></div>
        <div class="field"><label>经期长度(天)</label><input id="mn-plen" class="modal-input" type="number" value="${
          mn.periodLen || 5
        }" /></div>
      </div>
      <div class="modal-actions">
        <button class="link-btn" id="mn-cancel">取消</button>
        <button class="primary-btn" id="mn-save">保存</button>
      </div>`;
    mask.hidden = false;
    $("#mn-save").onclick = () => {
      state.menstrual = {
        lastStart: $("#mn-start").value,
        cycleLen: Number($("#mn-cycle").value) || 28,
        periodLen: Number($("#mn-plen").value) || 5,
      };
      save();
      closeModal();
      renderWeight();
    };
    $("#mn-cancel").onclick = closeModal;
  }

  /* ============================================================
     2) 每日心情（不变）
     ============================================================ */
  function renderMood() {
    const data = ensureMood();
    const total = daysInMonth();
    $("#mood-legend").innerHTML = Object.keys(MOOD)
      .map((k) => `<span class="lg"><span class="dot" style="background:var(--${MOOD[k].c})"></span>${MOOD[k].t} (${k})</span>`)
      .join("");
    const hm = $("#mood-heatmap");
    let html = "";
    const off = firstOffset();
    for (let i = 0; i < off; i++) html += `<div></div>`;
    for (let d = 1; d <= total; d++) {
      const v = data[d];
      const cls = v != null ? MOOD[String(v)].c : "";
      html += `<div class="hcell ${cls}" data-day="${d}">
        <span class="d">${d}</span>
        <span class="v ${v == null ? "" : "vsmall"}">${v == null ? "—" : v}</span>
      </div>`;
    }
    hm.innerHTML = html;
    $$(".hcell", hm).forEach((cell) => {
      if (!cell.dataset.day) return;
      cell.addEventListener("click", () => openMoodModal(Number(cell.dataset.day)));
    });
    const vals = Object.values(data).filter((x) => x != null);
    const logged = vals.length;
    const avg = logged ? (vals.reduce((a, b) => a + Number(b), 0) / logged).toFixed(2) : "—";
    const dist = { "-2": 0, "-1": 0, "0": 0, "1": 0, "2": 0 };
    vals.forEach((v) => dist[String(v)]++);
    $("#mood-stats").innerHTML = [
      ["录入天数", logged, "天"],
      ["平均心情", avg, ""],
      ["开心天数 (≥1)", dist["1"] + dist["2"], "天"],
      ["低落天数 (≤-1)", dist["-1"] + dist["-2"], "天"],
      ["非常开心 (2)", dist["2"], "天"],
      ["非常不开心 (-2)", dist["-2"], "天"],
    ]
      .map(([k, n, u]) => `<div class="stat"><div class="k">${k}</div><div class="n">${n}<span class="u">${u}</span></div></div>`)
      .join("");
    drawMoodChart(data, total);
  }
  function openMoodModal(day) {
    const data = ensureMood();
    const cur = data[day] != null ? String(data[day]) : null;
    modal.innerHTML = `
      <h3>${monthKey()}-${pad(day)} · 心情</h3>
      <p class="muted">从「非常不开心 -2」到「非常开心 2」</p>
      <div class="mood-pick" id="m-pick">
        ${Object.keys(MOOD)
          .map(
            (k) =>
              `<div class="mood-opt ${k === cur ? "sel" : ""}" data-v="${k}" style="background:var(--${MOOD[k].c})">${MOOD[k].t}<br><b>${k}</b></div>`
          )
          .join("")}
      </div>
      <div class="modal-actions">
        <button class="link-btn" id="m-del">清除</button>
        <button class="primary-btn" id="m-save">保存</button>
      </div>`;
    mask.hidden = false;
    let pick = cur;
    $$("#m-pick .mood-opt").forEach((o) => {
      o.onclick = () => {
        $$("#m-pick .mood-opt").forEach((x) => x.classList.remove("sel"));
        o.classList.add("sel");
        pick = o.dataset.v;
      };
    });
    $("#m-save").onclick = () => {
      if (pick == null) delete data[day];
      else data[day] = Number(pick);
      save();
      closeModal();
      renderMood();
    };
    $("#m-del").onclick = () => {
      delete data[day];
      save();
      closeModal();
      renderMood();
    };
  }
  let moodChart;
  function drawMoodChart(data, total) {
    const ctx = $("#mood-chart");
    const labels = [],
      series = [];
    for (let d = 1; d <= total; d++) {
      labels.push(d);
      series.push(data[d] != null ? data[d] : null);
    }
    if (moodChart) moodChart.destroy();
    if (typeof Chart === "undefined") return;
    moodChart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "心情指数",
            data: series,
            spanGaps: true,
            borderColor: "#B6A6D6",
            backgroundColor: "rgba(182,166,214,.15)",
            fill: true,
            tension: 0.3,
            pointRadius: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { min: -2, max: 2, ticks: { stepSize: 1 } } },
        plugins: { legend: { display: false } },
      },
    });
  }

  /* ============================================================
     3) 工作情况（不变）
     ============================================================ */
  function renderWork() {
    const data = ensureWork();
    const total = daysInMonth();
    $("#work-legend").innerHTML = `
      <span class="lg"><span class="dot" style="background:${LEVEL.low.color}"></span>0–49 不忙碌</span>
      <span class="lg"><span class="dot" style="background:${LEVEL.mid.color}"></span>50 适中</span>
      <span class="lg"><span class="dot" style="background:${LEVEL.high.color}"></span>51–100 忙碌</span>`;
    const hm = $("#work-heatmap");
    let html = "";
    const off = firstOffset();
    for (let i = 0; i < off; i++) html += `<div></div>`;
    for (let d = 1; d <= total; d++) {
      const v = data.busy[d];
      const bg = levelColor(v);
      html += `<div class="hcell" data-day="${d}" style="${bg ? "background:" + bg : ""}">
        <span class="d">${d}</span>
        <span class="v ${v == null ? "" : "vsmall"}">${v == null ? "—" : v}</span>
      </div>`;
    }
    hm.innerHTML = html;
    $$(".hcell", hm).forEach((cell) => {
      if (!cell.dataset.day) return;
      cell.addEventListener("click", () => openWorkModal(Number(cell.dataset.day)));
    });
    const ot = data.ot;
    $("#work-overtime").innerHTML = [
      ["加班天数", "ot-days", ot.days, "天"],
      ["加班小时", "ot-hours", ot.hours, "小时"],
      ["周六加班天数", "ot-satDays", ot.satDays, "天"],
      ["周六加班小时", "ot-satHours", ot.satHours, "小时"],
      ["混班时间", "ot-mixed", ot.mixed, "小时/说明"],
    ]
      .map(
        ([label, id, val, unit]) => `
        <div class="field"><label>${label} <span class="muted">(${unit})</span></label>
          <input id="${id}" type="text" value="${val || ""}" /></div>`
      )
      .join("");
    ["ot-days", "ot-hours", "ot-satDays", "ot-satHours", "ot-mixed"].forEach((id) => {
      const el = $("#" + id);
      const key = id.replace("ot-", "");
      el.addEventListener("input", (e) => {
        data.ot[key] = e.target.value;
        save();
        paintWorkStats(data);
      });
      el.addEventListener("change", (e) => {
        data.ot[key] = e.target.value;
        save();
        paintWorkStats(data);
      });
    });
    $("#work-summary").value = data.summary || "";
    paintWorkStats(data);
    drawWorkChart(data, total);
  }
  function openWorkModal(day) {
    const data = ensureWork();
    const cur = data.busy[day] != null ? data.busy[day] : 50;
    modal.innerHTML = `
      <h3>${monthKey()}-${pad(day)} · 忙碌度</h3>
      <p class="muted">0 = 不忙碌，100 = 非常忙碌</p>
      <input id="m-busy" type="range" min="0" max="100" step="5" value="${cur}" />
      <div style="text-align:center;font-size:22px;font-weight:700;margin:10px 0" id="m-busy-v">${cur} · ${busyLabel(
      cur
    )}</div>
      <div class="modal-actions">
        <button class="link-btn" id="m-del">清除</button>
        <button class="primary-btn" id="m-save">保存</button>
      </div>`;
    mask.hidden = false;
    const slider = $("#m-busy");
    slider.oninput = () => (out.textContent = `${slider.value} · ${busyLabel(slider.value)}`);
    const out = $("#m-busy-v");
    $("#m-save").onclick = () => {
      data.busy[day] = Number(slider.value);
      save();
      closeModal();
      renderWork();
    };
    $("#m-del").onclick = () => {
      delete data.busy[day];
      save();
      closeModal();
      renderWork();
    };
  }
  function paintWorkStats(data) {
    const ot = data.ot;
    const vals = Object.values(data.busy).filter((x) => x != null).map(Number);
    const logged = vals.length;
    const avg = logged ? Math.round(vals.reduce((a, b) => a + b, 0) / logged) : 0;
    const min = logged ? Math.min(...vals) : 0;
    const max = logged ? Math.max(...vals) : 0;
    const low = vals.filter((v) => busyLevel(v) === "low").length;
    const mid = vals.filter((v) => busyLevel(v) === "mid").length;
    const high = vals.filter((v) => busyLevel(v) === "high").length;
    $("#work-stats").innerHTML = [
      ["录入天数", logged, "天"],
      ["平均忙碌度", avg, "/100"],
      ["最低 / 最高", `${min} / ${max}`, ""],
      ["不忙碌", low, "天", LEVEL.low.color],
      ["适中", mid, "天", LEVEL.mid.color],
      ["忙碌", high, "天", LEVEL.high.color],
      ["加班天数", ot.days || 0, "天"],
      ["加班小时", ot.hours || 0, "h"],
      ["周六加班", `${ot.satDays || 0}天 / ${ot.satHours || 0}h`, ""],
    ]
      .map(
        ([k, n, u, c]) =>
          `<div class="stat"><div class="k">${
            c ? `<span class="dot" style="background:${c};display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;vertical-align:middle"></span>` : ""
          }${k}</div><div class="n"${c ? ` style="color:${c}"` : ""}>${n}<span class="u">${u}</span></div></div>`
      )
      .join("");
  }
  let workChart;
  function drawWorkChart(data, total) {
    const ctx = $("#work-chart");
    const labels = [],
      series = [];
    for (let d = 1; d <= total; d++) {
      labels.push(d);
      series.push(data.busy[d] != null ? data.busy[d] : null);
    }
    if (workChart) workChart.destroy();
    if (typeof Chart === "undefined") return;
    workChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [{ label: "忙碌度", data: series, backgroundColor: series.map((v) => (v == null ? "rgba(0,0,0,.06)" : levelColor(v))), borderRadius: 4 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { min: 0, max: 100 } },
        plugins: { legend: { display: false } },
      },
    });
  }

  /* ============================================================
     4) 月度总结（减肥数据联动增强）
     ============================================================ */
  const MONTHLY_MODULES = [
    { id: "finance", t: "本月财务", auto: false },
    { id: "reading", t: "阅读情况", auto: false },
    { id: "exercise", t: "运动天数及详细内容", auto: false },
    { id: "weight", t: "减肥数据", auto: true },
    { id: "work", t: "工作情况总结", auto: true },
    { id: "mood", t: "心理状态", auto: true },
    { id: "body", t: "身体情况记录", auto: false },
    { id: "entertainment", t: "娱乐回顾", auto: false },
    { id: "review", t: "本月回顾", auto: false },
    { id: "thoughts", t: "本月思考", auto: false },
  ];

  function renderMonthlyNav() {
    $("#monthly-nav").innerHTML = MONTHLY_MODULES.map(
      (m, i) => `<button class="mn-item ${i === 0 ? "active" : ""}" data-m="${m.id}">${m.t}</button>`
    ).join("");
    $$("#monthly-nav .mn-item").forEach((b) => {
      b.onclick = () => {
        $$("#monthly-nav .mn-item").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        showMonthlyPanel(b.dataset.m);
      };
    });
  }
  function showMonthlyPanel(id) {
    $$(".mp").forEach((p) => p.classList.remove("active"));
    const panel = $("#mp-" + id);
    if (panel) panel.classList.add("active");
    panel && panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderMonthly() {
    const m = ensureMonthly();
    const cal = state.calories[monthKey()] || { days: {}, notes: {} };
    const wt = state.weight[monthKey()] || {};
    const ex = state.exercise[monthKey()] || {};
    const mood = state.mood[monthKey()] || {};
    const work = state.work[monthKey()] || { busy: {}, ot: {}, summary: "" };
    const tdee = computeTDEE();

    const calVals = Object.values(cal.days).filter((x) => x != null).map(Number);
    const calAvg = calVals.length ? Math.round(calVals.reduce((a, b) => a + b, 0) / calVals.length) : 0;
    const over = calVals.filter((v) => v > 1800).length;
    const low = calVals.filter((v) => v < 1200).length;
    const wVals = Object.values(wt).filter((x) => x != null).map(Number);
    const wLast = wVals.length ? wVals[wVals.length - 1] : null;
    let cumDef = 0,
      defDays = 0;
    Object.keys(cal.days).forEach((d) => {
      if (tdee != null) {
        cumDef += Number(cal.days[d]) - tdee - (ex[d] ? Number(ex[d]) : 0);
        defDays++;
      }
    });
    const fatKg = defDays ? -(cumDef / 7700) : 0;

    const moodVals = Object.values(mood).filter((x) => x != null).map(Number);
    const moodAvg = moodVals.length ? (moodVals.reduce((a, b) => a + b, 0) / moodVals.length).toFixed(2) : "—";

    const workVals = Object.values(work.busy).filter((x) => x != null).map(Number);
    const workAvg = workVals.length ? Math.round(workVals.reduce((a, b) => a + b, 0) / workVals.length) : 0;

    const phNow = state.menstrual.lastStart ? currentPhase() : null;

    const panels = {
      finance: `
        <div class="mp-grid">
          <div class="field"><label>本月收入</label><input id="f-income" value="${m.finance.income || ""}" placeholder="元" /></div>
          <div class="field"><label>本月支出</label><input id="f-expense" value="${m.finance.expense || ""}" placeholder="元" /></div>
        </div>
        <div class="field" style="margin-top:14px"><label>财务备注 / 大额开销</label><textarea id="f-note" placeholder="房租、旅行、人情……">${m.finance.note || ""}</textarea></div>`,
      reading: `
        <div class="mp-grid">
          <div class="field"><label>读完本数</label><input id="r-count" value="${m.reading.count || ""}" placeholder="本" /></div>
          <div class="field"><label>书名清单</label><input id="r-books" value="${m.reading.books || ""}" placeholder="《书名1》《书名2》" /></div>
        </div>
        <div class="field" style="margin-top:14px"><label>阅读心得</label><textarea id="r-note" placeholder="哪本最有收获？">${m.reading.note || ""}</textarea></div>`,
      exercise: `
        <div class="mp-grid"><div class="field"><label>运动天数</label><input id="e-days" value="${m.exercise.days || ""}" placeholder="天" /></div></div>
        <div class="field" style="margin-top:14px"><label>运动详细内容</label><textarea id="e-detail" placeholder="跑步×8次、瑜伽×4次、爬楼……">${m.exercise.detail || ""}</textarea></div>`,
      weight: `
        <div class="mp-grid">
          <div class="mp-stat"><div class="k">热量录入天数</div><div class="n">${calVals.length}</div></div>
          <div class="mp-stat"><div class="k">平均热量</div><div class="n">${calAvg}<span class="u">大卡</span></div></div>
          <div class="mp-stat"><div class="k">超标天数 (>1800)</div><div class="n">${over}<span class="u">天</span></div></div>
          <div class="mp-stat"><div class="k">低热量天数 (<1200)</div><div class="n">${low}<span class="u">天</span></div></div>
          <div class="mp-stat"><div class="k">体重记录天数</div><div class="n">${wVals.length}</div></div>
          <div class="mp-stat"><div class="k">最新体重</div><div class="n">${wLast != null ? wLast.toFixed(1) : "—"}<span class="u">kg</span></div></div>
          <div class="mp-stat"><div class="k">累计热量差值</div><div class="n">${defDays ? Math.round(cumDef) : "—"}<span class="u">大卡</span></div></div>
          <div class="mp-stat"><div class="k">预计减脂</div><div class="n">${defDays ? fatKg.toFixed(2) : "—"}<span class="u">kg</span></div></div>
          <div class="mp-stat"><div class="k">当前相位</div><div class="n">${phNow ? phNow.label : "未设置"}</div></div>
        </div>
        <div class="field" style="margin-top:14px"><label>减肥小结 / 反思</label><textarea id="w-note" placeholder="体重变化、控制得与失、经期储水观察……">${m.wNote || ""}</textarea></div>`,
      work: `
        <div class="mp-grid">
          <div class="mp-stat"><div class="k">平均忙碌度</div><div class="n">${workAvg}<span class="u">/100</span></div></div>
          <div class="mp-stat"><div class="k">加班</div><div class="n">${work.ot.days || 0}<span class="u">天 / ${work.ot.hours || 0}h</span></div></div>
          <div class="mp-stat"><div class="k">周六加班</div><div class="n">${work.ot.satDays || 0}<span class="u">天 / ${work.ot.satHours || 0}h</span></div></div>
        </div>
        <div class="field" style="margin-top:14px"><label>工作小结（含每月总结）</label><textarea id="wo-note" placeholder="项目进展、成长、待改进……">${m.woNote || ""}</textarea></div>`,
      mood: `
        <div class="mp-grid">
          <div class="mp-stat"><div class="k">平均心情</div><div class="n">${moodAvg}</div></div>
          <div class="mp-stat"><div class="k">录入天数</div><div class="n">${moodVals.length}</div></div>
          <div class="mp-stat"><div class="k">开心占比</div><div class="n">${
            moodVals.length ? Math.round((moodVals.filter((v) => v >= 1).length / moodVals.length) * 100) : 0
          }<span class="u">%</span></div></div>
        </div>
        <div class="field" style="margin-top:14px"><label>心理小结</label><textarea id="m-note" placeholder="情绪波动点、压力源、调节方式……">${m.mNote || ""}</textarea></div>`,
      body: `<div class="field"><label>身体情况记录</label><textarea id="b-body" placeholder="睡眠、病痛、体检、精力……">${m.body || ""}</textarea></div>`,
      entertainment: `<div class="field"><label>娱乐回顾</label><textarea id="en" placeholder="电影、游戏、聚会、旅行……">${m.entertainment || ""}</textarea></div>`,
      review: `<div class="field"><label>本月回顾</label><textarea id="rv" placeholder="最重要的事、遗憾、惊喜……">${m.review || ""}</textarea></div>`,
      thoughts: `<div class="field"><label>本月思考</label><textarea id="th" placeholder="对某事的新看法、想通的道理……">${m.thoughts || ""}</textarea></div>`,
    };

    $("#monthly-panels").innerHTML = MONTHLY_MODULES.map((mod, i) => {
      return `<div class="mp ${i === 0 ? "active" : ""}" id="mp-${mod.id}">
        <div class="mp-head"><span class="num">${i + 1}</span><h2>${mod.t}</h2>${
        mod.auto ? '<span class="auto">自动关联</span>' : ""
      }</div>${panels[mod.id]}</div>`;
    }).join("");
    bindMonthlyInputs(m);
  }
  function bindMonthlyInputs(m) {
    const set = (id, fn) => {
      const el = $("#" + id);
      if (el) el.addEventListener("input", () => { fn(el.value); save(); });
    };
    set("f-income", (v) => (m.finance.income = v));
    set("f-expense", (v) => (m.finance.expense = v));
    set("f-note", (v) => (m.finance.note = v));
    set("r-count", (v) => (m.reading.count = v));
    set("r-books", (v) => (m.reading.books = v));
    set("r-note", (v) => (m.reading.note = v));
    set("e-days", (v) => (m.exercise.days = v));
    set("e-detail", (v) => (m.exercise.detail = v));
    set("w-note", (v) => (m.wNote = v));
    set("wo-note", (v) => (m.woNote = v));
    set("m-note", (v) => (m.mNote = v));
    set("b-body", (v) => (m.body = v));
    set("en", (v) => (m.entertainment = v));
    set("rv", (v) => (m.review = v));
    set("th", (v) => (m.thoughts = v));
  }

  /* ============================================================
     5) 猫咪（猫砂用量 / 体重）
     ============================================================ */
  const CAT_NAMES = ["泡泡", "喵喵"];
  function ensureCat() {
    if (!state.cat) state.cat = {};
    // 旧格式迁移：state.cat = { litter:{}, weight:{} } → 归到“泡泡”
    if (state.cat.litter || state.cat.weight) {
      const oldL = state.cat.litter || {};
      const oldW = state.cat.weight || {};
      state.cat = { cats: { "泡泡": { litter: oldL, weight: oldW }, "喵喵": { litter: {}, weight: {} } }, active: "泡泡" };
    }
    if (!state.cat.cats) state.cat.cats = {};
    CAT_NAMES.forEach((n) => {
      if (!state.cat.cats[n]) state.cat.cats[n] = { litter: {}, weight: {} };
      if (!state.cat.cats[n].litter) state.cat.cats[n].litter = {};
      if (!state.cat.cats[n].weight) state.cat.cats[n].weight = {};
    });
    if (!state.cat.active || !state.cat.cats[state.cat.active]) state.cat.active = "泡泡";
    return state.cat;
  }
  function activeCatName() {
    ensureCat();
    return state.cat.active || "泡泡";
  }
  function activeCat() {
    const n = activeCatName();
    return state.cat.cats[n];
  }
  function ensureCatMonth() {
    const c = activeCat();
    const k = monthKey();
    if (!c.litter[k]) c.litter[k] = [];
    return c.litter[k];
  }
  function ensureCatWeightMonth() {
    const c = activeCat();
    const k = monthKey();
    if (!c.weight[k]) c.weight[k] = {};
    return c.weight[k];
  }
  function nowLocal() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function fmt(v) {
    const n = Number(v);
    if (isNaN(n) || !isFinite(n)) return "0.00";
    return n.toFixed(2);
  }
  function rowUnit(row) {
    const m = Number(row.money), k = Number(row.kg);
    if (!k || isNaN(k)) return 0;
    return m / k;
  }
  function rowCost(row) {
    return rowUnit(row) * Number(row.usage || 0);
  }
  function boxCost(rows) {
    return rows.reduce((s, r) => s + rowCost(r), 0);
  }
  function sessionCost(s) {
    return s.boxes.reduce((sum, rows) => sum + boxCost(rows), 0);
  }
  function findSession(sid) {
    return ensureCatMonth().find((x) => x.id === sid);
  }
  function findRow(sid, bi, ri) {
    const s = findSession(sid);
    if (!s || !s.boxes[bi]) return null;
    return s.boxes[bi][ri] || null;
  }
  function newRow() { return { name: "", money: "", kg: "", usage: "" }; }
  function addSession() {
    const s = {
      id: "s" + Date.now() + Math.floor(Math.random() * 1000),
      putTime: nowLocal(),
      clearTime: "",
      boxes: [[newRow()], [newRow()], [newRow()]],
    };
    ensureCatMonth().push(s);
    save();
    renderCat();
  }
  function delSession(sid) {
    const arr = ensureCatMonth();
    const i = arr.findIndex((x) => x.id === sid);
    if (i >= 0) arr.splice(i, 1);
    save();
    renderCat();
  }
  function addRow(sid, bi) {
    const s = findSession(sid);
    if (!s) return;
    s.boxes[bi].push(newRow());
    save();
    renderCat();
  }
  function delRow(sid, bi, ri) {
    const s = findSession(sid);
    if (!s) return;
    if (s.boxes[bi].length <= 1) { alert("每个盆至少保留一行"); return; }
    s.boxes[bi].splice(ri, 1);
    save();
    renderCat();
  }
  function setNow(sid, field) {
    const s = findSession(sid);
    if (!s) return;
    s[field] = nowLocal();
    save();
    renderCat();
  }
  function escAttr(s) {
    return String(s == null ? "" : s).replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  function renderSessionCard(s) {
    const total = sessionCost(s);
    const completed = s.clearTime ? "✅ 已清空" : "⏳ 投放中";
    const boxesHtml = s.boxes
      .map((rows, bi) => {
        const sub = boxCost(rows);
        const rowHtml = rows
          .map(
            (row, ri) => `
          <tr>
            <td><input class="cell-in" data-sid="${s.id}" data-box="${bi}" data-ri="${ri}" data-rfield="name" value="${escAttr(row.name)}" placeholder="猫砂名"/></td>
            <td><input class="cell-in num" data-sid="${s.id}" data-box="${bi}" data-ri="${ri}" data-rfield="money" value="${escAttr(row.money)}" placeholder="钱"/></td>
            <td><input class="cell-in num" data-sid="${s.id}" data-box="${bi}" data-ri="${ri}" data-rfield="kg" value="${escAttr(row.kg)}" placeholder="kg"/></td>
            <td class="calc"><span id="unit-${s.id}-${bi}-${ri}">${fmt(rowUnit(row))}</span></td>
            <td><input class="cell-in num" data-sid="${s.id}" data-box="${bi}" data-ri="${ri}" data-rfield="usage" value="${escAttr(row.usage)}" placeholder="本次用量"/></td>
            <td class="calc"><span id="cost-${s.id}-${bi}-${ri}">${fmt(rowCost(row))}</span></td>
            <td><button class="link-btn danger" data-act="del-row" data-sid="${s.id}" data-box="${bi}" data-ri="${ri}">删</button></td>
          </tr>`
          )
          .join("");
        return `
        <div class="litter-box">
          <div class="litter-box-head"><strong>盆 ${bi + 1}</strong><span class="muted">小计 ¥<span id="bsum-${s.id}-${bi}">${fmt(sub)}</span></span></div>
          <div class="table-wrap">
            <table class="data-table litter-tbl">
              <thead><tr><th>猫砂名称</th><th>钱</th><th>kg</th><th>单价(钱÷kg)</th><th>本次用量</th><th>本次费用(单价×用量)</th><th></th></tr></thead>
              <tbody>${rowHtml || '<tr><td colspan="7" class="muted">空</td></tr>'}</tbody>
            </table>
          </div>
          <button class="ghost-btn sm" data-act="add-row" data-sid="${s.id}" data-box="${bi}">＋ 加一行</button>
        </div>`;
      })
      .join("");
    return `
    <div class="session-card">
      <div class="session-head">
        <div class="session-time">
          <label>投入时间<input type="datetime-local" data-sid="${s.id}" data-sfield="putTime" value="${escAttr(s.putTime)}"/></label>
          <label>清空时间<input type="datetime-local" data-sid="${s.id}" data-sfield="clearTime" value="${escAttr(s.clearTime)}"/></label>
        </div>
        <div class="session-sum">
          <span class="badge ${s.clearTime ? "badge-ok" : "badge-wait"}">${completed}</span>
          <div class="sum-big">本会话汇总 <b>¥<span id="sum-${s.id}">${fmt(total)}</span></b></div>
        </div>
        <div class="session-acts">
          <button class="link-btn" data-act="set-now" data-sid="${s.id}" data-field="putTime">投入=现在</button>
          <button class="link-btn" data-act="set-now" data-sid="${s.id}" data-field="clearTime">清空=现在</button>
          <button class="link-btn danger" data-act="del-session" data-sid="${s.id}">删除本次</button>
        </div>
      </div>
      <div class="row-actions" style="margin:4px 0 12px">
        <button class="ghost-btn sm" data-act="copy-box1" data-sid="${s.id}">📋 按盆1复制（应用到盆2/盆3）</button>
      </div>
      <div class="litter-boxes">${boxesHtml}</div>
    </div>`;
  }

  function renderCat() {
    const c = ensureCat();
    const who = activeCatName();
    // 猫切换器高亮 + 标题/说明显示当前猫
    $$("#cat-switch .cat-tab").forEach((b) =>
      b.classList.toggle("active", b.dataset.cat === who)
    );
    const lt = $("#cat-litter-title"), lw = $("#cat-litter-who");
    const wt = $("#cat-weight-title"), ww = $("#cat-weight-who");
    if (lt) lt.textContent = `🐱 ${who} · 猫砂用量（分三个盆）`;
    if (lw) lw.textContent = who;
    if (wt) wt.textContent = `🐱 ${who} · 猫咪体重`;
    if (ww) ww.textContent = who;
    const sessions = ensureCatMonth();
    const wrap = $("#cat-sessions");
    if (!sessions.length) {
      wrap.innerHTML = `<div class="muted" style="padding:10px 0">本月还没有记录，点击「＋ 新增一次（投入）」开始记录一次猫砂投放。</div>`;
    } else {
      wrap.innerHTML = sessions.map(renderSessionCard).join("");
    }
    let monthTotal = 0;
    sessions.forEach((s) => (monthTotal += sessionCost(s)));
    $("#cat-litter-stats").innerHTML = [
      ["本月投放次数", sessions.length, "次"],
      ["本月猫砂总费用", "¥" + fmt(monthTotal), ""],
    ]
      .map(
        ([k, n, u]) =>
          `<div class="stat"><div class="k">${k}</div><div class="n">${n}<span class="u">${u}</span></div></div>`
      )
      .join("");
    renderCatWeight();
  }

  function recomputeSession(sid) {
    const s = findSession(sid);
    if (!s) return;
    s.boxes.forEach((rows, bi) => {
      rows.forEach((row, ri) => {
        const u = $("#unit-" + sid + "-" + bi + "-" + ri);
        const co = $("#cost-" + sid + "-" + bi + "-" + ri);
        if (u) u.textContent = fmt(rowUnit(row));
        if (co) co.textContent = fmt(rowCost(row));
      });
      const bs = $("#bsum-" + sid + "-" + bi);
      if (bs) bs.textContent = fmt(boxCost(rows));
    });
    const sm = $("#sum-" + sid);
    if (sm) sm.textContent = fmt(sessionCost(s));
    renderCatMonthStat();
  }
  function renderCatMonthStat() {
    const c = activeCat();
    const month = monthKey();
    const sessions = c.litter[month] || [];
    let monthTotal = 0;
    sessions.forEach((s) => (monthTotal += sessionCost(s)));
    const el = $("#cat-litter-stats");
    if (el)
      el.innerHTML = [
        ["本月投放次数", sessions.length, "次"],
        ["本月猫砂总费用", "¥" + fmt(monthTotal), ""],
      ]
        .map(
          ([k, n, u]) =>
            `<div class="stat"><div class="k">${k}</div><div class="n">${n}<span class="u">${u}</span></div></div>`
        )
        .join("");
  }

  /* 模块2：猫咪体重 */
  let catWeightChart;
  function renderCatWeight() {
    const c = activeCat();
    const month = monthKey();
    const wm = c.weight[month] || {};
    const days = Object.keys(wm).map(Number).sort((a, b) => a - b);
    const tb = $("#cat-weight-table tbody");
    tb.innerHTML = days.length
      ? days
          .map(
            (d) =>
              `<tr><td>${month}-${pad(d)}</td><td>${Number(wm[d]).toFixed(2)} kg</td><td><button class="link-btn danger" data-act="del-cw" data-d="${d}">删</button></td></tr>`
          )
          .join("")
      : `<tr class="empty-row"><td colspan="3">本月还没记录猫咪体重</td></tr>`;
    const de = $("#cat-w-date");
    if (de) {
      const mk = monthKey();
      const today = todayKey();
      // 默认日期放在当前查看的月份里；若已有选择但跨了月份，也同步回当前月份，避免误录
      if (!de.value || !de.value.startsWith(mk + "-")) {
        de.value = today.startsWith(mk + "-") ? today : mk + "-01";
      }
    }
    drawCatWeightChart();
  }
  function drawCatWeightChart() {
    const c = activeCat();
    const all = [];
    for (const mk in c.weight) {
      for (const d in c.weight[mk]) {
        all.push({ date: `${mk}-${pad(d)}`, val: Number(c.weight[mk][d]) });
      }
    }
    all.sort((a, b) => a.date.localeCompare(b.date));
    const ctx = $("#cat-weight-chart");
    if (!ctx || typeof Chart === "undefined") return;
    if (catWeightChart) catWeightChart.destroy();
    const many = all.length > 20;
    catWeightChart = new Chart(ctx, {
      type: "line",
      data: {
        labels: all.map((x) => x.date),
        datasets: [
          {
            label: "猫咪体重(kg)",
            data: all.map((x) => x.val),
            borderColor: "#B6A6D6",
            backgroundColor: "rgba(182,166,214,.15)",
            tension: 0.3,
            spanGaps: true,
            pointRadius: many ? 2 : 4,
            borderWidth: many ? 2 : 2.5,
            fill: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: false }, x: { ticks: { maxTicksLimit: 12 } } },
        plugins: { legend: { display: false }, tooltip: { intersect: false } },
      },
    });
  }
  function addCatWeight() {
    const dEl = $("#cat-w-date");
    const vEl = $("#cat-w-val");
    const v = Number(vEl.value);
    if (!v || isNaN(v)) {
      alert("请输入体重（kg）");
      return;
    }
    // 以日期输入框的完整日期为准，而不是顶部月份选择器
    const dateStr = dEl.value || todayKey();
    const [y, m, d] = dateStr.split("-").map(Number);
    const mk = `${y}-${pad(m)}`;
    const c = activeCat();
    if (!c.weight[mk]) c.weight[mk] = {};
    c.weight[mk][d] = v;
    save();
    vEl.value = "";
    renderCat();
  }
  function delCatWeight(d) {
    const c = activeCat();
    const month = monthKey();
    if (c.weight[month]) delete c.weight[month][d];
    save();
    renderCat();
  }

  /* 猫咪视图事件（委托在 #view-cat 上，innerHTML 替换不丢失监听） */
  function onCatInput(e) {
    const t = e.target;
    if (t.dataset.sfield) {
      const s = findSession(t.dataset.sid);
      if (s) {
        s[t.dataset.sfield] = t.value;
        save();
      }
    } else if (t.dataset.rfield) {
      const row = findRow(t.dataset.sid, +t.dataset.box, +t.dataset.ri);
      if (row) {
        row[t.dataset.rfield] = t.value;
        save();
        recomputeSession(t.dataset.sid);
      }
    }
  }
  function onCatClick(e) {
    const t = e.target.closest("[data-act]");
    if (!t) return;
    const act = t.dataset.act;
    const sid = t.dataset.sid;
    if (act === "add-session") addSession();
    else if (act === "del-session") {
      if (confirm("确定删除本次记录？该次三个盆的数据都会清除。")) delSession(sid);
    } else if (act === "add-row") addRow(sid, +t.dataset.box);
    else if (act === "del-row") delRow(sid, +t.dataset.box, +t.dataset.ri);
    else if (act === "set-now") setNow(sid, t.dataset.field);
    else if (act === "add-cw") addCatWeight();
    else if (act === "del-cw") delCatWeight(+t.dataset.d);
    else if (act === "copy-box1") copyBox1(sid);
    else if (act === "switch-cat") {
      ensureCat();
      state.cat.active = t.dataset.cat;
      save();
      renderCat();
    }
  }
  function copyBox1(sid) {
    const s = findSession(sid);
    if (!s) return;
    const src = s.boxes[0] || [];
    s.boxes[1] = src.map((r) => ({ ...r }));
    s.boxes[2] = src.map((r) => ({ ...r }));
    save();
    renderCat();
  }

  /* ============================================================
     视图切换 & 渲染调度
     ============================================================ */
  const VIEW_TITLE = { weight: "体重管理", mood: "每日心情", work: "工作情况", cat: "猫咪", monthly: "月度总结" };
  function renderCurrentView() {
    const active = $(".nav-item.active").dataset.view;
    if (active === "weight") renderWeight();
    else if (active === "mood") renderMood();
    else if (active === "work") renderWork();
    else if (active === "cat") renderCat();
    else if (active === "monthly") renderMonthly();
  }
  function switchView(v) {
    $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
    $$(".view").forEach((s) => s.classList.toggle("active", s.id === "view-" + v));
    $("#view-title").textContent = VIEW_TITLE[v];
    renderCurrentView();
    if (v === "monthly") $("#monthly-panels").scrollIntoView({ block: "start" });
  }

  /* ============================================================
     数据管理：导出 / 导入（合并 or 覆盖）/ CSV 归档
     ============================================================ */
  function defaultState() {
    return {
      profile: { gender: "女", age: 28, height: 165, activity: 1.375, target: 52 },
      menstrual: { lastStart: "", cycleLen: 28, periodLen: 5 },
      calories: {}, weight: {}, exercise: {}, mood: {}, work: {}, monthly: {},
      cat: { cats: { "泡泡": { litter: {}, weight: {} }, "喵喵": { litter: {}, weight: {} } }, active: "泡泡" },
    };
  }
  function dateStamp() {
    const t = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}`;
  }
  function downloadText(content, filename, mime) {
    const blob = new Blob([content], { type: mime || "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // 完整 JSON 备份
  function exportData() {
    downloadText(
      JSON.stringify(state, null, 2),
      `个人工作台备份_${dateStamp()}.json`,
      "application/json"
    );
  }

  // 合并导入：保留本地已有，补齐缺失（按 月/日 粒度）
  function mergeState(obj) {
    const src = obj || {};
    ["calories", "weight", "exercise", "mood", "work", "monthly"].forEach((k) => {
      if (!src[k]) return;
      if (!state[k]) state[k] = {};
      for (const mk in src[k]) {
        if (k === "work") {
          const w = src[k][mk];
          if (!state.work[mk]) state.work[mk] = { busy: {}, ot: {}, summary: "" };
          if (w.busy) for (const d in w.busy) if (state.work[mk].busy[d] == null) state.work[mk].busy[d] = w.busy[d];
          if (w.ot) for (const f in w.ot) if (state.work[mk].ot[f] == null || state.work[mk].ot[f] === "") state.work[mk].ot[f] = w.ot[f];
          if (w.summary && !state.work[mk].summary) state.work[mk].summary = w.summary;
        } else if (k === "monthly") {
          if (!state.monthly[mk]) state.monthly[mk] = {};
          for (const f in src[k][mk]) if (state.monthly[mk][f] == null) state.monthly[mk][f] = src[k][mk][f];
        } else if (k === "calories") {
          const s = src[k][mk];
          if (!state.calories[mk]) state.calories[mk] = { days: {}, notes: {} };
          if (s.days) for (const d in s.days) if (state.calories[mk].days[d] == null) state.calories[mk].days[d] = s.days[d];
          if (s.notes) for (const d in s.notes) if (state.calories[mk].notes[d] == null) state.calories[mk].notes[d] = s.notes[d];
        } else {
          const s = src[k][mk];
          if (!state[k][mk]) state[k][mk] = {};
          for (const d in s) if (state[k][mk][d] == null) state[k][mk][d] = s[d];
        }
      }
    });
    if (src.cat) {
      const cat = ensureCat();
      // 旧格式（无 cats）归到“泡泡”
      const srcCats =
        src.cat.cats ||
        (src.cat.litter || src.cat.weight
          ? { "泡泡": { litter: src.cat.litter || {}, weight: src.cat.weight || {} } }
          : {});
      for (const name of Object.keys(srcCats)) {
        if (!cat.cats[name]) cat.cats[name] = { litter: {}, weight: {} };
        const sc = srcCats[name];
        if (sc.litter) {
          for (const mk in sc.litter) {
            if (!cat.cats[name].litter[mk]) cat.cats[name].litter[mk] = [];
            (sc.litter[mk] || []).forEach((s) => {
              if (!cat.cats[name].litter[mk].some((x) => x.id === s.id)) cat.cats[name].litter[mk].push(s);
            });
          }
        }
        if (sc.weight) {
          for (const mk in sc.weight) {
            if (!cat.cats[name].weight[mk]) cat.cats[name].weight[mk] = {};
            for (const d in sc.weight[mk]) if (cat.cats[name].weight[mk][d] == null) cat.cats[name].weight[mk][d] = sc.weight[mk][d];
          }
        }
      }
    }
    if (src.profile && (!state.profile || !state.profile.target)) state.profile = src.profile;
    if (src.menstrual && (!state.menstrual || !state.menstrual.lastStart)) state.menstrual = src.menstrual;
  }

  let importMode = "merge";
  function importData(file, mode) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(reader.result);
        if (!obj || typeof obj !== "object") {
          alert("文件格式不正确");
          return;
        }
        if (mode === "replace") {
          state = Object.assign(defaultState(), obj);
        } else {
          mergeState(obj);
        }
        save();
        renderCurrentView();
        alert(mode === "replace" ? "已覆盖导入（本机数据已替换为备份）" : "已合并导入（保留已有数据，补齐缺失）");
      } catch (e) {
        alert("解析失败：" + e.message);
      }
    };
    reader.readAsText(file);
  }

  // CSV 归档：所有月份的每日记录，便于在 Excel 中长期保存
  function csvCell(v) {
    const s = String(v == null ? "" : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exportCSV() {
    const rows = [["月份", "日", "热量(大卡)", "体重(kg)", "运动消耗", "心情", "忙碌度"]];
    const months = new Set([
      ...Object.keys(state.calories || {}),
      ...Object.keys(state.weight || {}),
      ...Object.keys(state.exercise || {}),
      ...Object.keys(state.mood || {}),
      ...Object.keys(state.work || {}),
    ]);
    [...months].sort().forEach((mk) => {
      const cal = state.calories[mk] || { days: {} };
      const wt = state.weight[mk] || {};
      const ex = state.exercise[mk] || {};
      const mo = state.mood[mk] || {};
      const wk = (state.work[mk] || {}).busy || {};
      const days = new Set([
        ...Object.keys(cal.days || {}),
        ...Object.keys(wt),
        ...Object.keys(ex),
        ...Object.keys(mo),
        ...Object.keys(wk),
      ]);
      [...days].map(Number).sort((a, b) => a - b).forEach((d) => {
        if (cal.days[d] == null && wt[d] == null && ex[d] == null && mo[d] == null && wk[d] == null) return;
        rows.push([mk, d, cal.days[d] ?? "", wt[d] ?? "", ex[d] ?? "", mo[d] ?? "", wk[d] ?? ""]);
      });
    });
    if (rows.length === 1) {
      alert("暂时没有可导出的每日记录");
      return;
    }
    const csv = "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
    downloadText(csv, `个人工作台_每日记录_${dateStamp()}.csv`, "text/csv;charset=utf-8");
  }

  function openDataModal() {
    modal.innerHTML = `
      <h3>⚙ 数据管理</h3>
      <p class="muted">换手机 / 电脑前，建议先<strong>导出备份</strong>。导入支持两种模式，默认「合并」更安全。</p>
      <div class="mp-grid" style="margin:14px 0">
        <div class="field"><label>完整备份（推荐）</label>
          <button class="primary-btn" id="d-json" style="width:100%">导出完整备份 (JSON)</button></div>
        <div class="field"><label>表格归档（Excel 可读）</label>
          <button class="ghost-btn" id="d-csv" style="width:100%">导出每日记录 (CSV)</button></div>
      </div>
      <div class="field"><label>导入模式</label>
        <select id="d-mode" class="modal-input">
          <option value="merge" selected>合并：保留本机已有，补齐缺失（优先本地，绝不丢数据）</option>
          <option value="replace">覆盖：用备份完全替换本机数据</option>
        </select></div>
      <div class="row-actions">
        <button class="link-btn" id="d-close">关闭</button>
        <button class="primary-btn" id="d-import">选择文件并导入</button>
      </div>`;
    mask.hidden = false;
    $("#d-json").onclick = () => exportData();
    $("#d-csv").onclick = () => exportCSV();
    $("#d-import").onclick = () => {
      importMode = $("#d-mode").value;
      $("#file-import").click();
    };
    $("#d-close").onclick = closeModal;
  }

  /* ============================================================
     初始化
     ============================================================ */
  function init() {
    const now = new Date();
    $("#month-input").value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;

    $$(".nav-item").forEach((b) => b.addEventListener("click", () => switchView(b.dataset.view)));
    $("#month-input").addEventListener("change", renderCurrentView);

    $("#btn-today").addEventListener("click", () => {
      const now = new Date();
      $("#month-input").value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
      renderCurrentView();
    });

    const catView = $("#view-cat");
    if (catView) {
      catView.addEventListener("input", onCatInput);
      catView.addEventListener("click", onCatClick);
    }

    $("#btn-export").addEventListener("click", exportData);
    $("#btn-import").addEventListener("click", () => {
      importMode = "merge";
      $("#file-import").click();
    });
    $("#btn-sync").addEventListener("click", openSyncModal);
    $("#btn-data").addEventListener("click", openDataModal);
    $("#file-import").addEventListener("change", (e) => {
      if (e.target.files[0]) importData(e.target.files[0], importMode);
      e.target.value = "";
    });

    $("#btn-profile").addEventListener("click", openProfileModal);
    $("#btn-menstrual").addEventListener("click", openMenstrualModal);

    $("#btn-weight-bulk").addEventListener("click", () => {
      const txt = $("#weight-bulk").value.trim();
      if (!txt) {
        $("#weight-bulk-tip").textContent = "请先输入数据";
        return;
      }
      const cal = ensureCal(),
        wt = ensureWeight(),
        ex = ensureExercise();
      let cnt = 0;
      txt.split(/\n+/).forEach((line) => {
        const parts = line.split(/[,\s]+/).map((x) => x.trim());
        const d = Number(parts[0]);
        if (d >= 1 && d <= 31) {
          if (parts[1] !== undefined && parts[1] !== "") cal.days[d] = Number(parts[1]);
          if (parts[2] !== undefined && parts[2] !== "") wt[d] = Number(parts[2]);
          if (parts[3] !== undefined && parts[3] !== "") ex[d] = Number(parts[3]);
          cnt++;
        }
      });
      save();
      renderWeight();
      $("#weight-bulk-tip").textContent = `已导入 ${cnt} 天 ✔`;
    });

    $("#work-summary").addEventListener("input", (e) => {
      ensureWork().summary = e.target.value;
      save();
    });

    renderMonthlyNav();
    switchView("weight");

    // 自动同步：开启后，打开网页时若云端有更新则拉取
    if (syncCfg.key && syncCfg.auto) {
      pullSync(false).catch(() => {});
    }

    // 注册 Service Worker（仅 http/https 环境，便于“安装到桌面/主屏”）
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(() => {});
      });
    }
  }
  document.addEventListener("DOMContentLoaded", init);
})();
