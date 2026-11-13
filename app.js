
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
function nextInvoiceNumber(records, year = new Date().getFullYear()) {
  const prefix = `FA-${year}-`;
  let max = 0;
  Object.values(records || {}).forEach(item => {
    const numero = String(item && item.numero || "");
    const match = numero.match(new RegExp(`^FA-${year}-(\\d{3,})$`));
    if (match) max = Math.max(max, Number(match[1]) || 0);
  });
  return prefix + String(max + 1).padStart(3, "0");
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
    const year = new Date().getFullYear();
    let savedInvoice = null;
    const result = await invoicesRef.transaction(records => {
      const all = records || {};
      const numero = nextInvoiceNumber(all, year);
      savedInvoice = { ...o, numero, id: newRef.key };
      all[newRef.key] = savedInvoice;
      return all;
    }, undefined, false);
    if (!result.committed || !savedInvoice) throw new Error("La transaction de numérotation n'a pas été validée.");
    o = savedInvoice;
    invoiceForm.reset(); invoiceForm.elements.personnes.value = 1; invoiceForm.elements.acompte.value = 0;
    await load("factures");
    printRdnInvoice(o);
  } catch (error) { alert("Erreur lors de l'enregistrement de la facture : " + error.message); }
});
function printRdnInvoice(o) {
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const total = Number(o.montant) || 0, paid = Number(o.acompte) || 0, balance = Math.max(0, total - paid);
  const included = String(o.inclus || "").split(/\r?\n/).filter(Boolean).map(x => `<li>${esc(x)}</li>`).join("");
  const stampStatus = balance <= 0 ? "FACTURE ACQUITTÉE" : paid > 0 ? "FACTURE D’ACOMPTE" : "FACTURE";
  const dueDate = o.echeance || o.dateVoyage || "—";
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.numero)}</title><style>
  @page{size:A4;margin:8mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#151b27;margin:0;padding:0;font-size:12px;line-height:1.35;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .top{background:#168fe8;color:#fff;padding:11px 13px 9px;display:grid;grid-template-columns:92px 1fr;gap:13px;align-items:center;border:2px solid #fff;outline:1px solid #d7e9f7}.logo{width:92px;height:92px;object-fit:contain;background:#fff}.brand h1{font-size:29px;line-height:1.05;margin:0;text-align:center;letter-spacing:.3px;white-space:nowrap}.slogan{text-align:center;font-size:15px;font-weight:bold;font-style:italic;margin:4px 0 5px}.mail{text-align:center;font-size:12px;margin-bottom:9px}.meta{display:flex;justify-content:space-between;gap:8px;font-weight:bold;margin-top:5px;font-size:11px}
  .client{padding:11px 8px 8px;line-height:1.75;font-size:12px}.details{width:100%;border-collapse:collapse;margin-top:2px;font-size:12px}.details td{padding:8px 10px;border:2px solid #fff;background:#e2f1fc}.details .head{background:#b9def9}.details td:first-child{font-weight:bold;width:54%}.details .totalrow td{background:#b4dcfa;font-weight:bold;font-size:15px}.block{padding:7px 10px;line-height:1.45;font-size:12px}.block ul{margin:2px 0 0 25px;padding-left:12px}.section-label{font-weight:bold;color:#123f9c}.note{margin-top:1px}.due{margin-top:2px}
  .bottom{display:grid;grid-template-columns:1fr 1.5fr;gap:10px;align-items:center;margin:10px 8px 0;min-height:116px}.contacts{font-size:12px;line-height:2}.seal-sign{display:flex;align-items:center;justify-content:space-between;gap:10px}.stamp{width:150px;height:150px;flex:0 0 150px;color:#073fc4}.stamp svg{width:100%;height:100%;display:block}.responsable{text-align:center;min-width:115px;font-weight:bold;color:#123f9c;font-size:11px}.signline{height:35px;border-bottom:1.5px solid #123f9c;margin:6px 0 5px}.responsable .name{font-size:11px;line-height:1.3}.thanks{font-style:italic;color:#123f9c;margin:8px 8px 7px;font-size:13px;line-height:1.4}.footer{height:22px;background:linear-gradient(170deg,#278d4b 0 35%,#fff 36% 43%,#087ed0 44% 76%,#278d4b 77%);border-top:1px solid #d5e7f4}
  @media screen{body{max-width:800px;margin:12px auto;padding:12px;box-shadow:0 1px 8px #ccd5dd}}@media print{body{padding:0}.top,.details td,.footer{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head><body>
  <div class="top"><img class="logo" src="logo-rdn.png" alt="Logo RDN"><div class="brand"><h1>RDN EXPÉDITION</h1><div class="slogan">Izay mandeha mahita</div><div class="mail">rdnexpedition@gmail.com</div><div class="meta"><span>NIF : 5019233964</span><span>FACTURE N° : ${esc(o.numero)}</span></div><div class="meta"><span>STAT : 79120 11 2025 0 04198</span><span>Date : ${esc(o.date || "")}</span></div></div></div>
  <div class="client"><b>Client(e) :</b> ${esc(o.client)}<br><b>Téléphone :</b> ${esc(o.telephone || "—")}<br><b>Adresse :</b> ${esc(o.adresse || "—")}</div>
  <table class="details"><tr><td class="head" colspan="2"><b>Détails des services :</b> ${esc(o.objet)}${o.dateVoyage ? " – " + esc(o.dateVoyage) : ""}</td></tr><tr><td>Effectif :</td><td>${Number(o.personnes) || 1} personne(s)</td></tr><tr><td>Acompte payé :</td><td>${invoiceMoney(paid)}</td></tr><tr><td>Solde restant à payer :</td><td>${invoiceMoney(balance)}</td></tr><tr class="totalrow"><td>Montant total du voyage :</td><td>${invoiceMoney(total)}</td></tr></table>
  <div class="block"><b>Mode de paiement :</b> ${esc(o.modePaiement || "—")}</div>
  <div class="block"><b class="section-label">INCLUS :</b><ul>${included || "<li>Prestations indiquées ci-dessus</li>"}</ul></div>
  <div class="block note"><b class="section-label">NB :</b><br>${esc(o.note || "—")}</div>
  <div class="block due"><b>Date d’échéance :</b> ${esc(dueDate)}</div>
  <div class="bottom"><div class="contacts">🔵 Facebook : RDN Expédition<br>🟢 WhatsApp : 034 70 249 97</div><div class="seal-sign">
    <div class="stamp"><svg viewBox="0 0 200 200" role="img" aria-label="Cachet RDN Expédition"><defs><path id="stampTop" d="M 25,100 A 75,75 0 0,1 175,100"/><path id="stampBottom" d="M 20,105 A 80,80 0 0,0 180,105"/></defs><circle cx="100" cy="100" r="94" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="100" cy="100" r="86" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="100" cy="100" r="61" fill="none" stroke="currentColor" stroke-width="1.5"/><text font-size="16" font-weight="bold" letter-spacing="1"><textPath href="#stampTop" startOffset="50%" text-anchor="middle">RDN EXPÉDITION</textPath></text><text font-size="10.5" font-weight="bold" letter-spacing=".35"><textPath href="#stampBottom" startOffset="50%" text-anchor="middle">RANDONNÉE • DÉCOUVERTE • NATURE</textPath></text><path d="M55 99 L82 70 L96 84 L113 61 L147 99 Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M68 99 L86 83 L96 92 L113 76 L136 99" fill="none" stroke="currentColor" stroke-width="2"/><text x="100" y="119" text-anchor="middle" font-size="15" font-weight="bold">RDN</text><text x="100" y="134" text-anchor="middle" font-size="11" font-weight="bold">EXPÉDITION</text><text x="100" y="153" text-anchor="middle" font-size="9" font-weight="bold">${esc(stampStatus)}</text><path d="M27 100 l8 -5 l0 10 z M173 100 l-8 -5 l0 10 z" fill="currentColor"/></svg></div>
    <div class="responsable">Le responsable<div class="signline"></div><div class="name">RANOHARIANTSOA<br>Dina Nasandratra</div></div>
  </div></div>
  <div class="thanks">Merci d’avoir choisi RDN Expédition.<br>Nous ferons de votre voyage une expérience inoubliable.</div><div class="footer"></div>
  <script>window.onload=()=>setTimeout(()=>window.print(),400);</script></body></html>`;
  const win = window.open("", "_blank");
  if (!win) { alert("Autorisez les fenêtres pop-up pour afficher la facture."); return; }
  win.document.open(); win.document.write(html); win.document.close();
}

// Lancement
init();
