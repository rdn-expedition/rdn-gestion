
const $ = id => document.getElementById(id);

let auth, db, currentUser = null;
const dataCache = { clients:{}, excursions:{}, reservations:{}, factures:{}, depenses:{} };
const dbListeners = {};
let savingGenericForm = false;

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
      startRealtimeSync();
      updateInvoiceNumberPreview();
    } else {
      stopRealtimeSync();
      kinds.forEach(kind => { dataCache[kind] = {}; renderKind(kind); });
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
    if (savingGenericForm) return;
    const obj = {};
    new FormData(f).forEach((v,k) => { obj[k]=v; });
    if (f.dataset.kind === "reservations") {
      const client=dataCache.clients[obj.clientId], excursion=dataCache.excursions[obj.excursionId];
      if (!client || !excursion) { alert("Veuillez sélectionner un client et une excursion valides."); return; }
      obj.client=client.nom||""; obj.clientTelephone=client.telephone||"";
      obj.excursion=excursion.titre||""; obj.excursionDate=excursion.date||"";
      obj.prixUnitaire=parseMontant(excursion.prix); obj.clientId=String(obj.clientId); obj.excursionId=String(obj.excursionId);
      obj.personnes=Math.max(1,Number(obj.personnes)||1); obj.acompte=parseMontant(obj.acompte);
    }
    obj.createdAt=Date.now(); obj.createdBy=currentUser.uid; obj.createdByEmail=currentUser.email||"";
    savingGenericForm=true;
    const submit=f.querySelector('button[type="submit"], button:not([type])'); if(submit) submit.disabled=true;
    try {
      await db.ref("rdn/"+f.dataset.kind).push(obj); f.reset();
      if(f.dataset.kind==="reservations" && f.elements.personnes) f.elements.personnes.value=1;
      alert("Enregistrement effectué avec succès !");
    } catch(err) { alert("Erreur d'enregistrement : "+err.message); }
    finally { savingGenericForm=false; if(submit) submit.disabled=false; }
  };
});

// ===== SYNCHRONISATION TEMPS RÉEL =====
function startRealtimeSync() {
  if(!db||!currentUser) return;
  kinds.forEach(kind=>{
    if(dbListeners[kind]) return;
    const ref=db.ref("rdn/"+kind);
    const callback=snapshot=>{
      dataCache[kind]=snapshot.val()||{};
      renderKind(kind); refreshStats();
      if(kind==="clients"||kind==="excursions") refreshReservationChoices();
      if(kind==="factures") updateInvoiceNumberPreview();
      const status=document.getElementById("syncStatus"); if(status) status.textContent="Synchronisation en temps réel";
    };
    ref.on("value",callback,error=>{
      console.error("Synchronisation "+kind+" impossible :",error);
      const status=document.getElementById("syncStatus"); if(status) status.textContent="Erreur de synchronisation";
    });
    dbListeners[kind]={ref,callback};
  });
}
function stopRealtimeSync() {
  Object.values(dbListeners).forEach(({ref,callback})=>ref.off("value",callback));
  Object.keys(dbListeners).forEach(k=>delete dbListeners[k]);
  const status=document.getElementById("syncStatus"); if(status) status.textContent="Déconnecté";
}
function load(kind) { renderKind(kind); }
function renderKind(kind) {
  const host=$("list-"+kind); if(!host) return;
  host.innerHTML="";
  Object.entries(dataCache[kind]||{}).sort((a,b)=>(Number(b[1]?.createdAt)||0)-(Number(a[1]?.createdAt)||0)).forEach(([id,o])=>{
    if(kind==="factures"){renderInvoiceCard(host,id,o);return;}
    const div=document.createElement("div"); div.className="item";
    const main=(labels[kind]||[]).map(k=>o[k]!==undefined&&o[k]!==""?`${k}: ${o[k]}`:"").filter(Boolean).join(" • ");
    const left=document.createElement("span"); left.textContent=main||"(Sans détail)";
    const right=document.createElement("small"); right.textContent=new Date(Number(o.createdAt)||Date.now()).toLocaleDateString("fr-FR");
    const actions=document.createElement("div"); actions.className="record-actions";
    const edit=document.createElement("button"); edit.type="button"; edit.className="record-edit"; edit.textContent="Modifier"; edit.onclick=()=>editRecord(kind,id,o);
    const del=document.createElement("button"); del.type="button"; del.className="record-delete"; del.textContent="Supprimer"; del.onclick=()=>deleteRecord(kind,id,o);
    actions.append(edit,del); div.append(left,right,actions);
    if(kind==="reservations") { const inv=document.createElement("button"); inv.type="button"; inv.className="record-invoice"; inv.textContent="Préparer une facture"; inv.onclick=()=>prepareInvoiceFromReservation({...o,id}); div.append(inv); }
    host.append(div);
  });
  if(kind==="reservations") refreshReservationChoices();
}
function refreshStats() {
  [["clients","nClients"],["excursions","nExcursions"],["reservations","nReservations"]].forEach(([k,id])=>{const el=$(id);if(el)el.textContent=Object.keys(dataCache[k]||{}).length;});
  const total=Object.values(dataCache.depenses||{}).reduce((sum,d)=>sum+parseMontant(d?.montant),0);
  const el=$("sumDepenses"); if(el)el.textContent=total.toLocaleString("fr-FR")+" Ar";
}

