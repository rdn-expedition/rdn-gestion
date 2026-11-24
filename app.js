const $ = id => document.getElementById(id);

let auth, db, currentUser = null;
const dataCache = { clients:{}, excursions:{}, reservations:{}, factures:{}, depenses:{} };
const dbListeners = {};
const cacheReady = { clients: false, excursions: false, reservations: false, factures: false, depenses: false };
let savingGenericForm = false;
let firebaseConnected = false;
let connectionListener = null;
let activeSyncUid = null;
const moduleSyncState = {};

// ===== RÔLES RDN : 2 ADMINISTRATEURS + 1 AGENT =====
// Les UID ADMIN proviennent des Firebase Rules fournies.
const ADMIN_UIDS = [
  "lkT6cmjOrNcpn51LDycwJZQHUk32",
  "7FrzQ5hkT2Oaol8IkKev1MdRLTs1"
];
const AGENT_EMAILS = ["guiderdn1@gmail.com"];
let auditListener = null;
let auditLogsCache = {};

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizePhoneRDN(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("00261")) digits = "0" + digits.slice(5);
  else if (digits.startsWith("261")) digits = "0" + digits.slice(3);
  return digits;
}

function isAdmin() {
  return !!currentUser && ADMIN_UIDS.includes(String(currentUser.uid || ""));
}

function isAgent() {
  return !!currentUser && !isAdmin() && AGENT_EMAILS.includes(normalizeEmail(currentUser.email));
}

function applyRoleAccessBaseImplementation() {
  const admin = isAdmin();

  // Le bouton Dépenses est réservé aux ADMIN.
  // Ne jamais retirer la classe .hidden de la page #depenses ici :
  // elle doit rester masquée tant que l'utilisateur n'a pas cliqué sur son onglet.
  document.querySelectorAll('nav button[data-page="depenses"]').forEach(button => {
    button.classList.toggle("hidden", !admin);
    button.setAttribute("aria-hidden", admin ? "false" : "true");
  });
  const expensePage = document.getElementById("depenses");
  if (expensePage && !admin) expensePage.classList.add("hidden");

  // Ancienne statistique des dépenses dans le dashboard historique.
  const oldExpenseTotal = document.getElementById("sumDepenses");
  if (oldExpenseTotal) {
    const card = oldExpenseTotal.closest(".stat-card, .stat, .stat-item, .stat-box, article") || oldExpenseTotal.parentElement;
    if (card) card.classList.toggle("hidden", !admin);
  }

  // Les indicateurs financiers du nouveau dashboard sont ADMIN uniquement.
  ["rdnCaEncaisse", "rdnCaPrevisionnel", "rdnDepensesTotal", "rdnBeneficePrevisionnel", "rdnSoldesClients"].forEach(id => {
    const value = document.getElementById(id);
    const card = value?.closest(".rdn-kpi");
    if (card) card.classList.toggle("hidden", !admin);
  });

  const auditPanel = document.getElementById("rdnAuditPanel");
  if (auditPanel) auditPanel.classList.toggle("hidden", !admin);
  const financePanel = document.getElementById("rdnFinancePanel");
  if (financePanel) financePanel.classList.toggle("hidden", !admin);

  const role = document.getElementById("rdnRoleBadge");
  if (role) {
    role.textContent = admin ? "Administrateur" : (isAgent() ? "Agent" : "Accès limité");
    role.classList.toggle("admin", admin);
  }

  //
  const adminTripBalanceSection = $("adminTripBalanceSection");

if (adminTripBalanceSection) {
  adminTripBalanceSection.classList.toggle("hidden", !isAdmin());
}
}

function auditLabel(record = {}) {
  return String(record.nom || record.titre || record.client || record.libelle ||
    record.numero || record.excursion || record.objet || "Élément").slice(0, 180);
}

function buildAuditEvent(action, module, recordId, record, details = "") {
  return {
    action,
    module,
    recordId: String(recordId || ""),
    recordLabel: auditLabel(record),
    details: String(details || "").slice(0, 300),
    actorUid: currentUser?.uid || "",
    actorEmail: normalizeEmail(currentUser?.email),
    actorName: currentUser?.displayName || normalizeEmail(currentUser?.email) || "Utilisateur",
    timestamp: Date.now()
  };
}

async function writeAuditLog(action, module, recordId, record, details = "") {
  if (!db || !currentUser) return;
  const ref = db.ref("rdn/auditLogs").push();
  await ref.set(buildAuditEvent(action, module, recordId, record, details));
}

async function auditSafely(action, module, recordId, record, details = "") {
  try {
    await writeAuditLog(action, module, recordId, record, details);
  } catch (error) {
    console.error("Journal d'audit indisponible :", error);
    const status = document.getElementById("syncStatus");
    if (status) status.textContent = "Données enregistrées — erreur du journal d'audit";
  }
}

function ensureProDashboardBaseImplementation() {
  const dashboard = document.getElementById("dashboard");
  if (!dashboard) return;

  if (!document.getElementById("rdnProDashboard")) {
    const host = document.createElement("div");
    host.id = "rdnProDashboard";
    host.innerHTML = `
      <div class="rdn-dashboard-heading">
        <div><span class="rdn-eyebrow">PILOTAGE DE L'ACTIVITÉ</span><h2>Vue d'ensemble</h2></div>
        <span id="rdnRoleBadge" class="rdn-role-badge">Utilisateur</span>
      </div>
      <div class="rdn-kpi-grid">
        <article class="rdn-kpi"><small>Chiffre d'affaires encaissé</small><strong id="rdnCaEncaisse">0 Ar</strong><span>Encaissements enregistrés</span></article>
        <article class="rdn-kpi"><small>Chiffre d'affaires prévisionnel</small><strong id="rdnCaPrevisionnel">0 Ar</strong><span>Réservations actives + factures</span></article>
        <article class="rdn-kpi"><small>Dépenses totales</small><strong id="rdnDepensesTotal">0 Ar</strong><span>Voyages et dépenses générales</span></article>
        <article class="rdn-kpi"><small>Bénéfice prévisionnel</small><strong id="rdnBeneficePrevisionnel">0 Ar</strong><span>CA prévisionnel moins dépenses</span></article>
        <article class="rdn-kpi"><small>Soldes clients à recevoir</small><strong id="rdnSoldesClients">0 Ar</strong><span>Factures non totalement réglées</span></article>
        <article class="rdn-kpi"><small>Excursions à venir</small><strong id="rdnExcursionsAVenir">0</strong><span>Selon les dates renseignées</span></article>
        <article class="rdn-kpi"><small>Clients enregistrés</small><strong id="rdnClientsTotal">0</strong><span>Fiches clients uniques</span></article>
        <article class="rdn-kpi"><small>Réservations actives</small><strong id="rdnReservationsTotal">0</strong><span>Hors réservations annulées</span></article>
        <article class="rdn-kpi"><small>Factures émises</small><strong id="rdnFacturesTotal">0</strong><span>Documents enregistrés</span></article>
      </div>
      <div class="rdn-dashboard-columns">
        <section class="rdn-panel"><h3>Prochaines excursions</h3><div id="rdnUpcomingTrips" class="rdn-table-wrap"></div></section>
        <section class="rdn-panel"><h3>Suivi des réservations</h3><div id="rdnReservationSummary"></div></section>
      </div>
      <section class="rdn-panel rdn-finance-panel" id="rdnFinancePanel">
        <h3>Suivi des encaissements</h3>
        <div class="rdn-finance-meta"><span>Montant encaissé</span><strong id="rdnCollectionRate">0 %</strong></div>
        <div class="rdn-progress-track"><div id="rdnCollectionBar" class="rdn-progress-fill"></div></div>
        <p id="rdnCollectionCaption" class="rdn-finance-caption">Aucune facture enregistrée</p>
      </section>
      <section id="rdnAuditPanel" class="rdn-panel hidden">
        <div class="rdn-audit-heading"><div><h3>Journal des actions</h3><p>Historique des créations, modifications et suppressions</p></div><div class="rdn-audit-tools"><span class="rdn-role-badge admin">ADMIN</span><button id="rdnClearAudit" type="button" class="rdn-clear-audit">Vider le journal</button></div></div>
        <div id="rdnAuditList"></div>
      </section>
      <p id="rdnDashboardUpdated" class="rdn-updated"></p>`;
    const stats = dashboard.querySelector(".stats");
    if (stats) stats.insertAdjacentElement("afterend", host);
    else dashboard.append(host);
  }

  applyRoleAccess();
  renderProDashboard();
}

function formatAr(value) {
  return (Number(value) || 0).toLocaleString("fr-FR") + " Ar";
}

function parseDateRDN(value) {
  const text = String(value || "").trim();
  let match = text.match(/^(\d{2})[\/.-](\d{2})[\/.-](\d{4})$/);
  if (match) return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function renderProDashboard() {
  const host = document.getElementById("rdnProDashboard");
  if (!host) return;

  const admin = isAdmin();
  applyRoleAccess();
  const reservationEntries = Object.entries(dataCache.reservations || {});
  const reservations = reservationEntries.map(([id, record]) => ({ ...record, _key: id }));
  const invoices = admin ? Object.values(dataCache.factures || {}) : [];
  const expenses = admin ? Object.values(dataCache.depenses || {}) : [];
  const invoicedReservationIds = new Set(invoices.map(i => String(i.reservationId || "")).filter(Boolean));

  const activeReservations = reservations.filter(r =>
    !["annulée", "annulee", "annulé", "annule"].includes(String(r.statut || "").trim().toLowerCase())
  );
  const reservationsNotInvoiced = activeReservations.filter(r => !invoicedReservationIds.has(String(r._key)));
  const clientsTotalEl = document.getElementById("rdnClientsTotal");
  const reservationsTotalEl = document.getElementById("rdnReservationsTotal");
  const invoicesTotalEl = document.getElementById("rdnFacturesTotal");
  if (clientsTotalEl) clientsTotalEl.textContent = String(Object.keys(dataCache.clients || {}).length);
  if (reservationsTotalEl) reservationsTotalEl.textContent = String(activeReservations.length);
  if (invoicesTotalEl) invoicesTotalEl.textContent = String(Object.keys(dataCache.factures || {}).length);
  const reservationForecast = reservationsNotInvoiced.reduce((sum, r) => {
    const tripPrice = dataCache.excursions?.[r.excursionId]?.prix;
    const unitPrice = parseMontant(r.prixUnitaire || tripPrice);
    return sum + unitPrice * Math.max(1, Number(r.personnes) || 1);
  }, 0);

  const invoiceForecast = invoices.reduce((sum, i) => sum + parseMontant(i.montant), 0);
  const caPrevisionnel = reservationForecast + invoiceForecast;
  const invoicePaid = invoices.reduce((sum, i) => sum + parseMontant(i.acompte), 0);
  const reservationPaid = reservationsNotInvoiced
    .reduce((sum, r) => sum + parseMontant(r.acompte), 0);
  const caEncaisse = invoicePaid + reservationPaid;
  const depensesTotal = expenses.reduce((sum, d) => sum + parseMontant(d?.montant), 0);
  const soldes = invoices.reduce((sum, i) => sum + Math.max(0, parseMontant(i.montant) - parseMontant(i.acompte)), 0);
  const benefice = caPrevisionnel - depensesTotal;

  if (admin) {
    const values = {
      rdnCaEncaisse: caEncaisse,
      rdnCaPrevisionnel: caPrevisionnel,
      rdnDepensesTotal: depensesTotal,
      rdnBeneficePrevisionnel: benefice,
      rdnSoldesClients: soldes
    };
    Object.entries(values).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = formatAr(value);
    });
    const rate = caPrevisionnel > 0 ? Math.min(100, Math.round((caEncaisse / caPrevisionnel) * 100)) : 0;
    const rateEl = document.getElementById("rdnCollectionRate");
    const barEl = document.getElementById("rdnCollectionBar");
    const captionEl = document.getElementById("rdnCollectionCaption");
    if (rateEl) rateEl.textContent = rate + " %";
    if (barEl) barEl.style.width = rate + "%";
    if (captionEl) captionEl.textContent = caPrevisionnel > 0
      ? formatAr(caEncaisse) + " encaissés sur " + formatAr(caPrevisionnel) + " prévus"
      : "Aucune réservation ou facture à suivre";
  }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const trips = Object.entries(dataCache.excursions || {}).map(([id, x]) => {
    const date = parseDateRDN(x.date);
    const booked = reservations.filter(r => String(r.excursionId || "") === String(id) &&
      !["annulée", "annulee", "annulé", "annule"].includes(String(r.statut || "").trim().toLowerCase()))
      .reduce((n, r) => n + Math.max(1, Number(r.personnes) || 1), 0);
    return { id, title: x.titre || "Excursion", dateText: x.date || "Date non définie",
      date, booked, capacity: Math.max(0, Number(x.places) || 0) };
  }).filter(x => x.date && x.date >= today).sort((a, b) => a.date - b.date);

  const upcomingCount = document.getElementById("rdnExcursionsAVenir");
  if (upcomingCount) upcomingCount.textContent = String(trips.length);
  const upcoming = document.getElementById("rdnUpcomingTrips");
  if (upcoming) {
    upcoming.innerHTML = trips.length ? trips.slice(0, 6).map(t => `
      <div class="rdn-trip-row">
        <div><strong>${escapeHTML(t.title)}</strong><small>${escapeHTML(t.dateText)}</small></div>
        <span>${t.booked} ${t.capacity ? "/ " + t.capacity : ""} pers.</span>
      </div>`).join("") : '<p class="rdn-empty">Aucune excursion future avec une date reconnue.</p>';
  }

  const summary = document.getElementById("rdnReservationSummary");
  if (summary) {
    const pending = activeReservations.filter(r => /attente/i.test(String(r.statut || ""))).length;
    const confirmed = activeReservations.filter(r => /confirm/i.test(String(r.statut || ""))).length;
    const cancelled = reservations.length - activeReservations.length;
    summary.innerHTML = `
      <div class="rdn-summary-row"><span>Réservations actives</span><strong>${activeReservations.length}</strong></div>
      <div class="rdn-summary-row"><span>Confirmées</span><strong>${confirmed}</strong></div>
      <div class="rdn-summary-row"><span>En attente</span><strong>${pending}</strong></div>
      <div class="rdn-summary-row"><span>Annulées</span><strong>${cancelled}</strong></div>`;
  }

  const updated = document.getElementById("rdnDashboardUpdated");
  if (updated) updated.textContent = "Mis à jour : " + new Date().toLocaleString("fr-FR");
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}

