# RDN GESTION V1

Application web de gestion de RDN Expédition : clients, excursions, réservations, factures et dépenses.

## Configuration Firebase obligatoire
1. Dans Firebase Console, ouvrez le projet `rdn-gestion`.
2. Paramètres du projet > Général > Vos applications > application Web.
3. Copiez la configuration SDK dans `firebase-config.js` (apiKey, authDomain, projectId, databaseURL, messagingSenderId, appId).
4. Activez Authentication > Sign-in method > Email/Password.
5. Configurez les règles Realtime Database pour exiger un utilisateur authentifié. Ne publiez jamais de données privées en lecture/écriture publique.

## Publication GitHub Pages
Déposez les fichiers du dossier à la racine du dépôt `rdn-gestion`, puis Settings > Pages > Deploy from a branch > `main` (ou `principal`) > `/ (root)` > Save.

## Important
Cette V1 est un socle de démarrage. Les modules de base enregistrent et affichent les données Firebase. Les factures PDF, édition/suppression avancées, rapports et permissions par rôle restent à développer.
