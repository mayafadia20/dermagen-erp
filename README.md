# DermaGen ERP

Plateforme de gestion interne de **DermaGen** (Montréal) : inventaire des ingrédients cosmétiques, formulations R&D hebdomadaires, fournisseurs, bons de commande, factures et paiements.

**Application en ligne :** https://mayafadia20.github.io/dermagen-erp/

## Modules

| Module | Ce qu'il fait |
|---|---|
| Tableau de bord | Valeur de l'inventaire, alertes de stock et de péremption, formulations de la semaine, commandes attendues, factures à payer et en retard. |
| Inventaire des ingrédients | Fiche par ingrédient (INCI, CAS, catégorie, fournisseur, lot, péremption, emplacement, coût), stock minimum, mouvements d'entrée/sortie/ajustement avec historique, export CSV. |
| Formulations R&D | Journal regroupé par semaine ISO. Composition par phases en %, calcul automatique des quantités et du coût du lot, mode opératoire, pH / viscosité / stabilité, résultats des tests, versions liées, fabrication d'un lot avec déduction automatique de l'inventaire. |
| Fournisseurs | Carnet de contacts, conditions de paiement, délais, ingrédients fournis, historique des commandes et factures, solde dû. |
| Bons de commande | Lignes d'achat, TPS/TVQ, réception qui alimente l'inventaire (lot, péremption, mise à jour du coût), création de la facture en un clic. |
| Factures | Comptes à payer, échéance calculée selon les conditions du fournisseur, statut automatique (à payer, partielle, en retard, payée). |
| Paiements | Règlements par facture (virement, carte, Interac…), historique et export CSV. |
| Demandes d'accélérateurs | Suivi des candidatures (accélérateurs, incubateurs, subventions, concours) : dates limites avec compte à rebours, statut, priorité, valeur, contact, liste de documents à cocher, journal de suivi. |
| Mots de passe & accès | Coffre chiffré des comptes de l'entreprise (lien, identifiant, mot de passe, informations sensibles) protégé par un mot de passe maître : AES-256-GCM, clé dérivée par PBKDF2, verrouillage automatique après 15 minutes. |
| Paramètres | Taxes, listes personnalisables, sauvegarde/restauration JSON, données de démonstration. |

## Fonctionnement technique

- Application web statique : HTML, CSS et JavaScript (modules ES), **aucun serveur ni build**.
- Les données sont stockées dans le navigateur (IndexedDB). Elles ne quittent jamais l'ordinateur.
- Pour changer d'ordinateur ou faire une copie de sécurité : *Paramètres → Exporter la sauvegarde (JSON)*, puis *Importer* sur l'autre poste.
- Hébergée gratuitement sur GitHub Pages depuis la branche `main`.

## Lancer en local

Ouvrir le dossier avec un petit serveur web (les modules ES exigent `http://`) :

```bash
python -m http.server 8080
# puis ouvrir http://localhost:8080
```

## Évolutions possibles

- Synchronisation multi-utilisateurs (base de données en ligne, ex. Supabase) en remplaçant `js/store.js`.
- Authentification et rôles (laboratoire / administration).
- Génération PDF des bons de commande.