async function clearAuditLogs() {
  if (!isAdmin() || !db) {
    alert("Cette action est réservée aux administrateurs.");
    return;
  }
  const button = document.getElementById("rdnClearAudit");
  if (button) button.disabled = true;
  try {
    // Lire le nœud complet : le listener d'affichage est volontairement limité
    // aux 100 dernières entrées, mais le bouton doit pouvoir vider tout l'historique.
    const snapshot = await db.ref("rdn/auditLogs").once("value");
    const allLogs = snapshot.val() || {};
    const entries = Object.keys(allLogs);
    if (!entries.length) {
      alert("Le journal est déjà vide.");
      return;
    }
    if (!confirm("Confirmer la suppression de tout le journal des actions (" + entries.length + " entrées) ? Cette action est irréversible.")) return;
    // Suppression enfant par enfant : compatible avec les Rules actuelles,
    // qui autorisent ADMIN à écrire/supprimer sous rdn/auditLogs/$logId.
    for (let index = 0; index < entries.length; index += 50) {
      await Promise.all(entries.slice(index, index + 50).map(id => db.ref("rdn/auditLogs/" + id).remove()));
    }
    alert("Le journal des actions a été vidé.");
  } catch (error) {
    alert("Impossible de vider complètement le journal : " + error.message);
  } finally {
    if (button) button.disabled = false;
  }
}

function startAuditSync() {
  if (!db || !currentUser || !isAdmin() || auditListener) return;
  const clearButton = document.getElementById("rdnClearAudit");
  if (clearButton && !clearButton.dataset.bound) {
    clearButton.dataset.bound = "1";
    clearButton.addEventListener("click", clearAuditLogs);
  }
  const ref = db.ref("rdn/auditLogs").limitToLast(100);
  const callback = snapshot => {
    auditLogsCache = snapshot.val() || {};
    renderAuditLogs();
  };
  ref.on("value", callback, error => {
    console.error("Lecture du journal d'audit impossible :", error);
    const list = document.getElementById("rdnAuditList");
    if (list) list.innerHTML = '<p class="rdn-empty">Accès au journal refusé. Vérifiez les règles Firebase.</p>';
  });
  auditListener = { ref, callback };
}

function stopAuditSync() {
  if (auditListener) auditListener.ref.off("value", auditListener.callback);
  auditListener = null;
  auditLogsCache = {};
}

function renderAuditLogs() {
  const list = document.getElementById("rdnAuditList");
  if (!list || !isAdmin()) return;
  const entries = Object.entries(auditLogsCache || {}).sort((a, b) =>
    (Number(b[1]?.timestamp) || 0) - (Number(a[1]?.timestamp) || 0)
  ).slice(0, 50);
  list.innerHTML = entries.length ? entries.map(([id, item]) => {
    const date = item.timestamp ? new Date(item.timestamp).toLocaleString("fr-FR") : "Date inconnue";
    const actions = { create: "Création", update: "Modification", delete: "Suppression", payment: "Paiement reçu", restore: "Restauration" };
    return `<div class="rdn-audit-row">
      <div><strong>${escapeHTML(actions[item.action] || item.action || "Action")}</strong>
      <span>${escapeHTML(item.module || "—")} · ${escapeHTML(item.recordLabel || "Élément")}</span>
      <small>${escapeHTML(item.actorEmail || item.actorName || "Utilisateur")} · ${escapeHTML(date)}</small></div>
    </div>`;
  }).join("") : '<p class="rdn-empty">Aucune action enregistrée pour le moment.</p>';
}

function injectProDashboardStyles() {
  if (document.getElementById("rdnProDashboardStyles")) return;
  const style = document.createElement("style");
  style.id = "rdnProDashboardStyles";
  style.textContent = `
    #rdnProDashboard{margin-top:22px}
    .rdn-dashboard-heading,.rdn-audit-heading{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin:18px 0 12px}
    .rdn-dashboard-heading h2{margin:4px 0;color:#244b35;font-size:22px}
    .rdn-eyebrow{font-size:10px;letter-spacing:1.5px;font-weight:800;color:#758879}
    .rdn-role-badge{padding:7px 11px;border-radius:30px;background:#edf1ed;color:#526257;font-size:11px;font-weight:800}
    .rdn-role-badge.admin{background:#e4f2e8;color:#1f6840}
    .rdn-kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(185px,1fr));gap:12px}
    .rdn-kpi,.rdn-panel{background:#fff;border:1px solid #e0e7df;border-radius:13px;padding:17px;box-shadow:0 3px 12px rgba(31,59,39,.04)}
    .rdn-kpi small{display:block;color:#68766c;font-size:12px;min-height:30px}
    .rdn-kpi strong{display:block;color:#244b35;font-size:clamp(19px,2.5vw,25px);margin:8px 0;overflow-wrap:anywhere}
    .rdn-kpi span{font-size:11px;color:#89938b}
    .rdn-dashboard-columns{display:grid;grid-template-columns:1.2fr 1fr;gap:14px;margin-top:14px}
    .rdn-panel{margin-top:14px}
    .rdn-panel h3{margin:0 0 13px;color:#244b35;font-size:16px}
    .rdn-trip-row,.rdn-summary-row,.rdn-audit-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:11px 0;border-top:1px solid #edf0ed}
    .rdn-trip-row:first-child,.rdn-summary-row:first-child,.rdn-audit-row:first-child{border-top:0}
    .rdn-trip-row strong,.rdn-audit-row strong{display:block;font-size:13px;color:#293b2e}
        .rdn-trip-row small,.rdn-audit-row small{display:block;margin-top:4px;color:#7a867d;font-size:11px}
    .rdn-trip-row>span,.rdn-summary-row strong{font-size:12px;font-weight:800;color:#315d40;white-space:nowrap}
    .rdn-audit-heading p{margin:4px 0 0;color:#778279;font-size:12px}
    .rdn-audit-row{justify-content:flex-start}
    .rdn-audit-row span{display:block;margin-top:4px;color:#58665c;font-size:12px}
    .rdn-audit-tools{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
    .rdn-clear-audit{border:1px solid #e5b7b7;background:#fff7f7;color:#a43b3b;border-radius:8px;padding:8px 11px;font-weight:700;font-size:11px;cursor:pointer}
    .rdn-clear-audit:disabled{opacity:.55;cursor:wait}
    .rdn-finance-meta{display:flex;justify-content:space-between;align-items:center;color:#637267;font-size:12px;margin:4px 0 9px}
    .rdn-finance-meta strong{color:#245638;font-size:17px}
    .rdn-progress-track{height:11px;background:#edf2ed;border-radius:20px;overflow:hidden}
    .rdn-progress-fill{height:100%;width:0;background:linear-gradient(90deg,#5d9c70,#247247);border-radius:20px;transition:width .35s ease}
    .rdn-finance-caption{font-size:11px;color:#7b887e;margin:9px 0 0}
    .rdn-empty,.rdn-updated{font-size:12px;color:#818c83}
    .rdn-updated{text-align:right;margin:12px 2px}
    @media(max-width:680px){.rdn-dashboard-columns{grid-template-columns:1fr}.rdn-kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.rdn-kpi{padding:13px}.rdn-kpi strong{font-size:17px}}
    @media(max-width:380px){.rdn-kpi-grid{grid-template-columns:1fr}}
  `;
  document.head.append(style);
}

const kinds = [
  "clients",
  "excursions",
  "reservations",
  "factures",
  "depenses"
];

const labels = {
  clients: ["nom", "telephone", "email"],
  excursions: ["titre", "date", "prix", "places"],
  reservations: ["client", "excursion", "personnes", "acompte", "statut"],
  factures: ["numero", "client", "objet", "montant"],
  depenses: ["libelle", "categorie", "montant", "date", "typeDepense", "excursionId"]
};

// ===== CONFIGURATION FIREBASE =====

function configured() {
  return firebaseConfig.apiKey &&
    !firebaseConfig.apiKey.startsWith("VOTRE_") &&
    firebaseConfig.appId &&
    !firebaseConfig.appId.startsWith("VOTRE_");
}

function parseMontant(value) {
  if (value === null || value === undefined) return 0;
  const montant = String(value).replace(/[^\d-]/g, "");
  return Number(montant) || 0;
}

// ===== CAPITALISATION CLIENTS / EXCURSIONS / RÉSERVATIONS =====

