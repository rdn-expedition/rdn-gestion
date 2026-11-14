
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

// ===== CHARGEMENT DES DONNÉES =====

async function load(kind) {
  if (!db) return;

  try {
    const snap = await db.ref("rdn/" + kind).once("value");
    const data = snap.val() || {};

    const host = $("list-" + kind);
    if (!host) return;

    host.innerHTML = "";

    Object.entries(data)
      .sort((a, b) =>
        (Number(b[1].createdAt) || 0) -
        (Number(a[1].createdAt) || 0)
      )
      .forEach(([id, o]) => {
        if (kind === "factures") {
          renderInvoiceCard(host, id, o);
          return;
        }

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

// ===== TABLEAU DE BORD =====

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

// ==================================================
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
  const paid = Number(o.acompte) || 0;
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

  actions.append(print);
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

    if (!db) {
      alert("Firebase n'est pas encore configuré.");
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

    try {
      const invoicesRef = db.ref("rdn/factures");
      const newRef = invoicesRef.push();

      const year = currentInvoiceYear();

      const result = await invoicesRef.transaction(records => {
        const all = { ...(records || {}) };

        all[newRef.key] = {
          ...o,
          id: newRef.key
        };

        return renumberInvoices(all, year);

      }, undefined, false);

      if (!result.committed) {
        throw new Error("La transaction de numérotation n'a pas été validée.");
      }

      const committed = result.snapshot.val() || {};

      o = committed[newRef.key];

      if (!o || !o.numero) {
        throw new Error("Le numéro de facture n'a pas été attribué.");
      }

      invoiceForm.reset();

      invoiceForm.elements.personnes.value = 1;
      invoiceForm.elements.montant.value = "";
      invoiceForm.elements.acompte.value = 10000;

      await load("factures");
      await updateInvoiceNumberPreview();

      printRdnInvoice(o);

    } catch (error) {
      alert("Erreur lors de l'enregistrement de la facture : " + error.message);
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
  const paid = Number(o.acompte) || 0;
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
  margin: 0;
  padding:0;
  line-height:1.15;
}

.thanks{
  font-style:italic;
  color:#111;
  margin:26px 18px 0;
  padding:0;
  font-size:13px;
  line-height:1.2;
  position:relative;
  z-index:1;
}

.seal-sign{
  position:relative;
  display:block;
}

.stamp-block{
  position:absolute;
  right:0;
  bottom:0;
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
    <td>Acompte payé :</td>
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

// ===== LANCEMENT =====

init();
