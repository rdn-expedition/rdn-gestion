
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
function invoiceNumberFromKey(key) {
  const year = new Date().getFullYear();
  return `FA-${year}-${String(key).slice(-6).toUpperCase()}`;
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
  const fd = new FormData(invoiceForm), o = {};
  fd.forEach((value, key) => o[key] = String(value).trim());
  o.montant = Number(o.montant) || 0; o.acompte = Number(o.acompte) || 0;
  o.personnes = Math.max(1, Number(o.personnes) || 1);
  if (o.montant <= 0) { alert("Le montant total doit être supérieur à zéro."); return; }
  if (o.acompte > o.montant) { alert("L'acompte ne peut pas dépasser le montant total."); return; }
  o.solde = o.montant - o.acompte;
  o.date = new Date().toLocaleDateString("fr-FR");
  o.createdAt = Date.now(); o.type = "facture-acompte";
  try {
    // Firebase push key donne un identifiant unique, sans nouveau chemin de règles Firebase.
    const ref = db.ref("rdn/factures").push();
    o.numero = invoiceNumberFromKey(ref.key); o.id = ref.key;
    await ref.set(o);
    invoiceForm.reset(); invoiceForm.elements.personnes.value = 1; invoiceForm.elements.acompte.value = 0;
    await load("factures");
    printRdnInvoice(o);
  } catch (error) { alert("Erreur lors de l'enregistrement de la facture : " + error.message); }
});
function printRdnInvoice(o) {
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const total = Number(o.montant) || 0, paid = Number(o.acompte) || 0, balance = Math.max(0,total-paid);
  const included = String(o.inclus || "").split(/\r?\n/).filter(Boolean).map(x=>`<li>${esc(x)}</li>`).join("");
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(o.numero)}</title><style>
  *{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#161616;margin:0;padding:18px;font-size:14px}.top{background:#2495e8;color:#fff;padding:12px;display:grid;grid-template-columns:105px 1fr;gap:12px;align-items:center}.logo{width:105px;height:105px;object-fit:contain;background:#fff}.brand h1{font-size:34px;margin:0;white-space:nowrap}.mail{text-align:center;margin:8px}.meta{display:flex;justify-content:space-between;gap:8px;font-weight:bold;margin-top:8px}.client{padding:14px 8px;line-height:1.9}.details{width:100%;border-collapse:collapse;margin-top:8px}.details td{padding:12px;border:2px solid white;background:#e3f1fb}.details .head{background:#b8dcf8}.details td:first-child{font-weight:bold;width:53%}.total{font-weight:bold;padding:15px}.block{padding:8px 14px;line-height:1.6}.block ul{margin:0 0 0 28px}.signature{display:flex;justify-content:space-between;align-items:center;margin:24px 10px}.stamp{border:4px solid #65b4e9;border-radius:50%;width:160px;height:160px;color:#58aee8;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;font-weight:bold;transform:rotate(-8deg)}.stamp b{font-size:20px}.responsable{color:#58aee8;font-weight:bold;text-align:center}.thanks{font-style:italic;margin-top:22px}@media print{body{padding:0}.top,.details td{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head><body>
  <div class="top"><img class="logo" src="logo-rdn.png"><div class="brand"><h1>RDN EXPÉDITION</h1><div class="mail">rdnexpedition@gmail.com</div><div class="meta"><span>NIF : 5019233964</span><span>FACTURE N° : ${esc(o.numero)}</span></div><div class="meta"><span>STAT : 79120 11 2025 0 04198</span><span>${esc(o.date || "")}</span></div></div></div>
  <div class="client"><b>Client(e) :</b> ${esc(o.client)}<br><b>Téléphone :</b> ${esc(o.telephone || "—")}<br><b>Adresse :</b> ${esc(o.adresse || "—")}</div>
  <table class="details"><tr><td class="head" colspan="2"><b>Détails des services :</b> ${esc(o.objet)} ${o.dateVoyage ? "- "+esc(o.dateVoyage):""}</td></tr><tr><td>Effectif :</td><td>${o.personnes} personne(s)</td></tr><tr><td>Acompte payé :</td><td>${invoiceMoney(paid)}</td></tr><tr><td>Solde restant à payer :</td><td>${invoiceMoney(balance)}</td></tr></table>
  <div class="total">Montant total du voyage : ${invoiceMoney(total)}</div><div class="block"><b>Mode de paiement :</b> ${esc(o.modePaiement || "—")}</div>
  <div class="block"><b>INCLUS :</b><ul>${included}</ul></div><div class="block"><b>NB :</b><br>${esc(o.note || "—")}</div><div class="block"><b>Date d'échéance :</b> ${esc(o.echeance || o.dateVoyage || "—")}</div>
  <div class="signature"><div>🔵 RDN Expédition<br>🟢 034 70 249 97</div><div class="stamp">RDN EXPÉDITION<br><small>Voyage organisé</small><b>FACTURE<br>D'ACOMPTE</b></div></div><div class="responsable">RANOHARIANTSOA Dina Nasandratra</div>
  <div class="thanks">Merci d'avoir choisi RDN Expédition.<br>Nous ferons de votre voyage une expérience inoubliable.</div><script>window.onload=()=>setTimeout(()=>window.print(),400);</script></body></html>`;
  const win = window.open("", "_blank");
  if (!win) { alert("Autorisez les fenêtres pop-up pour afficher la facture."); return; }
  win.document.open(); win.document.write(html); win.document.close();
}

// Lancement
init();
