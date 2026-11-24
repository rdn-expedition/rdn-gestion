RDN GESTION PRO — VERSION INTEGREE PHASES 1 A 6
================================================

CONTENU
- index.html
- style.css
- app.js
- firebase-config.js

AMELIORATIONS INTEGREES
1. Fiabilite et synchronisation
   - Surveillance de .info/connected et etat de synchronisation par module.
   - Transaction Firebase pour eviter de depasser la capacite d'une excursion lors de reservations concurrentes.
   - Detection des clients existants par telephone, puis par nom lorsque le telephone est absent.
   - Blocage des comptes authentifies non autorises dans l'interface.

2. Clients, reservations et factures
   - Creation automatique du client lors d'une reservation si aucun client correspondant n'existe.
   - Reutilisation de la fiche client existante.
   - Facturation uniquement depuis une reservation associee a un client.
   - Transaction sur le noeud factures pour bloquer deux factures portant le meme reservationId.
   - Historique client et liste des participants par excursion.

3. Paiements et suivi financier
   - Historique des paiements ajoute sous factures/{factureId}/paiements.
   - Enregistrement transactionnel des paiements et controle du solde restant.
   - Compatibilite avec les anciennes factures : si paiements n'existe pas, le champ acompte historique reste utilise.
   - Calcul des encaissements, soldes et depenses dans le tableau de bord.

4. Tableau de bord
   - KPI commerciaux et financiers.
   - Evolution des recettes encaissees et depenses sur les six derniers mois.
   - Rapport financier imprimable.

5. Administration et securite
   - Roles ADMIN/AGENT conserves.
   - Depenses, indicateurs financiers, sauvegarde et restauration reserves a ADMIN dans l'interface.
   - Journal des actions avec suppression reservee a ADMIN.
   - Sauvegarde JSON complete et restauration par fusion : les enregistrements absents du fichier ne sont pas supprimes.

6. Outils et finition
   - Recherche/filtrage dans les listes.
   - Export CSV compatible Excel.
   - Impression PDF via la fonction Imprimer du navigateur pour factures, participants et rapport financier.
   - Interface responsive et styles additionnels.

IMPORTANT — FIREBASE
- Le fichier firebase-config.js conserve la configuration Firebase du projet existant.
- Les Firebase Security Rules fournies par l'utilisateur ne sont pas remplacees par ce paquet.
- Les paiements sont stockes dans le noeud existant rdn/factures, sous la propriete paiements de chaque facture. Aucun nouveau noeud racine n'est requis.
- Aucune migration, suppression ou reorganisation automatique des anciennes donnees n'est effectuee.
- Les controles de capacite et d'unicite de facture sont implementes dans les transactions du client. Pour une garantie contre tout client modifie ou appel direct a l'API, il faudra ensuite renforcer les Security Rules ou ajouter une fonction serveur de validation. Les regles actuelles ne valident pas encore la structure de chaque facture.
- Les droits existants sont conserves : selon les Rules actuelles, l'AGENT peut lire/ecrire les factures et ajouter des logs, mais ne peut pas lire les depenses ni effacer le journal.

INSTALLATION CONSEILLEE
1. Faire une sauvegarde depuis Firebase Console (Export JSON) et telecharger une sauvegarde depuis l'application avec un compte ADMIN.
2. Conserver une copie du dossier actuellement en production.
3. Remplacer les quatre fichiers par ceux de cette archive.
4. Ne pas modifier les Rules Firebase pendant le premier test.
5. Tester d'abord avec un compte ADMIN, puis avec le compte AGENT.

TESTS MANUELS AVANT MISE EN PRODUCTION
- Creer une reservation avec un client deja existant : verifier qu'aucun deuxieme client n'est cree.
- Creer une reservation avec un nouveau client : verifier la creation automatique du client.
- Tenter une reservation au-dela des places disponibles : elle doit etre refusee.
- Creer une facture depuis une reservation, puis tenter une deuxieme facture : elle doit etre refusee.
- Enregistrer un paiement partiel puis le solde : le statut et le solde doivent etre recalcules.
- Verifier que les anciennes factures sans paiements affichent toujours leur acompte historique.
- Verifier les exports CSV, l'impression PDF et la sauvegarde/restauration par fusion.
- Verifier que l'AGENT ne voit pas les depenses, les indicateurs financiers, la sauvegarde ni le bouton de suppression du journal.

VALIDATION
Le JavaScript a passe la verification syntaxique Node.js et le HTML a ete controle pour les identifiants dupliques. Aucun test de connexion en direct sur le projet Firebase n'a ete execute depuis cet environnement. Faire les tests manuels ci-dessus avant remplacement definitif.
