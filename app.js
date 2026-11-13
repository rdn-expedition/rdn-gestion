
const $ = id => document.getElementById(id);

let auth, db, currentUser = null;

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
  depenses: ["libelle", "categorie", "montant", "date"]
};

// Configuration Firebase
function configured() {
  return firebaseConfig.apiKey &&
    !firebaseConfig.apiKey.startsWith("VOTRE_") &&
    firebaseConfig.appId &&
    !firebaseConfig.appId.startsWith("VOTRE_");
}

// Conversion montant en nombre
function parseMontant(value) {
  if (value === null || value === undefined) return 0;

  const montant = String(value).replace(/[^\d-]/g, "");
  return Number(montant) || 0;
}

// Initialisation
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
    currentUser = u;

    $("login").classList.toggle("hidden", !!u);
    $("app").classList.toggle("hidden", !u);

    if (u) {
      kinds.forEach(load);
      refreshStats();
      updateInvoiceNumberPreview();
    }
  });
}

// Connexion
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

// Déconnexion
$("logoutBtn").onclick = () => auth.signOut();

// Navigation
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
    if (b.dataset.page === "factures") updateInvoiceNumberPreview();
  };
});

// Enregistrement des données
document.querySelectorAll("form[data-kind]").forEach(f => {
  f.onsubmit = async e => {
    e.preventDefault();

    if (!db) {
      alert("Firebase n'est pas encore configuré.");
      return;
    }

    const obj = {};

    new FormData(f).forEach((v, k) => {
      obj[k] = v;
    });

    obj.createdAt = Date.now();

    try {
      await db.ref("rdn/" + f.dataset.kind).push(obj);

      f.reset();

      await load(f.dataset.kind);
      await refreshStats();

      alert("Enregistrement effectué avec succès !");
    } catch (err) {
      alert("Erreur d'enregistrement : " + err.message);
    }
  };
});

// Chargement des données
async function load(kind) {
  if (!db) return;

  try {
    const snap = await db.ref("rdn/" + kind).once("value");
    const data = snap.val() || {};

    const host = $("list-" + kind);
    host.innerHTML = "";

    Object.entries(data)
      .sort((a, b) =>
        (Number(b[1].createdAt) || 0) -
        (Number(a[1].createdAt) || 0)
      )
      .forEach(([id, o]) => {
        if (kind === "factures") { renderInvoiceCard(host, id, o); return; }
        const div = document.createElement("div");
        div.className = "item";

        const main = labels[kind]
          .map(k => o[k] ? `${k}: ${o[k]}` : "")
          .filter(Boolean)
          .join(" • ");

        const left = document.createElement("span");
        left.textContent = main;

        const right = document.createElement("small");
        right.textContent = new Date(
          o.createdAt || Date.now()
        ).toLocaleDateString("fr-FR");

        div.append(left, right);
        host.append(div);
      });

  } catch (e) {
    console.error("Erreur chargement " + kind, e);
  }
}

// Tableau de bord

async function refreshStats() {
  if (!db) return;

  try {
    const stats = [
      ["clients", "nClients"],
      ["excursions", "nExcursions"],
      ["reservations", "nReservations"]
    ];

    for (const [kind, id] of stats) {
      const s = await db.ref("rdn/" + kind).once("value");
      $(id).textContent = s.numChildren();
    }

    // Maka ny dépenses rehetra ao Firebase
    const snap = await db.ref("rdn/depenses").once("value");

    let total = 0;

    snap.forEach(item => {
      const d = item.val();

      if (d && d.montant !== undefined) {
        let montant = String(d.montant)
          .replace(/\s/g, "")
          .replace(/Ar/gi, "")
          .replace(/,/g, ".")
          .replace(/[^\d.-]/g, "");

        total += Number(montant) || 0;
      }
    });

    $("sumDepenses").textContent =
      total.toLocaleString("fr-FR") + " Ar";

    console.log("Nombre dépenses :", snap.numChildren());
    console.log("Total dépenses :", total);

  } catch (e) {
    console.error("Erreur actualisation tableau de bord :", e);
  }
}




