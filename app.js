
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


// Lancement
init();