function capitaliserNom(texte) {
  return String(texte || "")
    .trim()
    .toLocaleLowerCase("fr")
    .replace(/(^|[\s'-])(\p{L})/gu, (match, separateur, lettre) =>
      separateur + lettre.toLocaleUpperCase("fr")
    );
}

function capitaliserLabel(texte) {
  return texte.charAt(0).toLocaleUpperCase("fr") + texte.slice(1);
}

// ===== INITIALISATION =====

function init() {
  if (!configured()) {
    $("loginMsg").textContent =
      "Configuration Firebase incomplète : ajoutez apiKey, messagingSenderId et appId dans firebase-config.js.";
    return;
  }

  firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();
  db = firebase.database();

  auth.onAuthStateChanged(u => {
    const previousUid = currentUser?.uid || null;
    const nextUid = u?.uid || null;
    if (previousUid && previousUid !== nextUid) {
      stopRealtimeSync();
      stopAuditSync();
      resetLocalData();
    }
    currentUser = u;
    if (u && !isAdmin() && !isAgent()) {
      const loginMessage = $("loginMsg");
      if (loginMessage) loginMessage.textContent = "Ce compte n'est pas autorisé à accéder à RDN GESTION.";
      auth.signOut();
      return;
    }

    $("login").classList.toggle("hidden", !!u);
    $("app").classList.toggle("hidden", !u);

    if (u) {
      injectProDashboardStyles();
      ensureProDashboard();
      applyRoleAccess();
      startRealtimeSync();
      startAuditSync();
      updateInvoiceNumberPreview();
    } else {
      stopRealtimeSync();
      stopAuditSync();
      resetLocalData();
      ensureProDashboard();
      applyRoleAccess();
      refreshStats();
    }
  });
}

// ===== CONNEXION =====

$("loginBtn").onclick = async () => {
  try {
    await auth.signInWithEmailAndPassword(
      $("email").value.trim(),
      $("password").value
    );
  } catch (e) {
    $("loginMsg").textContent = "Connexion impossible : " + e.message;
  }
};

$("logoutBtn").onclick = () => auth.signOut();

// ===== NAVIGATION =====

document.querySelectorAll("nav button").forEach(b => {
  b.onclick = () => {
    document.querySelectorAll("nav button").forEach(x =>
      x.classList.remove("active")
    );

    b.classList.add("active");

    document.querySelectorAll(".page").forEach(p =>
      p.classList.add("hidden")
    );

    $(b.dataset.page).classList.remove("hidden");

    if (b.dataset.page === "factures") {
      updateInvoiceNumberPreview();
    }
  };
});

// ===== ENREGISTREMENT DES AUTRES MODULES =====

document.querySelectorAll("form[data-kind]").forEach(f => {
  f.onsubmit = async e => {
    e.preventDefault();
    if (!db || !currentUser) { alert("Veuillez vous connecter avant d'enregistrer."); return; }
    if (!firebaseConnected) { alert("Connexion Firebase indisponible. Attendez le retour de la connexion avant d'enregistrer pour éviter une opération non confirmée."); return; }
    if (f.dataset.kind === "depenses" && !isAdmin()) {
      alert("Accès réservé aux administrateurs.");
      return;
    }
    if (savingGenericForm) return;
    const isReservationForm = f.dataset.kind === "reservations";
    const reservationSubmit = isReservationForm ? f.querySelector('button[type="submit"], button:not([type])') : null;
    if (isReservationForm) {
      savingGenericForm = true;
      if (reservationSubmit) reservationSubmit.disabled = true;
    }
    const obj = {};
    new FormData(f).forEach((v,k) => { obj[k]=v; });
    if (f.dataset.kind === "clients") {
      if (!cacheReady.clients) {
        alert("Attendez la synchronisation de la base Clients avant d'ajouter une fiche.");
        return;
      }
      obj.nom = capitaliserNom(obj.nom);
      const newPhone = normalizePhoneRDN(obj.telephone);
      const newName = String(obj.nom || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr");
      const duplicate = Object.entries(dataCache.clients || {}).find(([id, c]) => {
        const oldPhone = normalizePhoneRDN(c?.telephone);
        const oldName = String(c?.nom || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr");
        return (newPhone && oldPhone && newPhone === oldPhone) ||
          ((!newPhone || !oldPhone) && newName && oldName === newName);
      });
      if (duplicate) {
        alert("Ce client existe déjà dans la base Clients : " + (duplicate[1].nom || "Client") + ". Utilisez sa fiche existante au lieu d'en créer une deuxième.");
        return;
      }
    }

if (f.dataset.kind === "excursions") {
  obj.titre = capitaliserNom(obj.titre);
}
    // 

    let clientCreatedAutomatically = false;
    if (f.dataset.kind === "reservations") {
      if (!cacheReady.clients || !cacheReady.excursions) {
        alert("Attendez le chargement des clients et des excursions, puis réessayez.");
        savingGenericForm = false; if (reservationSubmit) reservationSubmit.disabled = false;
        return;
      }
      const nomSaisi = capitaliserNom(obj.clientNom);
      const telephoneSaisi = String(obj.clientTelephone || "").trim();
      const nomCle = nomSaisi.toLocaleLowerCase("fr").replace(/\s+/g, " ");
      const telCle = normalizePhoneRDN(telephoneSaisi);
      if (!nomSaisi) {
        alert("Le nom du client est obligatoire.");
        savingGenericForm = false; if (reservationSubmit) reservationSubmit.disabled = false;
        return;
      }
      const excursion = dataCache.excursions[obj.excursionId];
      if (!excursion) {
        alert("Veuillez choisir une excursion valide.");
        savingGenericForm = false; if (reservationSubmit) reservationSubmit.disabled = false;
        return;
      }
      const capacity = Math.max(0, Number(excursion.places) || 0);
      const alreadyBooked = Object.values(dataCache.reservations || {}).filter(r =>
        String(r?.excursionId || "") === String(obj.excursionId) &&
        !["annulée", "annulee", "annulé", "annule"].includes(String(r?.statut || "").trim().toLowerCase())
      ).reduce((sum, r) => sum + Math.max(1, Number(r?.personnes) || 1), 0);
      const requestedPlaces = Math.max(1, Number(obj.personnes) || 1);
      if (capacity > 0 && alreadyBooked + requestedPlaces > capacity) {
        alert("Cette excursion n'a plus assez de places disponibles.");
        savingGenericForm = false; if (reservationSubmit) reservationSubmit.disabled = false;
        return;
      }

      // Transaction sur le nœud clients : évite les doublons même si deux
      // réservations sont enregistrées presque simultanément.
      const clientsRef = db.ref("rdn/clients");
      const proposedClientId = clientsRef.push().key;
      const proposedClient = {
        nom: nomSaisi, telephone: telephoneSaisi, email: "",
        createdAt: Date.now(), createdBy: currentUser.uid,
        createdByEmail: currentUser.email || "", origine: "reservation"
      };
      let clientTx;
      try {
      clientTx = await clientsRef.transaction(records => {
        const all = records || {};
        const entries = Object.entries(all);
        let found = null;
        if (telCle) {
          found = entries.find(([id, c]) => normalizePhoneRDN(c?.telephone) === telCle);
          // Sans correspondance téléphone, ne réutiliser le nom que si l'ancienne
          // fiche ne possède pas encore de téléphone : deux homonymes peuvent exister.
          if (!found) found = entries.find(([id, c]) =>
            !normalizePhoneRDN(c?.telephone) &&
            String(c?.nom || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr") === nomCle
          );
        } else {
          found = entries.find(([id, c]) =>
            String(c?.nom || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr") === nomCle
          );
        }
        if (found) {
          const [foundId, foundClient] = found;
          if (telephoneSaisi && !foundClient.telephone) {
            all[foundId] = { ...foundClient, telephone: telephoneSaisi, updatedAt: Date.now(), updatedBy: currentUser.uid };
          }
          return all;
        }
        all[proposedClientId] = proposedClient;
        return all;
      }, undefined, false);
      } catch (clientError) {
        savingGenericForm = false; if (reservationSubmit) reservationSubmit.disabled = false;
        alert("Vérification de la fiche client impossible : " + clientError.message);
        return;
      }
      if (!clientTx.committed && !clientTx.snapshot.exists()) {
        savingGenericForm = false; if (reservationSubmit) reservationSubmit.disabled = false;
        alert("Impossible de vérifier ou créer la fiche client.");
        return;
      }
      const clientsAfter = clientTx.snapshot.val() || {};
      let clientEntry = telCle ? Object.entries(clientsAfter).find(([id,c]) => normalizePhoneRDN(c?.telephone) === telCle) : null;
      if (!clientEntry) clientEntry = Object.entries(clientsAfter).find(([id,c]) =>
        (!telCle || !normalizePhoneRDN(c?.telephone)) &&
        String(c?.nom || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr") === nomCle
      );
      if (!clientEntry) {
        savingGenericForm = false; if (reservationSubmit) reservationSubmit.disabled = false;
        alert("La fiche client n'a pas pu être confirmée dans Firebase.");
        return;
      }
      const [clientId, client] = clientEntry;
      clientCreatedAutomatically = String(clientId) === String(proposedClientId);

      obj.client = client.nom || nomSaisi;
      obj.clientTelephone = telephoneSaisi || client.telephone || "";
      obj.clientId = String(clientId);
     // obj.excursion = excursion.titre || "";
      obj.excursion = capitaliserNom(excursion.titre || "");


      obj.excursionDate = excursion.date || "";
      obj.prixUnitaire = parseMontant(excursion.prix);
      obj.excursionId = String(obj.excursionId);
      delete obj.clientNom;
      obj.personnes = Math.max(1, Number(obj.personnes) || 1);
      obj.acompte = parseMontant(obj.acompte);
    }
    if (f.dataset.kind === "depenses") {
      if (!cacheReady.excursions) {
        alert("Attendez le chargement des excursions, puis réessayez.");
        return;
      }
      obj.typeDepense = obj.typeDepense === "voyage" ? "voyage" : "generale";
      if (obj.typeDepense === "voyage") {
        const excursion = dataCache.excursions[obj.excursionId];
        if (!obj.excursionId || !excursion) {
          alert("Veuillez choisir l'excursion concernée par cette dépense.");
          return;
        }
        obj.excursionId = String(obj.excursionId);
        obj.excursion = excursion.titre || "";
        obj.excursionDate = excursion.date || "";
      } else {
        obj.excursionId = "";
        obj.excursion = "";
        obj.excursionDate = "";
      }
      obj.montant = parseMontant(obj.montant);
    }
    obj.createdAt=Date.now(); obj.createdBy=currentUser.uid; obj.createdByEmail=currentUser.email||"";
    savingGenericForm=true;
    const submit=f.querySelector('button[type="submit"], button:not([type])'); if(submit) submit.disabled=true;
    try {
      let newRef;
      if (f.dataset.kind === "reservations") {
        // Transaction sur le nœud Réservations : contrôle de capacité côté Firebase
        // pour éviter que deux agents attribuent simultanément la dernière place.
        const reservationsRef = db.ref("rdn/reservations");
        newRef = reservationsRef.push();
        const capacityTx = await reservationsRef.transaction(records => {
          const all = records || {};
          const trip = dataCache.excursions?.[obj.excursionId];
          if (!trip) return;
          const capacity = Math.max(0, Number(trip.places) || 0);
          const occupied = Object.values(all).filter(r =>
            String(r?.excursionId || "") === String(obj.excursionId) &&
            !["annulée", "annulee", "annulé", "annule"].includes(String(r?.statut || "").trim().toLowerCase())
          ).reduce((sum, r) => sum + Math.max(1, Number(r?.personnes) || 1), 0);
          if (capacity > 0 && occupied + obj.personnes > capacity) return;
          all[newRef.key] = obj;
          return all;
        }, undefined, false);
        if (!capacityTx.committed) {
          const trip = dataCache.excursions?.[obj.excursionId];
          const capacity = Math.max(0, Number(trip?.places) || 0);
          throw new Error(capacity > 0 ? "Nombre de places insuffisant : cette excursion est complète ou presque complète." : "La réservation n'a pas pu être confirmée dans Firebase.");
        }
      } else {
        newRef = db.ref("rdn/"+f.dataset.kind).push();
        await newRef.set(obj);
      }
      if (f.dataset.kind === "reservations" && clientCreatedAutomatically) {
        await auditSafely("create", "clients", obj.clientId, dataCache.clients[obj.clientId] || { nom: obj.client, telephone: obj.clientTelephone }, "Client créé automatiquement depuis une réservation");
      }
      await auditSafely("create", f.dataset.kind, newRef.key, obj, "Nouvel enregistrement");
      f.reset();
      if(f.dataset.kind==="reservations" && f.elements.personnes) f.elements.personnes.value=1;
      alert("Enregistrement effectué avec succès !");
    } catch(err) {
      if (f.dataset.kind === "reservations" && clientCreatedAutomatically && obj.clientId) {
        try {
          const linked = await db.ref("rdn/reservations").orderByChild("clientId").equalTo(String(obj.clientId)).once("value");
          if (!linked.exists()) await db.ref("rdn/clients/" + obj.clientId).remove();
        } catch (cleanupError) { console.warn("Nettoyage client automatique différé :", cleanupError); }
      }
      alert("Erreur d'enregistrement : "+err.message);
    }
    finally { savingGenericForm=false; if(submit) submit.disabled=false; }
  };
});

// ===== SYNCHRONISATION TEMPS RÉEL =====
function updateSyncStatus() {
  const status = document.getElementById("syncStatus");
  if (!status) return;
  if (!currentUser) {
    status.textContent = "Déconnecté";
    status.dataset.state = "offline";
    return;
  }
  if (!firebaseConnected) {
    status.textContent = "Hors ligne — synchronisation en attente";
    status.dataset.state = "offline";
    return;
  }
  const required = kinds.filter(kind => !(kind === "depenses" && !isAdmin()));
  const failed = required.filter(kind => moduleSyncState[kind] === "error");
  if (failed.length) {
    status.textContent = "Erreur de synchronisation : " + failed.join(", ");
    status.dataset.state = "error";
    return;
  }
  const ready = required.every(kind => cacheReady[kind] && moduleSyncState[kind] === "ready");
  status.textContent = ready ? "Connecté • données synchronisées" : "Connecté • synchronisation en cours…";
  status.dataset.state = ready ? "online" : "syncing";
}

function startConnectionMonitor() {
  if (!db || connectionListener) return;
  const ref = db.ref(".info/connected");
  const callback = snapshot => {
    firebaseConnected = snapshot.val() === true;
    updateSyncStatus();
  };
  ref.on("value", callback);
  connectionListener = { ref, callback };
}

function stopConnectionMonitor() {
  if (connectionListener) connectionListener.ref.off("value", connectionListener.callback);
  connectionListener = null;
  firebaseConnected = false;
  updateSyncStatus();
}

function resetLocalData() {
  kinds.forEach(kind => {
    dataCache[kind] = {};
    cacheReady[kind] = false;
    moduleSyncState[kind] = "idle";
    renderKind(kind);
  });
  refreshStats();
  renderTripBalances();
}

function startRealtimeSync() {
  if(!db||!currentUser) return;
  startConnectionMonitor();
  activeSyncUid = currentUser.uid;
  kinds.forEach(kind=>{
    // Les AGENTS ne lisent jamais le nœud financier rdn/depenses.
    if (kind === "depenses" && !isAdmin()) {
      dataCache.depenses = {};
      cacheReady.depenses = false;
      moduleSyncState.depenses = "ignored";
      renderKind("depenses");
      return;
    }
    if(dbListeners[kind]) return;
    const ref=db.ref("rdn/"+kind);
    const callback=snapshot=>{
      dataCache[kind]=snapshot.val()||{};
      cacheReady[kind] = true;
      moduleSyncState[kind] = "ready";
      renderKind(kind); refreshStats();
      if(kind==="clients") refreshClientSuggestions();
      if(kind==="excursions") { refreshReservationChoices(); refreshExpenseExcursionChoices(); }
      if(kind==="reservations" || kind==="depenses" || kind==="excursions") renderTripBalances();
      if(kind==="factures") updateInvoiceNumberPreview();
      updateSyncStatus();
    };
    ref.on("value", callback, error => {
      console.error("Synchronisation " + kind + " impossible :", error);
      // Une permission refusée annule le listener Firebase. On le retire aussi
      // du cache local afin qu'une reconnexion puisse relancer proprement la lecture.
      ref.off("value", callback);
      delete dbListeners[kind];
      cacheReady[kind] = false;
      dataCache[kind] = {};
      moduleSyncState[kind] = "error";
      renderKind(kind);
      refreshStats();
      renderTripBalances();
      updateSyncStatus();
    });
    dbListeners[kind]={ref,callback};
  });
}
function stopRealtimeSync() {
  Object.values(dbListeners).forEach(({ref,callback})=>ref.off("value",callback));
  Object.keys(dbListeners).forEach(k=>delete dbListeners[k]);
  activeSyncUid = null;
  stopConnectionMonitor();
  updateSyncStatus();
}
function load(kind) { renderKind(kind); }
function renderKindBaseImplementation(kind) {
  const host=$("list-"+kind); if(!host) return;
  host.innerHTML="";
  if (kind === "depenses" && !isAdmin()) return;
  Object.entries(dataCache[kind]||{}).sort((a,b)=>(Number(b[1]?.createdAt)||0)-(Number(a[1]?.createdAt)||0)).forEach(([id,o])=>{
    if(kind==="factures"){renderInvoiceCard(host,id,o);return;}
    if(kind==="depenses"){renderExpenseCard(host,id,o);return;}
    const div=document.createElement("div"); div.className="item";

    //const main=(labels[kind]||[]).map(k=>o[k]!==undefined&&o[k]!==""?`${k}: ${o[k]}`:"").filter(Boolean).join(" • ");
    const main = (labels[kind] || [])
  .map(k => {
    if (o[k] === undefined || o[k] === "") return "";

    let valeur = o[k];

    if (
      (kind === "clients" && k === "nom") ||
      (kind === "excursions" && k === "titre") ||
      (kind === "reservations" && (k === "client" || k === "excursion"))
    ) {
      valeur = capitaliserNom(valeur);
    }

    return `${capitaliserLabel(k)}: ${valeur}`;
  })
  .filter(Boolean)
  .join(" • ");

    // farany 


    const left=document.createElement("span"); left.textContent=main||"(Sans détail)";
    const right=document.createElement("small"); right.textContent=new Date(Number(o.createdAt)||Date.now()).toLocaleDateString("fr-FR");
    const actions=document.createElement("div"); actions.className="record-actions";
    const edit=document.createElement("button"); edit.type="button"; edit.className="record-edit"; edit.textContent="Modifier"; edit.onclick=()=>editRecord(kind,id,o);
    const del=document.createElement("button"); del.type="button"; del.className="record-delete"; del.textContent="Supprimer"; del.onclick=()=>deleteRecord(kind,id,o);
    actions.append(edit,del); div.append(left,right,actions);
    if(kind==="reservations") {
      const inv=document.createElement("button"); inv.type="button"; inv.className="record-invoice";
      const existingInvoice = Object.values(dataCache.factures || {}).find(f => String(f.reservationId || "") === String(id));
      inv.textContent = existingInvoice ? "Facture déjà créée" : "Préparer une facture";
      inv.disabled = !!existingInvoice;
      if (existingInvoice) inv.title = "Une facture est déjà associée à cette réservation.";
      inv.onclick=()=>prepareInvoiceFromReservation({...o,id}); div.append(inv);
    }
    host.append(div);
  });
  if(kind==="reservations") refreshReservationChoices();
}
function refreshStats() {
  [["clients","nClients"],["excursions","nExcursions"],["reservations","nReservations"]].forEach(([k,id])=>{const el=$(id);if(el)el.textContent=Object.keys(dataCache[k]||{}).length;});
  if (isAdmin()) {
    const total=Object.values(dataCache.depenses||{}).reduce((sum,d)=>sum+parseMontant(d?.montant),0);
    const el=$("sumDepenses"); if(el)el.textContent=total.toLocaleString("fr-FR")+" Ar";
  }
  applyRoleAccess();
  renderTripBalances();
  renderProDashboard();
}

// ===== DÉPENSES PAR VOYAGE / DÉPENSES GÉNÉRALES =====
function refreshExpenseExcursionChoices() {
  const form = document.querySelector('form[data-kind="depenses"]');
  if (!form || !form.elements.excursionId) return;
  const select = form.elements.excursionId;
  const previous = select.value;
  select.innerHTML = '<option value="">Choisir une excursion</option>';
  Object.entries(dataCache.excursions || {}).forEach(([id, x]) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = [x.titre || "Excursion", x.date || ""].filter(Boolean).join(" — ");
    select.append(option);
  });
  if (previous && dataCache.excursions[previous]) select.value = previous;
  toggleExpenseExcursionField();
}
function toggleExpenseExcursionField() {
  const form = document.querySelector('form[data-kind="depenses"]');
  if (!form) return;
  const type = form.elements.typeDepense?.value || "generale";
  const wrap = document.getElementById("expenseExcursionWrap");
  const select = form.elements.excursionId;
  if (wrap) wrap.classList.toggle("hidden", type !== "voyage");
  if (select) select.required = type === "voyage";
}
function expenseMoney(value) { return parseMontant(value).toLocaleString("fr-FR") + " Ar"; }
function renderExpenseCard(host, id, o) {
  if (!isAdmin()) return;
  const div = document.createElement("div"); div.className = "item";
  const legacy = !o.typeDepense;
  const kind = legacy ? "Ancienne dépense (non classée)" : (o.typeDepense === "voyage" ? "Dépense par voyage" : "Dépense générale");
  const trip = o.typeDepense === "voyage" ? (o.excursion || dataCache.excursions[o.excursionId]?.titre || "Excursion") : "";
  const main = document.createElement("span");
  main.textContent = `${o.libelle || "Dépense"} • ${expenseMoney(o.montant)} • ${kind}${trip ? " • " + trip : ""}${o.categorie ? " • " + o.categorie : ""}`;
  const date = document.createElement("small"); date.textContent = o.date || new Date(Number(o.createdAt)||Date.now()).toLocaleDateString("fr-FR");
  const actions = document.createElement("div"); actions.className = "record-actions";
  const edit = document.createElement("button"); edit.type="button"; edit.className="record-edit"; edit.textContent="Modifier"; edit.onclick=()=>editExpenseRecord(id,o);
  const del = document.createElement("button"); del.type="button"; del.className="record-delete"; del.textContent="Supprimer"; del.onclick=()=>deleteRecord("depenses",id,o);
  actions.append(edit,del); div.append(main,date,actions); host.append(div);
}
async function editExpenseRecord(id, record) {
  if (!isAdmin()) { alert("Accès réservé aux administrateurs."); return; }
  const updated = {...record};
  for (const field of ["libelle","categorie","montant","date"]) {
    const value = prompt("Modifier " + field + " :", record[field] == null ? "" : String(record[field]));
    if (value === null) return;
    updated[field] = value.trim();
  }
  const type = prompt("Type de dépense : générale ou voyage ?", record.typeDepense === "voyage" ? "voyage" : "generale");
  if (type === null) return;
  updated.typeDepense = type.trim().toLowerCase().startsWith("v") ? "voyage" : "generale";
  if (updated.typeDepense === "voyage") {
    const trips = Object.entries(dataCache.excursions || {});
    if (!trips.length) { alert("Aucune excursion disponible."); return; }
    const options = trips.map(([key,x],i)=>`${i+1}. ${x.titre||"Excursion"} ${x.date||""}`).join("\n");
    const oldIndex = trips.findIndex(([key])=>key===record.excursionId);
    const choice = prompt("Choisir le numéro de l'excursion :\n"+options, String(Math.max(1,oldIndex+1)));
    if (choice === null) return;
    const trip = trips[Number(choice)-1]; if (!trip) { alert("Choix d'excursion invalide."); return; }
    updated.excursionId=trip[0]; updated.excursion=trip[1].titre||""; updated.excursionDate=trip[1].date||"";
  } else { updated.excursionId=""; updated.excursion=""; updated.excursionDate=""; }
  updated.montant = parseMontant(updated.montant);
  updated.updatedAt=Date.now(); updated.updatedBy=currentUser?.uid||"";
  try {
    await db.ref("rdn/depenses/"+id).update(updated);
    await auditSafely("update", "depenses", id, updated, "Dépense modifiée");
  } catch(e) { alert("Modification impossible : "+e.message); }
}
function renderTripBalances() {
  const host = document.getElementById("tripBalances");
  if (!host) return;
  host.innerHTML = "";
  if (!isAdmin()) {
    host.classList.add("hidden");
    return;
  }
  host.classList.remove("hidden");

  Object.entries(dataCache.excursions || {}).forEach(([id, trip]) => {
    const reservations = Object.values(dataCache.reservations || {}).filter(r =>
      String(r.excursionId || "") === String(id) &&
      !["annulée", "annulee"].includes(String(r.statut || "").toLowerCase())
    );
    const forecastRevenue = reservations.reduce((sum, r) =>
      sum + parseMontant(r.prixUnitaire || trip.prix) * Math.max(1, Number(r.personnes) || 1), 0
    );

    // Seules les dépenses explicitement rattachées à cette excursion entrent dans son bilan.
    const tripExpenses = Object.entries(dataCache.depenses || {}).filter(([expenseId, d]) =>
      d && d.typeDepense === "voyage" && String(d.excursionId || "") === String(id)
    );
    const expenses = tripExpenses.reduce((sum, [expenseId, d]) => sum + parseMontant(d.montant), 0);
    const profit = forecastRevenue - expenses;

    const card = document.createElement("article");
    card.className = "trip-balance-card";
    const title = document.createElement("h3");
    title.textContent = trip.titre || "Excursion";
    const date = document.createElement("small");
    date.textContent = trip.date || "Date non définie";

    const stats = document.createElement("div");
    stats.className = "trip-balance-stats";
    [["Dépenses totales", expenses], ["CA prévisionnel", forecastRevenue], ["Bénéfice prévisionnel", profit]].forEach(([label, value]) => {
      const item = document.createElement("div");
      const name = document.createElement("small");
      name.textContent = label;
      const amount = document.createElement("strong");
      amount.textContent = expenseMoney(value);
      item.append(name, amount);
      stats.append(item);
    });

    const expenseHeading = document.createElement("h4");
    expenseHeading.className = "trip-expenses-heading";
    expenseHeading.textContent = `Dépenses de cette excursion (${tripExpenses.length})`;
    const expenseList = document.createElement("div");
    expenseList.className = "trip-expenses-list";

    if (tripExpenses.length) {
      tripExpenses
        .sort((a, b) => String(b[1].date || "").localeCompare(String(a[1].date || "")))
        .forEach(([expenseId, d]) => {
          const row = document.createElement("div");
          row.className = "trip-expense-row";
          const detail = document.createElement("span");
          detail.textContent = [d.libelle || "Dépense", d.categorie || "", d.date || ""].filter(Boolean).join(" • ");
          const amount = document.createElement("strong");
          amount.textContent = expenseMoney(d.montant);
          row.append(detail, amount);
          expenseList.append(row);
        });
    } else {
      const empty = document.createElement("p");
      empty.className = "trip-expenses-empty";
      empty.textContent = "Aucune dépense enregistrée pour cette excursion.";
      expenseList.append(empty);
    }

    const formula = document.createElement("p");
    formula.className = "form-hint";
    formula.textContent = `CA calculé sur ${reservations.reduce((n, r) => n + Math.max(1, Number(r.personnes) || 1), 0)} personne(s) réservée(s), hors réservations annulées. Les dépenses générales ne sont pas incluses dans ce bilan.`;

    card.append(title, date, stats, expenseHeading, expenseList, formula);
    host.append(card);
  });
}

// ===== LIAISON CLIENTS / EXCURSIONS / RÉSERVATIONS =====
function refreshReservationChoices() {
  const form = document.querySelector('form[data-kind="reservations"]');
  if (!form) return;
  const select = form.elements.excursionId;
  if (!select) return;
  const previous = select.value;
  select.innerHTML = '<option value="">Choisir une excursion</option>';
  Object.entries(dataCache.excursions || {}).forEach(([id, x]) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = [x.titre || "Excursion", x.date || "",
      x.prix ? parseMontant(x.prix).toLocaleString("fr-FR") + " Ar" : ""
    ].filter(Boolean).join(" — ");
    select.append(option);
  });
  if (previous && dataCache.excursions[previous]) select.value = previous;
}
function refreshClientSuggestions() {
  const list = document.getElementById("clientsSuggestions");
  if (!list) return;
  list.innerHTML = "";
  Object.values(dataCache.clients || {}).forEach(client => {
    const option = document.createElement("option");
    option.value = client.nom || "";
    if (client.telephone) option.label = client.telephone;
    list.append(option);
  });
}

async function editRecord(kind,id,record) {
  if (!db || !currentUser || !firebaseConnected) { alert("Connexion Firebase indisponible. Réessayez lorsque la connexion sera rétablie."); return; }
  const updated={...record};
  if(kind==="reservations") {
    const linkedInvoice = Object.values(dataCache.factures || {}).find(invoice => String(invoice.reservationId || "") === String(id));
    if (linkedInvoice) {
      const status = prompt("Cette réservation est déjà facturée. Seul son statut peut être modifié (En attente, Confirmée, Annulée) :", record.statut || "Confirmée");
      if (status === null) return;
      if (["annulée", "annulee"].includes(status.trim().toLocaleLowerCase("fr"))) {
        alert("Cette réservation possède une facture. Son annulation nécessite une procédure comptable dédiée.");
        return;
      }
      updated.statut = status.trim();
      updated.updatedAt = Date.now();
      updated.updatedBy = currentUser?.uid || "";
      try {
        await db.ref("rdn/reservations/" + id).update({ statut: updated.statut, updatedAt: updated.updatedAt, updatedBy: updated.updatedBy });
        await auditSafely("update", kind, id, updated, "Statut modifié après facturation");
      } catch (error) { alert("Modification impossible : " + error.message); }
      return;
    }
    const clients=Object.entries(dataCache.clients||{});
    const excursions=Object.entries(dataCache.excursions||{});
    if(!clients.length||!excursions.length){alert("Ajoutez au moins un client et une excursion avant de modifier cette réservation.");return;}
    const clientList=clients.map(([key,c],i)=>`${i+1}. ${c.nom||"Client"}`).join("\n");
    const clientChoice=prompt("Choisir le numéro du client :\n"+clientList,String(Math.max(1,clients.findIndex(([key])=>key===record.clientId)+1)));
    if(clientChoice===null)return;
    const client=clients[Number(clientChoice)-1]; if(!client){alert("Numéro de client invalide.");return;}
    const excursionList=excursions.map(([key,x],i)=>`${i+1}. ${x.titre||"Excursion"} ${x.date||""}`).join("\n");
    const excursionChoice=prompt("Choisir le numéro de l'excursion :\n"+excursionList,String(Math.max(1,excursions.findIndex(([key])=>key===record.excursionId)+1)));
    if(excursionChoice===null)return;
    const excursion=excursions[Number(excursionChoice)-1]; if(!excursion){alert("Numéro d'excursion invalide.");return;}
    updated.clientId=client[0]; updated.client=client[1].nom||""; updated.clientTelephone=client[1].telephone||"";
    updated.excursionId=excursion[0]; updated.excursion=excursion[1].titre||"";
    updated.excursionDate=excursion[1].date||""; updated.prixUnitaire=parseMontant(excursion[1].prix);
    for(const field of ["personnes","acompte","statut"]){const value=prompt("Modifier "+field+" :",record[field]==null?"":String(record[field]));if(value===null)return;updated[field]=value.trim();}
    updated.personnes=Math.max(1,Number(updated.personnes)||1); updated.acompte=parseMontant(updated.acompte);
  } else {
    for(const field of (labels[kind]||[])){const value=prompt("Modifier "+field+" :",record[field]==null?"":String(record[field]));if(value===null)return;updated[field]=value.trim();}
  }
  if (kind === "excursions") {
    const booked = Object.values(dataCache.reservations || {}).filter(r =>
      String(r.excursionId || "") === String(id) &&
      !["annulée", "annulee", "annulé", "annule"].includes(String(r.statut || "").trim().toLowerCase())
    ).reduce((sum, r) => sum + Math.max(1, Number(r.personnes) || 1), 0);
    updated.places = Math.max(0, Number(updated.places) || 0);
    updated.prix = parseMontant(updated.prix);
    if (updated.places > 0 && updated.places < booked) {
      alert("Impossible de réduire la capacité sous le nombre de participants déjà réservés (" + booked + ").");
      return;
    }
  }
  updated.updatedAt=Date.now(); updated.updatedBy=currentUser?.uid||"";
  try {
    if (kind === "reservations") {
      const reservationsRef = db.ref("rdn/reservations");
      const tx = await reservationsRef.transaction(records => {
        const all = records || {};
        const trip = dataCache.excursions?.[updated.excursionId];
        if (!trip || !all[id]) return;
        const capacity = Math.max(0, Number(trip.places) || 0);
        const bookedOthers = Object.entries(all).filter(([otherId, r]) =>
          otherId !== String(id) && String(r?.excursionId || "") === String(updated.excursionId) &&
          !["annulée", "annulee", "annulé", "annule"].includes(String(r?.statut || "").trim().toLowerCase())
        ).reduce((sum, [, r]) => sum + Math.max(1, Number(r?.personnes) || 1), 0);
        const requested = ["annulée", "annulee", "annulé", "annule"].includes(String(updated.statut || "").trim().toLowerCase()) ? 0 : Math.max(1, Number(updated.personnes) || 1);
        if (capacity > 0 && bookedOthers + requested > capacity) return;
        all[id] = updated;
        return all;
      }, undefined, false);
      if (!tx.committed) throw new Error("La capacité disponible a changé. Actualisez les réservations avant de réessayer.");
    } else {
      await db.ref("rdn/"+kind+"/"+id).update(updated);
    }
    await auditSafely("update", kind, id, updated, "Enregistrement modifié");
  } catch(e) { alert("Modification impossible : "+e.message); }
}
async function editInvoiceRecord(id, invoice) {
  if (!db || !currentUser || !firebaseConnected) { alert("Connexion Firebase indisponible. Réessayez lorsque la connexion sera rétablie."); return; }
  const updated = { ...invoice };
  const fields = ["client", "telephone", "adresse", "objet", "personnes", "montant", "acompte", "modePaiement", "echeance", "inclus", "note"];
  for (const field of fields) {
    const value = prompt("Modifier " + field + " :", invoice[field] == null ? "" : String(invoice[field]));
    if (value === null) return;
    updated[field] = value.trim();
  }
  updated.personnes = Number(updated.personnes);
  updated.montant = Number(updated.montant);
  updated.acompte = Number(updated.acompte);
  if (!Number.isInteger(updated.personnes) || updated.personnes < 1 || !Number.isFinite(updated.montant) || updated.montant < 10000 || !Number.isFinite(updated.acompte) || updated.acompte < 10000 || updated.acompte > updated.montant) {
    alert("Vérifiez l'effectif, le montant minimum de 10 000 Ar et l'acompte (10 000 Ar minimum, sans dépasser le total).");
    return;
  }
  const alreadyPaid = invoicePaidTotal(invoice);
  if (updated.montant < alreadyPaid) {
    alert("Le montant total ne peut pas être inférieur aux paiements déjà encaissés (" + invoiceMoney(alreadyPaid) + ").");
    return;
  }
  updated.solde = Math.max(0, updated.montant - alreadyPaid);
  updated.updatedAt = Date.now();
  updated.updatedBy = currentUser?.uid || "";
  try {
    await db.ref("rdn/factures/" + id).update(updated);
        await auditSafely("update", "factures", id, updated, "Facture modifiée");
  } catch (error) { alert("Modification de la facture impossible : " + error.message); }
}

async function deleteRecord(kind,id,record) {
  if (kind === "depenses" && !isAdmin()) {
    alert("Accès réservé aux administrateurs.");
    return;
  }
  const reservations = Object.values(dataCache.reservations || {});
  const invoices = Object.values(dataCache.factures || {});
  if (kind === "reservations" && invoices.some(invoice => String(invoice.reservationId || "") === String(id))) {
    alert("Suppression impossible : une facture est déjà liée à cette réservation. Annulez ou régularisez d'abord la facture selon votre procédure comptable.");
    return;
  }
  if (kind === "clients" && (reservations.some(item => String(item.clientId || "") === String(id)) || invoices.some(item => String(item.clientId || "") === String(id)))) {
    alert("Suppression impossible : ce client possède un historique de réservation ou de facturation. Conservez sa fiche pour préserver les relations.");
    return;
  }
  if (kind === "excursions" && reservations.some(item => String(item.excursionId || "") === String(id))) {
    alert("Suppression impossible : cette excursion possède des réservations. Conservez-la pour préserver l'historique.");
    return;
  }
  if (kind === "factures" && record?.reservationId) {
    alert("Suppression directe interdite pour une facture liée à une réservation. Conservez la trace comptable ; une procédure d'annulation dédiée sera nécessaire.");
    return;
  }
  const label = auditLabel(record);
  if (!confirm("Confirmer la suppression de " + label + " ? Cette action est définitive.")) return;
  if (!currentUser || !db) { alert("Veuillez vous connecter avant de supprimer."); return; }
  if (!firebaseConnected) { alert("Connexion Firebase indisponible. Réessayez lorsque la connexion sera rétablie."); return; }
  try {
    if (isAdmin()) {
      // Pour ADMIN : suppression et audit dans une seule mise à jour atomique.
      const logRef = db.ref("rdn/auditLogs").push();
      const updates = {};
      updates["rdn/" + kind + "/" + id] = null;
      updates["rdn/auditLogs/" + logRef.key] =
        buildAuditEvent("delete", kind, id, record, "Suppression effectuée");
      await db.ref().update(updates);
    } else {
      // Pour AGENT : la suppression opérationnelle reste autorisée.
      // L'écriture d'audit est ensuite tentée séparément (append-only via Firebase Rules).
      await db.ref("rdn/" + kind + "/" + id).remove();
      await auditSafely("delete", kind, id, record, "Suppression effectuée par un agent");
    }
  } catch(e) {
    alert("Suppression impossible : " + e.message);
  }
}
function prepareInvoiceFromReservation(r) {
  const form=$("invoiceForm");
  if (!form || !r?.id || !r?.clientId || !dataCache.reservations?.[r.id]) {
    alert("Une réservation valide avec un client associé est nécessaire pour créer une facture.");
    return;
  }
  const existingInvoice = Object.values(dataCache.factures || {}).find(f => String(f.reservationId || "") === String(r.id));
  if (existingInvoice) {
    alert("Une facture existe déjà pour cette réservation : " + (existingInvoice.numero || "numéro non renseigné"));
    return;
  }
  const client=dataCache.clients[r.clientId]||{}, excursion=dataCache.excursions[r.excursionId]||{};
  if (!client || !client.nom) {
    alert("Le client associé à cette réservation est introuvable dans la base Clients.");
    return;
  }
  form.elements.client.value=client.nom||r.client||"";
  form.elements.telephone.value=client.telephone||r.clientTelephone||"";
  form.elements.client.readOnly = true;
  form.elements.telephone.readOnly = true;
  form.elements.objet.value=r.excursion||excursion.titre||"";
  form.elements.dateVoyage.value="";
  form.elements.personnes.value=Math.max(1,Number(r.personnes)||1);
  const amount=parseMontant(r.prixUnitaire||excursion.prix)*Math.max(1,Number(r.personnes)||1);
  form.elements.montant.value=amount>=10000?amount:"";
  form.elements.acompte.value=Math.max(10000,parseMontant(r.acompte));
  form.dataset.reservationId=r.id;
  form.dataset.clientId=r.clientId;
  form.dataset.clientTelephone=client.telephone || r.clientTelephone || "";
  document.querySelectorAll("nav button").forEach(b=>b.classList.toggle("active",b.dataset.page==="factures"));
  document.querySelectorAll(".page").forEach(p=>p.classList.add("hidden")); $("factures").classList.remove("hidden");
  alert("Informations préremplies. Vérifiez la date du voyage, le montant et l'acompte avant de générer la facture.");
}

//                  FACTURES RDN
// ==================================================

function invoiceMoney(value) {
  return (Number(value) || 0).toLocaleString("fr-FR") + " Ar";
}

function currentInvoiceYear() {
  return new Date().getFullYear();
}

function invoiceYear(item) {
  if (!item) return 0;

  const stamp = Number(item.createdAt);

  if (stamp > 0) return new Date(stamp).getFullYear();

  const numberMatch = String(item.numero || "").match(/^FA-(\d{4})-/);

  if (numberMatch) return Number(numberMatch[1]);

  const dateMatch = String(item.date || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

  if (dateMatch) return Number(dateMatch[3]);

  return 0;
}

// ===== NUMÉROTATION AUTOMATIQUE PAR ANNÉE =====

function renumberInvoices(records, year = currentInvoiceYear()) {
  const all = { ...(records || {}) };

  const entries = Object.entries(all)
    .filter(([, item]) => invoiceYear(item) === year)
    .sort((a, b) => {
      const ta = Number(a[1] && a[1].createdAt) || 0;
      const tb = Number(b[1] && b[1].createdAt) || 0;

      return ta - tb || a[0].localeCompare(b[0]);
    });

  entries.forEach(([id, item], index) => {
    all[id] = {
      ...item,
      numero: `FA-${year}-${String(index + 1).padStart(3, "0")}`
    };
  });

  return all;
}

function nextInvoiceNumber(records, year = currentInvoiceYear()) {
  const count = Object.values(records || {})
    .filter(item => invoiceYear(item) === year)
    .length;

  return `FA-${year}-${String(count + 1).padStart(3, "0")}`;
}

async function updateInvoiceNumberPreview() {
  const preview = document.getElementById("invoiceNumberPreview");

  if (!preview || !db) return;

  try {
    const snap = await db.ref("rdn/factures").once("value");
    preview.textContent = nextInvoiceNumber(snap.val() || {});
  } catch (error) {
    console.warn("Aperçu du numéro de facture indisponible", error);
    preview.textContent = "Attribué à l’enregistrement";
  }
}

// ===== AFFICHAGE DES FACTURES =====

function renderInvoiceCard(host, id, o) {
  const total = Number(o.montant) || 0;
  const paid = invoicePaidTotal(o);
  const balance = Math.max(0, total - paid);

  const card = document.createElement("div");
  card.className = "invoice-card";

  const main = document.createElement("div");
  main.className = "invoice-card-main";

  const title = document.createElement("strong");
  title.textContent = `${o.numero || "Facture"} • ${o.client || "Client"}`;

  const detail = document.createElement("div");
  detail.textContent = `${o.objet || "—"} • Total : ${invoiceMoney(total)}`;

  const status = document.createElement("span");
  status.className = "invoice-status" + (balance > 0 ? " pending" : "");

  status.textContent =
    balance <= 0 ? "Payée" :
    paid > 0 ? "Partiellement payée" :
    "Non payée";

  const meta = document.createElement("small");

  meta.textContent =
    `Acompte : ${invoiceMoney(paid)} • Solde : ${invoiceMoney(balance)} • ${o.date || ""}`;

  main.append(title, detail, status, meta);

  const actions = document.createElement("div");
  actions.className = "invoice-actions";

  const print = document.createElement("button");
  print.type = "button";
  print.textContent = "Voir / PDF";
  print.onclick = () => printRdnInvoice(o);

  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "record-edit";
  edit.textContent = "Modifier";
  edit.onclick = () => editInvoiceRecord(id, o);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "record-delete";
  remove.textContent = "Supprimer";
  remove.onclick = () => deleteRecord("factures", id, o);

  actions.append(print, edit, remove);
  card.append(main, actions);
  host.append(card);
}

// ==================================================
//          CALENDRIER ET VÉRIFICATION DES DATES
// ==================================================

const invoiceForm = document.getElementById("invoiceForm");

function dateAujourdhuiISO_RDN() {
  const d = new Date();

  const annee = d.getFullYear();
  const mois = String(d.getMonth() + 1).padStart(2, "0");
  const jour = String(d.getDate()).padStart(2, "0");

  return `${annee}-${mois}-${jour}`;
}

function formatDateRDN(value) {
  if (!value) return "";

  const parts = value.split("-");
  if (parts.length !== 3) return value;

  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

// ===== VÉRIFICATION DATE =====


function verifierDateFactureRDN(input, label) {
  if (!input || !input.value) {
    alert(label + " obligatoire : veuillez choisir une date.");
    if (input) input.focus();
    return false;
  }

  const value = input.value;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    alert(label + " invalide : veuillez choisir une date dans le calendrier.");
    input.focus();
    return false;
  }

  const annee = Number(match[1]);
  const mois = Number(match[2]);
  const jour = Number(match[3]);

  const date = new Date(annee, mois - 1, jour);

  if (
    date.getFullYear() !== annee ||
    date.getMonth() !== mois - 1 ||
    date.getDate() !== jour
  ) {
    alert(label + " : cette date n'existe pas.");
    input.focus();
    return false;
  }

  if (value < dateAujourdhuiISO_RDN()) {
    alert(label + " : une date déjà passée n'est pas autorisée.");
    input.focus();
    return false;
  }

  return true;
}

configurerDatesFactureRDN();


// ===== CONFIGURATION DES CHAMPS DATE =====

function configurerDatesFactureRDN() {
  if (!invoiceForm) return;

  const dateVoyageInput = invoiceForm.elements.dateVoyage;
  const echeanceInput = invoiceForm.elements.echeance;
  const minimum = dateAujourdhuiISO_RDN();

  function preparerChamp(input, titre) {
    if (!input) return;

    if (input.previousElementSibling?.classList.contains("rdn-date-label")) {
      input.previousElementSibling.remove();
    }

    if (input.nextElementSibling?.classList.contains("rdn-date-aide")) {
      input.nextElementSibling.remove();
    }

    input.type = "date";
    input.required = true;
    input.min = minimum;
    input.setAttribute("aria-label", titre);

    const label = document.createElement("label");
    label.className = "rdn-date-label";
    label.textContent = titre;
    label.style.display = "block";
    label.style.width = "100%";
    label.style.fontWeight = "bold";
    label.style.fontSize = "14px";
    label.style.textTransform = "none";
    label.style.marginTop = "14px";
    label.style.marginBottom = "5px";
    label.style.color = "#244b35";

    input.insertAdjacentElement("beforebegin", label);

    input.style.display = "block";
    input.style.width = "100%";
    input.style.marginBottom = "14px";
  }

  preparerChamp(
    dateVoyageInput,
    "Date du voyage"
  );

  preparerChamp(
    echeanceInput,
    "Date d'échéance"
  );
}

configurerDatesFactureRDN();

// ===== ENREGISTREMENT FACTURE =====
if (invoiceForm) {
  invoiceForm.addEventListener("submit", async event => {
    event.preventDefault();

    if (!db || !currentUser) {
      alert("Veuillez vous connecter à Firebase avant de créer une facture.");
      return;
    }
    if (!firebaseConnected) {
      alert("Connexion Firebase indisponible. Réessayez lorsque la connexion sera rétablie.");
      return;
    }
    if (!cacheReady.clients || !cacheReady.reservations || !cacheReady.factures) {
      alert("Attendez la synchronisation des clients, réservations et factures avant de facturer.");
      return;
    }
    if (invoiceForm.dataset.saving === "1") return;
    const reservationId = String(invoiceForm.dataset.reservationId || "");
    const clientId = String(invoiceForm.dataset.clientId || "");
    const reservation = reservationId ? dataCache.reservations?.[reservationId] : null;
    const client = clientId ? dataCache.clients?.[clientId] : null;
    if (!reservationId || !reservation || !clientId || !client || String(reservation.clientId || "") !== clientId) {
      alert("Facture impossible : sélectionnez une réservation existante depuis le module Réservations. Une facture libre n'est pas autorisée.");
      return;
    }
    if (String(reservation.statut || "").trim().toLocaleLowerCase("fr") === "annulée" || String(reservation.statut || "").trim().toLocaleLowerCase("fr") === "annulee") {
      alert("Facturation impossible : cette réservation est annulée.");
      return;
    }
    const alreadyInvoiced = Object.values(dataCache.factures || {}).some(f => String(f.reservationId || "") === reservationId);
    if (alreadyInvoiced) {
      alert("Cette réservation possède déjà une facture. Aucune deuxième facture ne peut être créée.");
      return;
    }

    const dateVoyageInput = invoiceForm.elements.dateVoyage;
    const echeanceInput = invoiceForm.elements.echeance;

    if (!verifierDateFactureRDN(dateVoyageInput, "Date du voyage")) return;
    if (!verifierDateFactureRDN(echeanceInput, "Date d'échéance")) return;

    const dateVoyage = dateVoyageInput.value;
    const echeance = echeanceInput.value;

    if (echeance > dateVoyage) {
      alert(
        "La date d'échéance doit être antérieure ou égale à la date du voyage."
      );
      echeanceInput.focus();
      return;
    }

    const fd = new FormData(invoiceForm);
    let o = {};

    fd.forEach((value, key) => {
      o[key] = String(value).trim();
    });

    o.montant = Number(o.montant);
    o.acompte = Number(o.acompte);
    o.personnes = Number(o.personnes);

    // Effectif minimum : 1 personne
    if (!Number.isInteger(o.personnes) || o.personnes < 1) {
      alert("L'effectif minimum est de 1 personne.");
      invoiceForm.elements.personnes.focus();
      return;
    }

    // Montant total minimum : 10 000 Ar
    if (!Number.isFinite(o.montant) || o.montant < 10000) {
      alert("Le montant total minimum est de 10 000 Ar (5 chiffres).");
      invoiceForm.elements.montant.focus();
      return;
    }

    // Acompte minimum : 10 000 Ar
    if (!Number.isFinite(o.acompte) || o.acompte < 10000) {
      alert("L'acompte minimum est de 10 000 Ar.");
      invoiceForm.elements.acompte.focus();
      return;
    }

    if (o.acompte > o.montant) {
      alert("L'acompte ne peut pas dépasser le montant total.");
      invoiceForm.elements.acompte.focus();
      return;
    }

    o.dateVoyage = formatDateRDN(dateVoyage);
    o.echeance = formatDateRDN(echeance);

    o.solde = o.montant - o.acompte;
    o.date = new Date().toLocaleDateString("fr-FR");
    o.createdAt = Date.now();
    o.type = "facture-acompte";
    o.reservationId = reservationId;
    o.clientId = clientId;
    // Identité client toujours issue de la fiche Firebase liée à la réservation.
    o.client = client.nom || reservation.client || "";
    o.telephone = client.telephone || reservation.clientTelephone || "";
    o.createdBy = currentUser?.uid || "";
    o.createdByEmail = currentUser?.email || "";
    // Le premier acompte devient le premier mouvement du journal de paiements.
    o.paiements = {};
    if (o.acompte > 0) {
      const firstPaymentId = db.ref("rdn/factures").push().key;
      o.paiements[firstPaymentId] = {
        montant: o.acompte,
        date: Date.now(),
        mode: o.modePaiement || "Non précisé",
        note: "Acompte initial enregistré avec la facture",
        createdBy: currentUser.uid,
        createdByEmail: currentUser.email || ""
      };
    }

    invoiceForm.dataset.saving = "1";
    const invoiceSubmit = invoiceForm.querySelector('button[type="submit"]');
    if (invoiceSubmit) invoiceSubmit.disabled = true;
    try {
      const invoicesRef = db.ref("rdn/factures");
      const newRef = invoicesRef.push();

      const year = currentInvoiceYear();

      const result = await invoicesRef.transaction(records => {
        const all = { ...(records || {}) };
        const duplicate = Object.values(all).some(invoice => String(invoice?.reservationId || "") === reservationId);
        if (duplicate) return;

        all[newRef.key] = {
          ...o,
          id: newRef.key
        };

        return renumberInvoices(all, year);

      }, undefined, false);

      if (!result.committed) {
        throw new Error("Une facture existe déjà pour cette réservation, ou la transaction n'a pas été validée.");
      }

      const committed = result.snapshot.val() || {};

      o = committed[newRef.key];

      if (!o || !o.numero) {
        throw new Error("Le numéro de facture n'a pas été attribué.");
      }

      await auditSafely("create", "factures", newRef.key, o, "Facture créée : " + (o.numero || ""));
      invoiceForm.reset();
      delete invoiceForm.dataset.reservationId;
      delete invoiceForm.dataset.clientId;
      delete invoiceForm.dataset.clientTelephone;

      invoiceForm.elements.personnes.value = 1;
      invoiceForm.elements.montant.value = "";
      invoiceForm.elements.acompte.value = 10000;

      await load("factures");
      await updateInvoiceNumberPreview();

      printRdnInvoice(o);

    } catch (error) {
      alert("Erreur lors de l'enregistrement de la facture : " + error.message);
    } finally {
      delete invoiceForm.dataset.saving;
      if (invoiceSubmit) invoiceSubmit.disabled = false;
    }
  });
}

// ==================================================
//                 IMPRESSION FACTURE
// ==================================================

function printRdnInvoice(o) {
  const esc = value =>
    String(value ?? "").replace(/[&<>"']/g, ch => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[ch]));

  const total = Number(o.montant) || 0;
  const paid = invoicePaidTotal(o);
  const balance = Math.max(0, total - paid);

  const included = String(o.inclus || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .map(x => `<li>${esc(x)}</li>`)
    .join("");

  const dueDate = o.echeance || "—";

  const logoUrl = new URL("logo-rdn.png", window.location.href).href;
  const stampUrl = new URL("tampon.png", window.location.href).href;

  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.numero || "Facture RDN")}</title>

<style>
@page{size:A4;margin:9mm}
*{box-sizing:border-box}
html,body{margin:0;padding:0}

body{
  font-family:Arial,Helvetica,sans-serif;
  color:#171717;
  font-size:12px;
  line-height:1.4;
  -webkit-print-color-adjust:exact;
  print-color-adjust:exact
}

.sheet{
  width:100%;
  min-height:279mm;
  position:relative
}

.top{
  background:#168fe8;
  color:#fff;
  padding:9px 12px;
  display:grid;
  grid-template-columns:112px 1fr;
  gap:14px;
  align-items:center;
  border:1px solid #dcecf8
}

.logo{
  width:108px;
  height:108px;
  object-fit:contain;
  background:#fff;
  display:block
}

.brand h1{
  font-size:30px;
  line-height:1.1;
  margin:0 0 8px;
  text-align:center;
  letter-spacing:.2px
}

.mail{
  text-align:center;
  font-size:13px;
  margin-bottom:12px
}

.meta{
  display:flex;
  justify-content:space-between;
  gap:10px;
  font-weight:bold;
  margin-top:8px;
  font-size:11px
}

.client{
  padding:12px 10px 10px;
  line-height:1.9;
  font-size:13px
}

.details{
  width:100%;
  border-collapse:collapse;
  margin-top:3px;
  font-size:13px
}

.details td{
  padding:10px 12px;
  border:2px solid #fff;
  background:#e2f1fc
}

.details .head{
  background:#b9def9
}

.details td:first-child{
  font-weight:bold;
  width:54%
}

.details .totalrow td{
  background:#fff;
  font-size:14px;
  padding-top:11px;
  padding-bottom:11px
}

.block{
  padding:8px 12px;
  line-height:1.5;
  font-size:13px
}

.block ul{
  margin:3px 0 0 22px;
  padding-left:12px
}

.section-label{
  font-weight:bold;
  color:#111
}

.note{margin-top:1px}
.due{margin-top:2px}

.bottom{
  margin:0 8px;
  gap:4px;
}

.contacts{
  margin: 12px 5px 0;
  padding:0;
  line-height:1.15;
}

.thanks{
  font-style:italic;
  color:#111;
  margin:0px 12px 0;
  padding:0;
  font-size:13px;
  line-height:1.2;
  position:relative;
  z-index:1;
}

.seal-sign{
  position:relative;
  display:block;
  min-height:110px;
}

.stamp-block{
  position:absolute;
  right:0;
  bottom:0px;
  z-index:5;
  max-width:165px;
  margin:0;
}

.stamp{
  width:145px;
  height:145px;
  max-width:100%;
  object-fit:contain;
  display:block;
}

.footer{
  height:13px;
  background:#168fe8;
  border-top:3px solid #dceefb
}

@media screen{
  body{
    max-width:800px;
    margin:12px auto;
    padding:12px;
    background:#fff;
    box-shadow:0 1px 8px #ccd5dd
  }
}

@media print{
  body{padding:0}
  .top,.details td,.footer{
    -webkit-print-color-adjust:exact;
    print-color-adjust:exact
  }
}
</style>
</head>

<body>
<main class="sheet">

<header class="top">

  <img class="logo"
       src="${esc(logoUrl)}"
       alt="Logo RDN">

  <div class="brand">

    <h1>RDN EXPÉDITION</h1>

    <div class="mail">rdnexpedition@gmail.com</div>

    <div class="meta">
      <span>NIF : 5019233964</span>
      <span>FACTURE N° : ${esc(o.numero || "")}</span>
    </div>

    <div class="meta">
      <span>STAT : 79120 11 2025 0 04198</span>
      <span>${esc(o.date || "")}</span>
    </div>

  </div>

</header>

<section class="client">
  <b>Client(e) :</b> ${esc(o.client)}<br>
  <b>Téléphone :</b> ${esc(o.telephone || "—")}<br>
  <b>Adresse :</b> ${esc(o.adresse || "—")}
</section>

<table class="details">

  <tr>
    <td class="head" colspan="2">
      <b>Détails des services :</b>
      ${esc(o.objet)}
      ${o.dateVoyage ? " – " + esc(o.dateVoyage) : ""}
    </td>
  </tr>

  <tr>
    <td>Effectif :</td>
    <td>${Number(o.personnes) || 1} personne(s)</td>
  </tr>

  <tr>
    <td>Total déjà encaissé :</td>
    <td>${invoiceMoney(paid)}</td>
  </tr>

  <tr>
    <td>Solde restant à payer :</td>
    <td>${invoiceMoney(balance)}</td>
  </tr>

  <tr class="totalrow">
    <td>Montant total du voyage :</td>
    <td>${invoiceMoney(total)}</td>
  </tr>

</table>

<section class="block">
  <b>Mode de paiement :</b>
  ${esc(o.modePaiement || "—")}
</section>

<section class="block">

  <b class="section-label">INCLUS :</b>

  <ul>
    ${included || "<li>Prestations indiquées ci-dessus</li>"}
  </ul>

</section>

<section class="block note">
  <b class="section-label">NB :</b><br>
  ${esc(o.note || "—")}
</section>

<section class="block due">
  <b>Date d'échéance (paiement du solde) :</b>
  ${esc(dueDate)}
</section>

<section class="bottom">

  <div class="contacts">
    Facebook : RDN Expédition<br>
    WhatsApp : 034 70 249 97
  </div>

  <div class="seal-sign">
    <div class="stamp-block">
      <img
        class="stamp"
        src="${esc(stampUrl)}"
        alt="Cachet officiel RDN Expédition">
    </div>
  </div>

</section>

<div class="thanks">
  Merci d’avoir choisi RDN Expédition.<br>
  Nous ferons de votre voyage une expérience inoubliable.
</div>

<div class="footer"></div>

</main>

<script>
window.onload = () => setTimeout(() => window.print(), 600);
<\/script>

</body>
</html>`;

  const win = window.open("", "_blank");

  if (!win) {
    alert("Autorisez les fenêtres pop-up pour afficher la facture.");
    return;
  }

  win.document.open();
  win.document.write(html);
  win.document.close();
}



// ================================================================
// RDN GESTION PRO — COUCHE PROFESSIONNELLE INTÉGRÉE (PHASES 1 À 6)
// Compatible avec les données historiques : aucun nœud existant n'est migré
// ou supprimé automatiquement. Les nouveaux paiements sont stockés dans
// factures/{factureId}/paiements.
// ================================================================

function invoicePaidTotal(invoice) {
  if (!invoice) return 0;
  const payments = invoice.paiements && typeof invoice.paiements === "object"
    ? Object.values(invoice.paiements) : [];
  if (payments.length) return payments.reduce((sum, payment) => sum + Math.max(0, parseMontant(payment?.montant)), 0);
  // Compatibilité avec les anciennes factures qui ne possèdent que "acompte".
  return Math.max(0, parseMontant(invoice.acompte));
}

function invoiceBalance(invoice) {
  return Math.max(0, parseMontant(invoice?.montant) - invoicePaidTotal(invoice));
}

function paymentDateLabel(value) {
  const date = typeof value === "number" ? new Date(value) : parseDateRDN(value);
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString("fr-FR") : "Date non renseignée";
}

async function recordInvoicePayment(invoiceId, invoice) {
  if (!db || !currentUser || !firebaseConnected) {
    alert("Connexion Firebase indisponible. Réessayez après le rétablissement de la connexion.");
    return;
  }
  const currentBalance = invoiceBalance(invoice);
  if (currentBalance <= 0) { alert("Cette facture est déjà réglée."); return; }
  const raw = prompt("Montant du paiement reçu (Ar) — solde restant : " + invoiceMoney(currentBalance), String(currentBalance));
  if (raw === null) return;
  const amount = parseMontant(raw);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > currentBalance) {
    alert("Montant invalide. Le paiement doit être positif et ne pas dépasser le solde restant.");
    return;
  }
  const mode = prompt("Mode de paiement (Espèces, Mobile Money, Virement bancaire…)", "Espèces");
  if (mode === null) return;
  const note = prompt("Référence ou note (facultatif) :", "") ?? "";
  const paymentId = db.ref("rdn/factures/" + invoiceId + "/paiements").push().key;
  try {
    const ref = db.ref("rdn/factures/" + invoiceId);
    const tx = await ref.transaction(current => {
      if (!current) return;
      const copy = { ...current };
      const payments = { ...(copy.paiements || {}) };
      // Préserve le montant d'acompte des factures anciennes lors de leur premier ajout de paiement.
      if (!Object.keys(payments).length && parseMontant(copy.acompte) > 0) {
        const legacyId = "legacy-acompte";
        payments[legacyId] = {
          montant: parseMontant(copy.acompte),
          date: Number(copy.createdAt) || Date.now(),
          mode: copy.modePaiement || "Acompte initial (historique)",
          note: "Mouvement repris depuis le champ acompte historique",
          legacy: true
        };
      }
      const alreadyPaid = Object.values(payments).reduce((sum, item) => sum + Math.max(0, parseMontant(item?.montant)), 0);
      const balance = Math.max(0, parseMontant(copy.montant) - alreadyPaid);
      if (amount > balance || balance <= 0) return;
      payments[paymentId] = {
        montant: amount,
        date: Date.now(),
        mode: String(mode).trim() || "Non précisé",
        note: String(note).trim(),
        createdBy: currentUser.uid,
        createdByEmail: currentUser.email || ""
      };
      copy.paiements = payments;
      copy.solde = Math.max(0, parseMontant(copy.montant) - alreadyPaid - amount);
      copy.updatedAt = Date.now();
      copy.updatedBy = currentUser.uid;
      return copy;
    }, undefined, false);
    if (!tx.committed) throw new Error("Le solde a changé ou le paiement n'a pas pu être confirmé. Actualisez la facture.");
    await auditSafely("payment", "factures", invoiceId, tx.snapshot.val(), "Paiement reçu : " + invoiceMoney(amount));
    alert("Paiement enregistré avec succès.");
    renderKind("factures");
    renderProDashboard();
  } catch (error) {
    alert("Enregistrement du paiement impossible : " + error.message);
  }
}

// Remplacement du rendu facture : suivi des mouvements et solde recalculé.
function renderInvoiceCard(host, id, invoice) {
  const total = Math.max(0, parseMontant(invoice.montant));
  const paid = invoicePaidTotal(invoice);
  const balance = Math.max(0, total - paid);
  const card = document.createElement("article");
  card.className = "invoice-card";
  const main = document.createElement("div");
  main.className = "invoice-card-main";
  const title = document.createElement("strong");
  title.textContent = `${invoice.numero || "Facture"} • ${invoice.client || "Client"}`;
  const detail = document.createElement("div");
  detail.textContent = `${invoice.objet || "—"} • Total : ${invoiceMoney(total)}`;
  const status = document.createElement("span");
  status.className = "invoice-status" + (balance > 0 ? " pending" : "");
  status.textContent = balance <= 0 ? "Payée" : paid > 0 ? "Partiellement payée" : "Non payée";
  const meta = document.createElement("small");
  meta.textContent = `Encaissé : ${invoiceMoney(paid)} • Solde : ${invoiceMoney(balance)} • ${invoice.date || ""}`;
  main.append(title, detail, status, meta);
  const payments = invoice.paiements && typeof invoice.paiements === "object" ? Object.values(invoice.paiements) : [];
  if (payments.length) {
    const history = document.createElement("details");
    history.className = "rdn-payment-history";
    const summary = document.createElement("summary");
    summary.textContent = `Historique des paiements (${payments.length})`;
    const list = document.createElement("div");
    list.className = "rdn-payment-list";
    payments.sort((a,b) => (Number(a.date)||0) - (Number(b.date)||0)).forEach(payment => {
      const row = document.createElement("div");
      row.className = "rdn-payment-row";
      const label = document.createElement("span");
      label.textContent = `${paymentDateLabel(payment.date)} · ${payment.mode || "Mode non précisé"}${payment.note ? " · " + payment.note : ""}`;
      const value = document.createElement("strong");
      value.textContent = invoiceMoney(payment.montant);
      row.append(label, value); list.append(row);
    });
    history.append(summary, list); main.append(history);
  }
  const actions = document.createElement("div");
  actions.className = "invoice-actions";
  const print = document.createElement("button"); print.type="button"; print.textContent="Voir / PDF"; print.onclick=()=>printRdnInvoice(invoice);
  const payment = document.createElement("button"); payment.type="button"; payment.className="rdn-payment-button"; payment.textContent=balance>0?"Enregistrer paiement":"Soldée"; payment.disabled=balance<=0; payment.onclick=()=>recordInvoicePayment(id,invoice);
  const edit = document.createElement("button"); edit.type="button"; edit.className="record-edit"; edit.textContent="Modifier"; edit.onclick=()=>editInvoiceRecord(id,invoice);
  const remove = document.createElement("button"); remove.type="button"; remove.className="record-delete"; remove.textContent="Supprimer"; remove.onclick=()=>deleteRecord("factures",id,invoice);
  actions.append(print,payment,edit,remove); card.append(main,actions); host.append(card);
}

// Tableau de bord financier : recettes encaissées, prévisionnel et évolution mensuelle.
function renderProDashboard() {
  const host = document.getElementById("rdnProDashboard");
  if (!host) return;
  const admin = isAdmin();
  applyRoleAccess();
  const reservations = Object.entries(dataCache.reservations || {}).map(([id, record]) => ({...record,_key:id}));
  const invoices = admin ? Object.values(dataCache.factures || {}) : [];
  const expenses = admin ? Object.values(dataCache.depenses || {}) : [];
  const cancelled = r => ["annulée","annulee","annulé","annule"].includes(String(r?.statut||"").trim().toLowerCase());
  const activeReservations = reservations.filter(r=>!cancelled(r));
  const invoicedIds = new Set(invoices.map(i=>String(i.reservationId||"")).filter(Boolean));
  const unbilled = activeReservations.filter(r=>!invoicedIds.has(String(r._key)));
  const reservationForecast = unbilled.reduce((sum,r)=>sum+parseMontant(r.prixUnitaire||dataCache.excursions?.[r.excursionId]?.prix)*Math.max(1,Number(r.personnes)||1),0);
  const invoiceForecast = invoices.reduce((sum,i)=>sum+parseMontant(i.montant),0);
  const caPrevisionnel = reservationForecast + invoiceForecast;
  const invoicePaid = invoices.reduce((sum,i)=>sum+invoicePaidTotal(i),0);
  const reservationPaid = unbilled.reduce((sum,r)=>sum+parseMontant(r.acompte),0);
  const caEncaisse = invoicePaid + reservationPaid;
  const depensesTotal = expenses.reduce((sum,d)=>sum+parseMontant(d?.montant),0);
  const soldes = Math.max(0,caPrevisionnel-caEncaisse);
  const benefice = caPrevisionnel-depensesTotal;
  const setText=(id,value)=>{const el=document.getElementById(id);if(el)el.textContent=String(value);};
  setText("rdnClientsTotal",Object.keys(dataCache.clients||{}).length);
  setText("rdnReservationsTotal",activeReservations.length);
  setText("rdnFacturesTotal",Object.keys(dataCache.factures||{}).length);
  if(admin){
    [["rdnCaEncaisse",caEncaisse],["rdnCaPrevisionnel",caPrevisionnel],["rdnDepensesTotal",depensesTotal],["rdnBeneficePrevisionnel",benefice],["rdnSoldesClients",soldes]].forEach(([id,v])=>setText(id,formatAr(v)));
    const rate=caPrevisionnel>0?Math.min(100,Math.round(caEncaisse/caPrevisionnel*100)):0;
    setText("rdnCollectionRate",rate+" %");
    const bar=document.getElementById("rdnCollectionBar");if(bar)bar.style.width=rate+"%";
    setText("rdnCollectionCaption",caPrevisionnel>0?`${formatAr(caEncaisse)} encaissés sur ${formatAr(caPrevisionnel)} prévus`:"Aucune réservation ou facture à suivre");
  }
  const today=new Date();today.setHours(0,0,0,0);
  const trips=Object.entries(dataCache.excursions||{}).map(([id,x])=>{
    const date=parseDateRDN(x.date);
    const booked=activeReservations.filter(r=>String(r.excursionId||"")===String(id)).reduce((n,r)=>n+Math.max(1,Number(r.personnes)||1),0);
    return {id,title:x.titre||"Excursion",dateText:x.date||"Date non définie",date,booked,capacity:Math.max(0,Number(x.places)||0)};
  }).filter(x=>x.date&&x.date>=today).sort((a,b)=>a.date-b.date);
  setText("rdnExcursionsAVenir",trips.length);
  const upcoming=document.getElementById("rdnUpcomingTrips");
  if(upcoming)upcoming.innerHTML=trips.length?trips.slice(0,6).map(t=>`<div class="rdn-trip-row"><div><strong>${escapeHTML(t.title)}</strong><small>${escapeHTML(t.dateText)}</small></div><span>${t.booked}${t.capacity?" / "+t.capacity:""} pers.</span></div>`).join(""):'<p class="rdn-empty">Aucune excursion future avec une date reconnue.</p>';
  const summary=document.getElementById("rdnReservationSummary");
  if(summary){const pending=activeReservations.filter(r=>/attente/i.test(String(r.statut||""))).length;const confirmed=activeReservations.filter(r=>/confirm/i.test(String(r.statut||""))).length;summary.innerHTML=`<div class="rdn-summary-row"><span>Réservations actives</span><strong>${activeReservations.length}</strong></div><div class="rdn-summary-row"><span>Confirmées</span><strong>${confirmed}</strong></div><div class="rdn-summary-row"><span>En attente</span><strong>${pending}</strong></div><div class="rdn-summary-row"><span>Annulées</span><strong>${reservations.length-activeReservations.length}</strong></div>`;}
  if(admin)renderMonthlyFinanceChart(invoices,expenses,unbilled);
  setText("rdnDashboardUpdated","Mis à jour : "+new Date().toLocaleString("fr-FR"));
}

function printFinancialReport(){
  if(!isAdmin()){alert("Rapport financier réservé à ADMIN.");return;}
  const invoices=Object.values(dataCache.factures||{}),expenses=Object.values(dataCache.depenses||{});
  const rows=[];const now=new Date();
  for(let i=5;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);const key=monthKey(d);let income=0,cost=0;
    invoices.forEach(inv=>{const payments=inv.paiements&&typeof inv.paiements==="object"?Object.values(inv.paiements):[];if(payments.length)payments.forEach(p=>{const pd=new Date(Number(p.date)||0);if(monthKey(pd)===key)income+=parseMontant(p.montant);});else{const pd=Number(inv.createdAt)?new Date(Number(inv.createdAt)):parseDateRDN(inv.date);if(pd&&monthKey(pd)===key)income+=parseMontant(inv.acompte);}});
    expenses.forEach(e=>{const ed=parseDateRDN(e.date)||(Number(e.createdAt)?new Date(Number(e.createdAt)):null);if(ed&&monthKey(ed)===key)cost+=parseMontant(e.montant);});
    rows.push({label:d.toLocaleDateString("fr-FR",{month:"long",year:"numeric"}),income,cost,net:income-cost});
  }
  const totalIncome=invoices.reduce((n,i)=>n+invoicePaidTotal(i),0),totalCost=expenses.reduce((n,e)=>n+parseMontant(e.montant),0);
  const win=window.open("","_blank");if(!win){alert("Autorisez les fenêtres pop-up pour imprimer.");return;}
  win.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Rapport financier RDN</title><style>body{font:13px Arial;padding:25px;color:#24352a}h1{color:#244b35}.kpis{display:flex;gap:12px;margin:20px 0}.kpis div{border:1px solid #dce5dc;padding:12px;flex:1;border-radius:8px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border:1px solid #ccd6cc;padding:9px;text-align:right}th:first-child,td:first-child{text-align:left}th{background:#edf3ed}</style></head><body><h1>RDN EXPÉDITION — Rapport financier</h1><p>Période : 6 derniers mois · Édité le ${new Date().toLocaleString("fr-FR")}</p><div class="kpis"><div><small>Total encaissé</small><h2>${invoiceMoney(totalIncome)}</h2></div><div><small>Dépenses enregistrées</small><h2>${invoiceMoney(totalCost)}</h2></div><div><small>Net encaissé après dépenses</small><h2>${invoiceMoney(totalIncome-totalCost)}</h2></div></div><table><thead><tr><th>Mois</th><th>Recettes encaissées</th><th>Dépenses</th><th>Net</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${escapeHTML(r.label)}</td><td>${invoiceMoney(r.income)}</td><td>${invoiceMoney(r.cost)}</td><td>${invoiceMoney(r.net)}</td></tr>`).join("")}</tbody></table><script>window.onload=()=>window.print()<\/script></body></html>`);win.document.close();
}

function monthKey(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`; }
function renderMonthlyFinanceChart(invoices, expenses, unbilledReservations) {
  const host=document.getElementById("rdnMonthlyFinanceChart");if(!host)return;
  const months=[];const now=new Date();
  for(let i=5;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);months.push({key:monthKey(d),label:d.toLocaleDateString("fr-FR",{month:"short"}),income:0,cost:0});}
  const byKey=Object.fromEntries(months.map(m=>[m.key,m]));
  invoices.forEach(inv=>{
    const payments=inv.paiements&&typeof inv.paiements==="object"?Object.values(inv.paiements):[];
    if(payments.length){payments.forEach(p=>{const d=new Date(Number(p.date)||0);const m=byKey[monthKey(d)];if(m)m.income+=parseMontant(p.montant);});}
    else {const d=Number(inv.createdAt)?new Date(Number(inv.createdAt)):parseDateRDN(inv.date);const m=d&&byKey[monthKey(d)];if(m)m.income+=parseMontant(inv.acompte);}
  });
  unbilledReservations.forEach(r=>{const d=Number(r.createdAt)?new Date(Number(r.createdAt)):parseDateRDN(r.date);const m=d&&byKey[monthKey(d)];if(m)m.income+=parseMontant(r.acompte);});
  expenses.forEach(e=>{const d=parseDateRDN(e.date)|| (Number(e.createdAt)?new Date(Number(e.createdAt)):null);const m=d&&byKey[monthKey(d)];if(m)m.cost+=parseMontant(e.montant);});
  const max=Math.max(1,...months.flatMap(m=>[m.income,m.cost]));
  host.innerHTML=months.map(m=>`<div class="rdn-month-column"><div class="rdn-month-bars"><span class="income" style="height:${Math.max(2,m.income/max*100)}%" title="Recettes : ${formatAr(m.income)}"></span><span class="cost" style="height:${Math.max(2,m.cost/max*100)}%" title="Dépenses : ${formatAr(m.cost)}"></span></div><small>${escapeHTML(m.label)}</small><b>${formatAr(m.income-m.cost)}</b></div>`).join("");
}

const ensureProDashboardBase = ensureProDashboardBaseImplementation;
function ensureProDashboard() {
  ensureProDashboardBase();
  const host=document.getElementById("rdnProDashboard");
  if(host&&!document.getElementById("rdnMonthlyFinancePanel")){
    const panel=document.createElement("section");panel.id="rdnMonthlyFinancePanel";panel.className="rdn-panel rdn-finance-panel";
    panel.innerHTML='<div class="rdn-report-heading"><h3>Évolution financière — 6 derniers mois</h3><button type="button" id="rdnPrintFinanceReport">Imprimer rapport</button></div><div class="rdn-chart-legend"><span><i class="income-dot"></i> Recettes encaissées</span><span><i class="cost-dot"></i> Dépenses</span></div><div id="rdnMonthlyFinanceChart" class="rdn-monthly-chart"></div>';
    const audit=document.getElementById("rdnAuditPanel");host.insertBefore(panel,audit||null);
    panel.querySelector("#rdnPrintFinanceReport").onclick=printFinancialReport;
  }
  installProfessionalTools();
  renderProDashboard();
}

function csvCell(value){const text=String(value??"");return '"'+text.replace(/"/g,'""')+'"';}
function downloadTextFile(filename,content,mime="text/plain;charset=utf-8"){
  const blob=new Blob(["\ufeff",content],{type:mime});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportModuleCSV(kind){
  if(kind==="depenses"&&!isAdmin()){alert("Export réservé aux administrateurs.");return;}
  if(kind==="factures"&&!isAdmin()){alert("Export des factures réservé aux administrateurs.");return;}
  const records=dataCache[kind]||{};const rows=Object.entries(records);
  if(!rows.length){alert("Aucune donnée à exporter.");return;}
  const fields=[...new Set(rows.flatMap(([,r])=>Object.keys(r||{}).filter(k=>typeof r[k]!=="object")))];
  const extra = kind === "factures" ? ["totalEncaisse", "soldeRestant", "historiquePaiements"] : [];
  const headers=["ID",...fields,...extra];
  const csv=[headers.map(csvCell).join(";")];
  rows.forEach(([id,r])=>{
    const extraValues = kind === "factures" ? [invoicePaidTotal(r), invoiceBalance(r), Object.values(r.paiements||{}).map(p=>`${paymentDateLabel(p.date)}:${p.montant}Ar:${p.mode||""}`).join(" | ")] : [];
    csv.push([id,...fields.map(f=>r?.[f]??""),...extraValues].map(csvCell).join(";"));
  });
  downloadTextFile(`RDN_${kind}_${new Date().toISOString().slice(0,10)}.csv`,csv.join("\r\n"),"text/csv;charset=utf-8");
}
function printParticipants(excursionId){
  const trip=dataCache.excursions?.[excursionId];if(!trip){alert("Excursion introuvable.");return;}
  const participants=Object.entries(dataCache.reservations||{}).filter(([,r])=>String(r.excursionId||"")===String(excursionId)&&!["annulée","annulee","annulé","annule"].includes(String(r.statut||"").trim().toLowerCase()));
  const rows=participants.map(([id,r],i)=>`<tr><td>${i+1}</td><td>${escapeHTML(r.client||"Client")}</td><td>${escapeHTML(r.clientTelephone||"")}</td><td>${Math.max(1,Number(r.personnes)||1)}</td><td>${escapeHTML(r.statut||"")}</td><td>${formatAr(r.acompte)}</td></tr>`).join("");
  const win=window.open("","_blank");if(!win){alert("Autorisez les fenêtres pop-up pour imprimer.");return;}
  win.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Participants — ${escapeHTML(trip.titre)}</title><style>body{font:13px Arial;padding:24px;color:#24352a}h1{color:#244b35}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border:1px solid #ccd6cc;padding:8px;text-align:left}th{background:#edf3ed}.meta{color:#59685d}</style></head><body><h1>RDN EXPÉDITION — Liste des participants</h1><h2>${escapeHTML(trip.titre||"Excursion")}</h2><p class="meta">Date : ${escapeHTML(trip.date||"—")} · Participants : ${participants.reduce((n,[,r])=>n+Math.max(1,Number(r.personnes)||1),0)}</p><table><thead><tr><th>N°</th><th>Client</th><th>Téléphone</th><th>Personnes</th><th>Statut</th><th>Acompte</th></tr></thead><tbody>${rows||'<tr><td colspan="6">Aucun participant</td></tr>'}</tbody></table><script>window.onload=()=>window.print()<\/script></body></html>`);win.document.close();
}
function showClientHistory(clientId,client){
  const reservations=Object.entries(dataCache.reservations||{}).filter(([,r])=>String(r.clientId||"")===String(clientId));
  const invoices=Object.values(dataCache.factures||{}).filter(i=>String(i.clientId||"")===String(clientId));
  const paid=invoices.reduce((sum,i)=>sum+invoicePaidTotal(i),0);const balance=invoices.reduce((sum,i)=>sum+invoiceBalance(i),0);
  alert(`HISTORIQUE CLIENT\n${client.nom||"Client"}\nTéléphone : ${client.telephone||"—"}\n\nRéservations : ${reservations.length}\nFactures : ${invoices.length}\nTotal encaissé : ${invoiceMoney(paid)}\nSolde factures : ${invoiceMoney(balance)}\n\n${reservations.map(([,r])=>`• ${r.excursion||"Excursion"} — ${r.excursionDate||""} — ${r.statut||""}`).join("\n")}`);
}
function installProfessionalTools(){
  ["clients","excursions","reservations","factures","depenses"].forEach(kind=>{
    const section=document.getElementById(kind);if(!section||section.querySelector(`.rdn-module-tools[data-kind="${kind}"]`))return;
    const toolbar=document.createElement("div");toolbar.className="rdn-module-tools";toolbar.dataset.kind=kind;
    const search=document.createElement("input");search.type="search";search.placeholder="Rechercher…";search.setAttribute("aria-label","Rechercher dans "+kind);
    search.addEventListener("input",()=>{const list=document.getElementById("list-"+kind);if(!list)return;[...list.children].forEach(card=>card.classList.toggle("rdn-filter-hidden",!card.textContent.toLocaleLowerCase("fr").includes(search.value.toLocaleLowerCase("fr"))));});
    const exportButton=document.createElement("button");exportButton.type="button";exportButton.className="rdn-export-button";exportButton.textContent="Exporter CSV";exportButton.onclick=()=>exportModuleCSV(kind);
    toolbar.append(search,exportButton);
    if(kind==="excursions"){
      const printHint=document.createElement("small");printHint.textContent="La liste des participants est disponible sur chaque fiche excursion.";toolbar.append(printHint);
    }
    const list=document.getElementById("list-"+kind);if(list)section.insertBefore(toolbar,list);else section.append(toolbar);
  });
  const dash=document.getElementById("dashboard");
  if(dash&&!document.getElementById("rdnBackupTools")&&isAdmin()){
    const box=document.createElement("section");box.id="rdnBackupTools";box.className="rdn-panel rdn-backup-tools";
    box.innerHTML='<h3>Sauvegarde et restauration</h3><p>Exportez une copie JSON de la base RDN. La restauration fusionne les enregistrements par identifiant sans supprimer les données absentes du fichier.</p><button type="button" id="rdnBackupExport">Télécharger la sauvegarde</button> <button type="button" id="rdnBackupImportTrigger" class="light">Restaurer depuis JSON</button><input type="file" id="rdnBackupFile" accept="application/json,.json" hidden>';
    dash.append(box);
    box.querySelector("#rdnBackupExport").onclick=exportFullBackup;
    box.querySelector("#rdnBackupImportTrigger").onclick=()=>box.querySelector("#rdnBackupFile").click();
    box.querySelector("#rdnBackupFile").addEventListener("change",event=>restoreBackupMerge(event.target.files?.[0]));
  }
}
async function exportFullBackup(){
  if(!isAdmin()||!db){alert("Sauvegarde réservée à ADMIN.");return;}
  try{const snap=await db.ref("rdn").once("value");const payload={app:"RDN GESTION",formatVersion:1,exportedAt:new Date().toISOString(),exportedBy:currentUser.email||currentUser.uid,rdn:snap.val()||{}};downloadTextFile(`RDN_BACKUP_${new Date().toISOString().replace(/[:.]/g,"-")}.json`,JSON.stringify(payload,null,2),"application/json;charset=utf-8");}
  catch(error){alert("Sauvegarde impossible : "+error.message);}
}
async function restoreBackupMerge(file){
  if(!isAdmin()||!db||!file)return;
  try{
    const payload=JSON.parse(await file.text());const root=payload?.rdn;
    const allowed=["clients","excursions","reservations","factures","depenses","auditLogs"];
    if(!root||typeof root!=="object"||!allowed.some(k=>root[k]&&typeof root[k]==="object"))throw new Error("Fichier de sauvegarde RDN invalide.");
    if(!confirm("Restaurer les enregistrements du fichier ? Les mêmes identifiants seront remplacés et les autres données actuelles seront conservées. Faites une sauvegarde avant de continuer."))return;
    const updates={};let count=0;
    allowed.forEach(kind=>{const records=root[kind];if(records&&typeof records==="object")Object.entries(records).forEach(([id,value])=>{if(value&&typeof value==="object"){updates[`rdn/${kind}/${id}`]=value;count++;}});});
    if(!count)throw new Error("Aucun enregistrement exploitable dans la sauvegarde.");
    await db.ref().update(updates);await auditSafely("restore","system","backup",{nom:file.name},`Restauration fusionnée : ${count} enregistrements`);
    alert(`${count} enregistrements restaurés. Les données non présentes dans le fichier n'ont pas été supprimées.`);
  }catch(error){alert("Restauration impossible : "+error.message);}
}

// Ajout des actions contextuelles aux listes, sans remplacer le rendu historique.
const renderKindBasePro = renderKindBaseImplementation;
function renderKind(kind){
  renderKindBasePro(kind);
  const list=document.getElementById("list-"+kind);if(!list)return;
  if(kind==="clients"){
    const entries=Object.entries(dataCache.clients||{}).sort((a,b)=>(Number(b[1]?.createdAt)||0)-(Number(a[1]?.createdAt)||0));
    [...list.children].forEach((card,index)=>{const entry=entries[index];if(!entry||card.querySelector(".rdn-history-button"))return;const button=document.createElement("button");button.type="button";button.className="rdn-history-button";button.textContent="Historique client";button.onclick=()=>showClientHistory(entry[0],entry[1]);card.querySelector(".record-actions")?.append(button);});
  }
  if(kind==="excursions"){
    const entries=Object.entries(dataCache.excursions||{}).sort((a,b)=>(Number(b[1]?.createdAt)||0)-(Number(a[1]?.createdAt)||0));
    [...list.children].forEach((card,index)=>{const entry=entries[index];if(!entry||card.querySelector(".rdn-participants-button"))return;const button=document.createElement("button");button.type="button";button.className="rdn-participants-button";button.textContent="Liste participants / PDF";button.onclick=()=>printParticipants(entry[0]);card.querySelector(".record-actions")?.append(button);});
  }
}

// Renforce l'affichage de la progression de synchronisation et le statut de rôle.
const applyRoleAccessBasePro = applyRoleAccessBaseImplementation;
function applyRoleAccess(){applyRoleAccessBasePro();const admin=isAdmin();document.querySelectorAll(".rdn-backup-tools").forEach(el=>el.classList.toggle("hidden",!admin));document.querySelectorAll('#rdnMonthlyFinancePanel').forEach(el=>el.classList.toggle("hidden",!admin));}

// Styles additionnels : responsive, outils, paiements et graphiques.
(function injectFinalProfessionalStyles(){
  if(document.getElementById("rdnFinalProStyles"))return;
  const style=document.createElement("style");style.id="rdnFinalProStyles";style.textContent=`
  .rdn-report-heading{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}.rdn-report-heading h3{margin:0}.rdn-report-heading button{font-size:11px;padding:8px 10px}.rdn-module-tools{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin:12px 0}.rdn-module-tools input{flex:1 1 220px;min-width:160px}.rdn-module-tools small{color:#6b786e;font-size:11px}.rdn-export-button,.rdn-history-button,.rdn-participants-button{padding:9px 12px;font-size:12px}.rdn-history-button,.rdn-participants-button{background:#426b50;margin:6px 6px 0 0}.rdn-filter-hidden{display:none!important}.rdn-payment-button{background:#176b9a}.rdn-payment-button:disabled{opacity:.55;cursor:not-allowed}.rdn-payment-history{margin-top:10px;font-size:12px;color:#506052}.rdn-payment-history summary{cursor:pointer;font-weight:700}.rdn-payment-list{margin-top:7px;border-top:1px solid #e8eee8}.rdn-payment-row{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid #edf0ed}.rdn-payment-row span{overflow-wrap:anywhere}.rdn-payment-row strong{white-space:nowrap}.rdn-chart-legend{display:flex;gap:18px;flex-wrap:wrap;color:#6b786e;font-size:11px;margin-bottom:10px}.rdn-chart-legend i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px}.income-dot{background:#34865a}.cost-dot{background:#d59a42}.rdn-monthly-chart{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;align-items:end;min-height:150px}.rdn-month-column{display:flex;flex-direction:column;align-items:center;gap:5px;min-width:0}.rdn-month-bars{height:105px;width:100%;display:flex;align-items:end;justify-content:center;gap:4px;border-bottom:1px solid #dfe7df}.rdn-month-bars span{width:30%;max-width:22px;border-radius:5px 5px 0 0;min-height:2px}.rdn-month-bars .income{background:#34865a}.rdn-month-bars .cost{background:#d59a42}.rdn-month-column small{color:#68766d;text-transform:capitalize}.rdn-month-column b{font-size:10px;color:#45584a;text-align:center;overflow-wrap:anywhere}.rdn-backup-tools p{font-size:12px;color:#68766d;line-height:1.5}.rdn-backup-tools button{margin:4px 5px 4px 0}.rdn-backup-tools .light{border:1px solid #d5dfd5}@media(max-width:600px){.rdn-monthly-chart{gap:4px}.rdn-month-column b{font-size:9px}.rdn-payment-row{flex-direction:column;gap:3px}}
  `;document.head.append(style);
})();


// ===== LANCEMENT =====

const expenseTypeSelect = document.getElementById("typeDepense");
if (expenseTypeSelect) expenseTypeSelect.addEventListener("change", toggleExpenseExcursionField);
toggleExpenseExcursionField();

init();