// ===== LIAISON CLIENTS / EXCURSIONS / RÉSERVATIONS =====
function refreshReservationChoices() {
  const form=document.querySelector('form[data-kind="reservations"]'); if(!form)return;
  const cs=form.elements.clientId, es=form.elements.excursionId; if(!cs||!es)return;
  const oldC=cs.value, oldE=es.value;
  cs.innerHTML='<option value="">Choisir un client</option>';
  Object.entries(dataCache.clients||{}).forEach(([id,c])=>{const op=document.createElement("option");op.value=id;op.textContent=c.nom||"Client sans nom";cs.append(op);});
  es.innerHTML='<option value="">Choisir une excursion</option>';
  Object.entries(dataCache.excursions||{}).forEach(([id,x])=>{const op=document.createElement("option");op.value=id;op.textContent=[x.titre||"Excursion",x.date||"",x.prix?parseMontant(x.prix).toLocaleString("fr-FR")+" Ar":""].filter(Boolean).join(" — ");es.append(op);});
  if(oldC&&dataCache.clients[oldC])cs.value=oldC; if(oldE&&dataCache.excursions[oldE])es.value=oldE;
}
async function editRecord(kind,id,record) {
  const updated={...record};
  if(kind==="reservations") {
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
  updated.updatedAt=Date.now(); updated.updatedBy=currentUser?.uid||"";
  try{await db.ref("rdn/"+kind+"/"+id).update(updated);}catch(e){alert("Modification impossible : "+e.message);}
}
async function editInvoiceRecord(id, invoice) {
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
  updated.solde = updated.montant - updated.acompte;
  updated.updatedAt = Date.now();
  updated.updatedBy = currentUser?.uid || "";
  try { await db.ref("rdn/factures/" + id).update(updated); }
  catch (error) { alert("Modification de la facture impossible : " + error.message); }
}

async function deleteRecord(kind,id,record) {
  const label=record.nom||record.titre||record.client||record.libelle||record.numero||"cet élément";
  if(!confirm("Confirmer la suppression de "+label+" ? Cette action est définitive."))return;
  try{await db.ref("rdn/"+kind+"/"+id).remove();}catch(e){alert("Suppression impossible : "+e.message);}
}
function prepareInvoiceFromReservation(r) {
  const client=dataCache.clients[r.clientId]||{}, excursion=dataCache.excursions[r.excursionId]||{}, form=$("invoiceForm"); if(!form)return;
  form.elements.client.value=r.client||client.nom||"";
  form.elements.telephone.value=r.clientTelephone||client.telephone||"";
  form.elements.objet.value=r.excursion||excursion.titre||"";
  form.elements.dateVoyage.value="";
  form.elements.personnes.value=Math.max(1,Number(r.personnes)||1);
  const amount=parseMontant(r.prixUnitaire||excursion.prix)*Math.max(1,Number(r.personnes)||1);
  form.elements.montant.value=amount>=10000?amount:"";
  form.elements.acompte.value=Math.max(10000,parseMontant(r.acompte));
  form.dataset.reservationId=r.id||"";
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
    if (invoiceForm.dataset.reservationId) o.reservationId = invoiceForm.dataset.reservationId;
    o.createdBy = currentUser?.uid || "";
    o.createdByEmail = currentUser?.email || "";

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
      delete invoiceForm.dataset.reservationId;

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
