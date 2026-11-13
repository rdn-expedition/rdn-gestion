RDN GESTION V2 — Factures au format RDN Expédition
Contenu
index.html : interface de gestion et formulaire de facture détaillé.
style.css : styles de l'application.
app.js : Firebase, numérotation des factures, historique, calcul acompte/solde et impression PDF.
firebase-config.js : configuration Firebase existante.
logo-rdn.png : logo extrait de l'exemple de facture fourni.
Mise à jour GitHub Pages
Téléchargez et décompressez ce ZIP.
Dans le dépôt GitHub rdn-gestion, remplacez les anciens index.html, style.css et app.js par ceux de ce dossier.
Remplacez firebase-config.js uniquement par celui fourni ici si c'est bien le même projet Firebase.
Ajoutez logo-rdn.png à la racine du dépôt.
Faites Commit changes et attendez le déploiement GitHub Pages.
Sur le téléphone, rechargez le site. Si l'ancienne version reste affichée, videz le cache du site ou rechargez en navigation privée.
Fonctionnement Factures V2
Le numéro est généré automatiquement sous la forme FA-AAAA-001.
Un compteur Firebase transactionnel est utilisé dans rdn/counters/factures/AAAA pour éviter les doublons entre créations simultanées.
Les anciennes factures enregistrées restent dans rdn/factures; elles s'affichent dans l'historique.
Les nouvelles factures enregistrent client, téléphone, adresse, excursion, date du voyage, effectif, total, acompte, solde, mode de paiement, inclus et note.
Après enregistrement, la facture s'ouvre dans une fenêtre d'impression. Choisissez « Enregistrer au format PDF » dans la boîte d'impression Android/Chrome.
Le tableau de bord affiche aussi le total facturé et le reste à encaisser.
Important
Le compteur utilise rdn/counters/factures/AAAA. Les règles Firebase doivent autoriser la lecture/écriture authentifiée sur rdn/counters pour le compte administrateur.
Le logo inclus est un recadrage de l'image d'exemple envoyée. Fournissez le fichier logo original haute résolution pour un rendu plus net.
Les mentions NIF, STAT, email, téléphone, nom du responsable et conditions de remboursement sont reprises de l'exemple fourni. Vérifiez-les avant émission officielle.
Faites une sauvegarde des fichiers et des données avant toute mise à jour. Ne supprimez pas les anciennes données Firebase.
