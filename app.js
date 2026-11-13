const $ = id => document.getElementById(id);
let auth, db, currentUser = null;
const kinds = ["clients","excursions","reservations","factures","depenses"];
const labels = {
 clients:["nom","telephone","email"],
 excursions:["titre","date","prix","places"],
 reservations:["client","excursion","personnes","acompte","statut"],
 factures:["numero","client","objet","montant"],
 depenses:["libelle","categorie","montant","date"]
};
function configured(){return firebaseConfig.apiKey&&!firebaseConfig.apiKey.startsWith("VOTRE_")&&firebaseConfig.appId&&!firebaseConfig.appId.startsWith("VOTRE_");}
function parseMontant(v){return Number(String(v??"").replace(/[^\d-]/g,""))||0;}
function money(v){return (Number(v)||0).toLocaleString("fr-FR")+" Ar";}
function todayFR(){return new Date().toLocaleDateString("fr-FR");}
function init(){
 if(!configured()){$("loginMsg").textContent="Configuration Firebase incomplète : vérifiez firebase-config.js.";return;}
 firebase.initializeApp(firebaseConfig);auth=firebase.auth();db=firebase.database();
 auth.onAuthStateChanged(u=>{currentUser=u;$("login").classList.toggle("hidden",!!u);$("app").classList.toggle("hidden",!u);if(u){kinds.forEach(load);refreshStats();updateInvoicePreview();}});
}
$("loginBtn").onclick=async()=>{try{await auth.signInWithEmailAndPassword($("email").value.trim(),$("password").value);}catch(e){$("loginMsg").textContent="Connexion impossible : "+e.message;}};
$("logoutBtn").onclick=()=>auth.signOut();
document.querySelectorAll("nav button").forEach(b=>b.onclick=()=>{document.querySelectorAll("nav button").forEach(x=>x.classList.remove("active"));b.classList.add("active");document.querySelectorAll(".page").forEach(p=>p.classList.add("hidden"));$(b.dataset.page).classList.remove("hidden");});
document.querySelectorAll('form[data-kind]').forEach(f=>f.onsubmit=async e=>{
 e.preventDefault();if(!db){alert("Firebase n'est pas configuré.");return;}
 const obj={};new FormData(f).forEach((v,k)=>obj[k]=v);obj.createdAt=Date.now();
 try{await db.ref("rdn/"+f.dataset.kind).push(obj);f.reset();await load(f.dataset.kind);await refreshStats();alert("Enregistrement effectué avec succès !");}
 catch(err){alert("Erreur d'enregistrement : "+err.message);}
});
function safeText(tag,text,cls){const el=document.createElement(tag);el.textContent=text||"";if(cls)el.className=cls;return el;}
async function load(kind){
 if(!db)return;
 try{
  const snap=await db.ref("rdn/"+kind).once("value"),data=snap.val()||{},host=$("list-"+kind);host.innerHTML="";
  Object.entries(data).sort((a,b)=>(Number(b[1].createdAt)||0)-(Number(a[1].createdAt)||0)).forEach(([id,o])=>{
   if(kind==="factures"){renderInvoiceCard(host,id,o);return;}
   const div=document.createElement("div");div.className="item";
   const main=labels[kind].map(k=>o[k]?`${k}: ${o[k]}`:"").filter(Boolean).join(" • ");
   div.append(safeText("span",main,"item-main"),safeText("small",new Date(o.createdAt||Date.now()).toLocaleDateString("fr-FR")));
   host.append(div);
  });
 }catch(e){console.error("Erreur chargement "+kind,e);}
}
function renderInvoiceCard(host,id,o){
 const div=document.createElement("div");div.className="item";
 const left=document.createElement("div");left.className="item-main";
 const title=safeText("strong",`${o.numero||"Facture ancienne"} • ${o.client||"Client"}`);
 const detail=safeText("div",`${o.objet||"—"} • Total : ${money(o.montant)}`);
 const bal=parseMontant(o.montant)-parseMontant(o.acompte);
 const status=safeText("span",bal<=0?"Payée":parseMontant(o.acompte)>0?"Partiellement payée":"Non payée","status "+(bal>0?"pending":""));
 const meta=safeText("small",`${o.createdAt?new Date(o.createdAt).toLocaleDateString("fr-FR"):o.date||""} • Acompte : ${money(o.acompte||0)} • Solde : ${money(Math.max(0,bal))}`);
 left.append(title,detail,status,meta);
 const actions=document.createElement("div");actions.className="item-actions";
 const printBtn=safeText("button","Voir / PDF");printBtn.type="button";printBtn.onclick=()=>printInvoice(o);
 actions.append(printBtn);div.append(left,actions);host.append(div);
}
async function nextInvoiceNumber(){
 const year=new Date().getFullYear(),counterRef=db.ref(`rdn/counters/factures/${year}`);
 const old=await db.ref("rdn/factures").once("value");let max=0;
 old.forEach(child=>{const n=String((child.val()||{}).numero||"");const m=n.match(new RegExp(`^FA-${year}-(\\d+)$`));if(m)max=Math.max(max,Number(m[1]));});
 const tx=await counterRef.transaction(current=>current===null?max+1:Number(current)+1);
 if(!tx.committed)throw new Error("Impossible d'attribuer un numéro unique.");
 return `FA-${year}-${String(tx.snapshot.val()).padStart(3,"0")}`;
}
async function updateInvoicePreview(){
 if(!db)return;const year=new Date().getFullYear();
 try{const s=await db.ref(`rdn/counters/factures/${year}`).once("value");$("nextInvoiceNumber").textContent=`FA-${year}-${String((s.val()||0)+1).padStart(3,"0")} (indicatif)`;}catch(e){}
}
$("invoiceForm").onsubmit=async e=>{
 e.preventDefault();if(!db)return alert("Firebase n'est pas configuré.");
 const f=e.currentTarget,fd=new FormData(f),o={};fd.forEach((v,k)=>o[k]=String(v).trim());
 o.montant=parseMontant(o.montant);o.acompte=parseMontant(o.acompte);o.personnes=Math.max(1,parseInt(o.personnes,10)||1);
 if(o.acompte>o.montant)return alert("L'acompte ne peut pas dépasser le montant total.");
 if(o.montant<=0)return alert("Le montant total doit être supérieur à zéro.");
 o.solde=o.montant-o.acompte;o.date=todayFR();o.createdAt=Date.now();o.type="facture-acompte";
 try{
  o.numero=await nextInvoiceNumber();
  const ref=await db.ref("rdn/factures").push(o);o.id=ref.key;
  f.reset();f.elements.personnes.value=1;f.elements.acompte.value=0;
  await load("factures");await refreshStats();await updateInvoicePreview();
  printInvoice(o);
 }catch(err){alert("Erreur lors de la création : "+err.message);}
};
function escapeHtml(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function printInvoice(o){
 const total=parseMontant(o.montant),paid=parseMontant(o.acompte),balance=Math.max(0,total-paid);
 const included=String(o.inclus||"").split(/\r?\n/).filter(Boolean).map(x=>`<li>${escapeHtml(x)}</li>`).join("");
 const note=escapeHtml(o.note||"");
 const date=o.date||todayFR(),due=o.echeance||o.dateVoyage||"—";
 const html=`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(o.numero||"Facture RDN")}</title><style>
 *{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#161616;margin:0;padding:18px;font-size:14px}.top{background:#2495e8;color:#fff;padding:12px 14px;display:grid;grid-template-columns:110px 1fr;gap:12px;align-items:center}.logo{width:110px;height:110px;object-fit:contain;background:#fff}.brand h1{font-size:38px;margin:0;white-space:nowrap}.brand .mail{text-align:center;font-size:16px;margin:10px 0}.meta{display:flex;justify-content:space-between;gap:10px;font-weight:bold;margin-top:8px}.client{padding:14px 8px;line-height:1.9}.details{margin:10px 0 0;width:100%;border-collapse:collapse}.details td{padding:13px;border:2px solid white;background:#e3f1fb}.details .head{background:#b8dcf8}.details td:first-child{font-weight:bold;width:53%}.total{font-weight:bold;padding:15px}.block{padding:8px 15px;line-height:1.6}.block ul{margin:0 0 0 30px;padding-left:20px}.note{white-space:pre-wrap}.signature{display:flex;justify-content:space-between;align-items:center;margin:24px 10px 12px}.stamp{border:4px solid #65b4e9;border-radius:50%;width:165px;height:165px;color:#58aee8;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;font-weight:bold;transform:rotate(-9deg)}.stamp b{font-size:21px}.responsable{color:#58aee8;font-weight:bold;text-align:center;margin-top:-6px}.contacts{line-height:2}.thanks{font-style:italic;margin-top:24px;color:#333}.status{font-weight:bold;color:#24583a;margin-top:8px}@media print{body{padding:0}.top{-webkit-print-color-adjust:exact;print-color-adjust:exact}.details td{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body>
 <div class="top"><img class="logo" src="logo-rdn.png"><div class="brand"><h1>RDN EXPÉDITION</h1><div class="mail">rdnexpedition@gmail.com</div><div class="meta"><span>NIF : 5019233964</span><span>FACTURE N° : ${escapeHtml(o.numero||"")}</span></div><div class="meta"><span>STAT : 79120 11 2025 0 04198</span><span>${escapeHtml(date)}</span></div></div></div>
 <div class="client"><b>Client(e) :</b> ${escapeHtml(o.client)}<br><b>Téléphone :</b> ${escapeHtml(o.telephone||"—")}<br><b>Adresse :</b> ${escapeHtml(o.adresse||"—")}</div>
 <table class="details"><tr><td class="head" colspan="2"><b>Détails des services :</b> ${escapeHtml(o.objet)}${o.dateVoyage?" - "+escapeHtml(o.dateVoyage):""}</td></tr><tr><td>Effectif :</td><td>${o.personnes} personne(s)</td></tr><tr><td>Acompte payé :</td><td>${money(paid)}</td></tr><tr><td>Solde restant à payer :</td><td>${money(balance)}</td></tr></table>
 <div class="total">Montant total du voyage : ${money(total)}</div>
 <div class="block"><b>Mode de paiement :</b> ${escapeHtml(o.modePaiement||"—")}</div>
 <div class="block"><b>INCLUS :</b><ul>${included||"<li>Selon le programme convenu</li>"}</ul></div>
 <div class="block"><b>NB :</b><div class="note">${note||"—"}</div></div>
 <div class="block"><b>Date d'échéance :</b> ${escapeHtml(due)}</div>
 <div class="signature"><div class="contacts">🔵 RDN Expédition<br>🟢 034 70 249 97</div><div class="stamp">RDN EXPÉDITION<br><span>Voyage organisé</span><b>FACTURE<br>D'ACOMPTE</b></div></div>
 <div class="responsable">RANOHARIANTSOA Dina Nasandratra</div>
 <div class="thanks">Merci d'avoir choisi RDN Expédition.<br>Nous ferons de votre voyage une expérience inoubliable.</div>
 <script>window.onload=()=>setTimeout(()=>window.print(),400);</script></body></html>`;
 const w=window.open("","_blank");if(!w){alert("Autorisez les fenêtres pop-up pour afficher la facture.");return;}w.document.open();w.document.write(html);w.document.close();
}
async function refreshStats(){
 if(!db)return;
 try{
  const stats=[["clients","nClients"],["excursions","nExcursions"],["reservations","nReservations"]];
  for(const [kind,id] of stats){const s=await db.ref("rdn/"+kind).once("value");$(id).textContent=s.numChildren();}
  const [ds,fs]=await Promise.all([db.ref("rdn/depenses").once("value"),db.ref("rdn/factures").once("value")]);
  let expenses=0,invoiced=0,unpaid=0;
  ds.forEach(x=>expenses+=parseMontant((x.val()||{}).montant));
  fs.forEach(x=>{const f=x.val()||{},total=parseMontant(f.montant),paid=parseMontant(f.acompte);invoiced+=total;unpaid+=Math.max(0,total-paid);});
  $("sumDepenses").textContent=money(expenses);$("sumFactures").textContent=money(invoiced);$("sumImpayes").textContent=money(unpaid);
 }catch(e){console.error("Erreur actualisation tableau de bord :",e);}
}
init();