// ===== Factures V2 : ajout indépendant, sans toucher aux autres modules V1 =====
function invoiceMoney(value) {
  return (Number(value) || 0).toLocaleString("fr-FR") + " Ar";
}
// Renumérotation séquentielle des factures d'une même année.
// Les anciennes références aléatoires (ex. FA-AAAA-GGLQVC) et les anciens
// numéros courts sont normalisés sans toucher aux montants ni aux clients.
function currentInvoiceYear() {
  // L'année est toujours celle de l'appareil au moment de la création.
  return new Date().getFullYear();
}
function invoiceYear(item) {
  if (!item) return 0;
  const stamp = Number(item.createdAt);
  if (stamp > 0) return new Date(stamp).getFullYear();
  // Compatibilité avec les anciennes factures qui n'ont pas createdAt.
  const numberMatch = String(item.numero || "").match(/^FA-(\d{4})-/);
  if (numberMatch) return Number(numberMatch[1]);
  const dateMatch = String(item.date || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dateMatch) return Number(dateMatch[3]);
  // Une facture sans date exploitable ne doit pas être attribuée à l'année actuelle.
  return 0;
}
function renumberInvoices(records, year = currentInvoiceYear()) {
  const all = { ...(records || {}) };
  const entries = Object.entries(all)
    .filter(([, item]) => invoiceYear(item, year) === year)
    .sort((a, b) => {
      const ta = Number(a[1] && a[1].createdAt) || 0;
      const tb = Number(b[1] && b[1].createdAt) || 0;
      return ta - tb || a[0].localeCompare(b[0]);
    });
  entries.forEach(([id, item], index) => {
    all[id] = { ...item, numero: `FA-${year}-${String(index + 1).padStart(3, "0")}` };
  });
  return all;
}
function nextInvoiceNumber(records, year = currentInvoiceYear()) {
  const count = Object.values(records || {}).filter(item => invoiceYear(item, year) === year).length;
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
function renderInvoiceCard(host, id, o) {
  const total = Number(o.montant) || 0;
  const paid = Number(o.acompte) || 0;
  const balance = Math.max(0, total - paid);
  const card = document.createElement("div"); card.className = "invoice-card";
  const main = document.createElement("div"); main.className = "invoice-card-main";
  const title = document.createElement("strong"); title.textContent = `${o.numero || "Facture"} • ${o.client || "Client"}`;
  const detail = document.createElement("div"); detail.textContent = `${o.objet || "—"} • Total : ${invoiceMoney(total)}`;
  const status = document.createElement("span"); status.className = "invoice-status" + (balance > 0 ? " pending" : "");
  status.textContent = balance <= 0 ? "Payée" : paid > 0 ? "Partiellement payée" : "Non payée";
  const meta = document.createElement("small"); meta.textContent = `Acompte : ${invoiceMoney(paid)} • Solde : ${invoiceMoney(balance)} • ${o.date || ""}`;
  main.append(title, detail, status, meta);
  const actions = document.createElement("div"); actions.className = "invoice-actions";
  const print = document.createElement("button"); print.type = "button"; print.textContent = "Voir / PDF"; print.onclick = () => printRdnInvoice(o);
  actions.append(print); card.append(main, actions); host.append(card);
}
const invoiceForm = document.getElementById("invoiceForm");
if (invoiceForm) invoiceForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!db) { alert("Firebase n'est pas encore configuré."); return; }
  const fd = new FormData(invoiceForm);
  let o = {};
  fd.forEach((value, key) => o[key] = String(value).trim());
  o.montant = Number(o.montant) || 0; o.acompte = Number(o.acompte) || 0;
  o.personnes = Math.max(1, Number(o.personnes) || 1);
  if (o.montant <= 0) { alert("Le montant total doit être supérieur à zéro."); return; }
  if (o.acompte > o.montant) { alert("L'acompte ne peut pas dépasser le montant total."); return; }
  o.solde = o.montant - o.acompte;
  o.date = new Date().toLocaleDateString("fr-FR");
  o.createdAt = Date.now(); o.type = "facture-acompte";
  try {
    // Numérotation séquentielle atomique sur le nœud existant rdn/factures.
    // Les anciennes factures et leurs numéros sont conservés sans modification.
    const invoicesRef = db.ref("rdn/factures");
    const newRef = invoicesRef.push();
    const year = currentInvoiceYear();
    let savedInvoice = null;
    const result = await invoicesRef.transaction(records => {
      const all = { ...(records || {}) };
      all[newRef.key] = { ...o, id: newRef.key };
      // Normalise aussi les anciennes références aléatoires pour obtenir
      // une seule séquence continue : FA-AAAA-001, FA-AAAA-002, etc.
      return renumberInvoices(all, year);
    }, undefined, false);
    if (!result.committed) throw new Error("La transaction de numérotation n'a pas été validée.");
    const committed = result.snapshot.val() || {};
    o = committed[newRef.key];
    if (!o || !o.numero) throw new Error("Le numéro de facture n'a pas été attribué.");
    invoiceForm.reset(); invoiceForm.elements.personnes.value = 1; invoiceForm.elements.acompte.value = 0;
    await load("factures");
    await updateInvoiceNumberPreview();
    printRdnInvoice(o);
  } catch (error) { alert("Erreur lors de l'enregistrement de la facture : " + error.message); }
});
function printRdnInvoice(o) {
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const total = Number(o.montant) || 0;
  const paid = Number(o.acompte) || 0;
  const balance = Math.max(0, total - paid);
  const included = String(o.inclus || "").split(/\r?\n/).filter(Boolean).map(x => `<li>${esc(x)}</li>`).join("");
  const stampStatus = balance <= 0 ? "FACTURE ACQUITTÉE" : paid > 0 ? "FACTURE D’ACOMPTE" : "FACTURE";
  const dueDate = o.echeance || o.dateVoyage || "—";
  const logoUrl = new URL("logo-rdn.png", window.location.href).href;
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.numero || "Facture RDN")}</title><style>
  @page{size:A4;margin:8mm}
  *{box-sizing:border-box}
  html,body{margin:0;padding:0}
  body{font-family:Arial,Helvetica,sans-serif;color:#171717;font-size:12px;line-height:1.34;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .sheet{width:100%;min-height:280mm;position:relative}
  .top{background:#168fe8;color:#fff;padding:9px 11px 8px;display:grid;grid-template-columns:112px 1fr;gap:12px;align-items:center;border:2px solid #fff;outline:1px solid #d7e9f7}
  .logo{width:112px;height:112px;object-fit:contain;background:#fff;display:block}
  .brand h1{font-size:34px;line-height:1.05;margin:0 0 7px;text-align:center;letter-spacing:.1px;white-space:nowrap}
  .mail{text-align:center;font-size:14px;margin:0 0 11px}
  .meta{display:flex;justify-content:space-between;align-items:center;gap:8px;font-weight:bold;margin-top:7px;font-size:12px}
  .client{padding:11px 9px 9px;line-height:1.85;font-size:13px}
  .details{width:100%;border-collapse:collapse;margin-top:2px;font-size:13px}
  .details td{padding:9px 11px;border:2px solid #fff;background:#e2f1fc}
  .details .head{background:#b9def9}
  .details td:first-child{font-weight:bold;width:54%}
  .details .totalrow td{background:#fff;font-size:14px;padding-top:10px;padding-bottom:10px}
  .block{padding:8px 12px;line-height:1.45;font-size:13px}
  .block ul{margin:2px 0 0 25px;padding-left:12px}
  .section-label{font-weight:bold;color:#111}
  .note{margin-top:1px}
  .due{margin-top:2px}
  .bottom{display:grid;grid-template-columns:1fr 1.55fr;gap:8px;align-items:center;margin:12px 8px 0;min-height:155px}
  .contacts{font-size:13px;line-height:2.2}
  .seal-sign{display:flex;align-items:center;justify-content:space-between;gap:8px}
  .stamp{width:170px;height:170px;flex:0 0 170px;color:#168fe8}
  .stamp svg{width:100%;height:100%;display:block}
  .responsable{text-align:center;min-width:125px;font-weight:bold;color:#111;font-size:13px}
  .signline{height:42px;border-bottom:1.5px solid #168fe8;margin:6px 0 5px}
  .responsable .name{font-size:12px;line-height:1.35;color:#168fe8}
  .thanks{font-style:italic;color:#111;margin:8px 9px 10px;font-size:13px;line-height:1.5}
  .footer{height:13px;background:#168fe8;border-top:3px solid #dceefb}
  @media screen{body{max-width:800px;margin:12px auto;padding:12px;background:#fff;box-shadow:0 1px 8px #ccd5dd}}
  @media print{body{padding:0}.top,.details td,.footer{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head><body><main class="sheet">
  <header class="top"><img class="logo" src="${esc(logoUrl)}" alt="Logo RDN"><div class="brand"><h1>RDN EXPÉDITION</h1><div class="mail">rdnexpedition@gmail.com</div><div class="meta"><span>NIF : 5019233964</span><span>FACTURE N° : ${esc(o.numero || "")}</span></div><div class="meta"><span>STAT : 79120 11 2025 0 04198</span><span>${esc(o.date || "")}</span></div></div></header>
  <section class="client"><b>Client(e) :</b> ${esc(o.client)}<br><b>Téléphone :</b> ${esc(o.telephone || "—")}<br><b>Adresse :</b> ${esc(o.adresse || "—")}</section>
  <table class="details"><tr><td class="head" colspan="2"><b>Détails des services :</b> ${esc(o.objet)}${o.dateVoyage ? " – " + esc(o.dateVoyage) : ""}</td></tr><tr><td>Effectif :</td><td>${Number(o.personnes) || 1} personne(s)</td></tr><tr><td>Acompte payé :</td><td>${invoiceMoney(paid)}</td></tr><tr><td>Solde restant à payer :</td><td>${invoiceMoney(balance)}</td></tr><tr class="totalrow"><td>Montant total du voyage :</td><td>${invoiceMoney(total)}</td></tr></table>
  <section class="block"><b>Mode de paiement :</b> ${esc(o.modePaiement || "—")}</section>
  <section class="block"><b class="section-label">INCLUS :</b><ul>${included || "<li>Prestations indiquées ci-dessus</li>"}</ul></section>
  <section class="block note"><b class="section-label">NB :</b><br>${esc(o.note || "—")}</section>
  <section class="block due"><b>Date d’échéance :</b> ${esc(dueDate)}</section>
  <section class="bottom"><div class="contacts">🔵 Facebook : RDN Expédition<br>🟢 WhatsApp : 034 70 249 97</div><div class="seal-sign">
    <div class="stamp"><svg viewBox="0 0 200 200" role="img" aria-label="Cachet RDN Expédition"><defs><path id="stampTop" d="M 25,100 A 75,75 0 0,1 175,100"/><path id="stampBottom" d="M 20,105 A 80,80 0 0,0 180,105"/></defs><circle cx="100" cy="100" r="94" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="100" cy="100" r="86" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="100" cy="100" r="61" fill="none" stroke="currentColor" stroke-width="1.5"/><text font-size="16" font-weight="bold" letter-spacing="1"><textPath href="#stampTop" startOffset="50%" text-anchor="middle">RDN EXPÉDITION</textPath></text><text font-size="10.5" font-weight="bold" letter-spacing=".2"><textPath href="#stampBottom" startOffset="50%" text-anchor="middle">RANDONNÉE • DÉCOUVERTE • NATURE</textPath></text><path d="M55 99 L82 70 L96 84 L113 61 L147 99 Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M68 99 L86 83 L96 92 L113 76 L136 99" fill="none" stroke="currentColor" stroke-width="2"/><text x="100" y="119" text-anchor="middle" font-size="15" font-weight="bold">RDN</text><text x="100" y="134" text-anchor="middle" font-size="11" font-weight="bold">EXPÉDITION</text><text x="100" y="153" text-anchor="middle" font-size="9" font-weight="bold">${esc(stampStatus)}</text><path d="M27 100 l8 -5 l0 10 z M173 100 l-8 -5 l0 10 z" fill="currentColor"/></svg></div>
    <div class="responsable">Le responsable<div class="signline"></div><div class="name">RANOHARIANTSOA<br>Dina Nasandratra</div></div>
  </div></section>
  <div class="thanks">Merci d’avoir choisi RDN Expédition.<br>Nous ferons de votre voyage une expérience inoubliable.</div><div class="footer"></div>
  </main><script>window.onload=()=>setTimeout(()=>window.print(),600);</script></body></html>`;
  const win = window.open("", "_blank");
  if (!win) { alert("Autorisez les fenêtres pop-up pour afficher la facture."); return; }
  win.document.open(); win.document.write(html); win.document.close();
}

// Lancement
init();
