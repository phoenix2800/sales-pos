# Fix: Stockage permanent (Neon + Cloudinary) — Notes de déploiement

## Ce qui a été réparé dans le code
1. `src/config/db.js` — recherche insensible à la casse sur Postgres (ILIKE) + types
   retournés identiques à SQLite (nombres, dates `YYYY-MM-DD`) pour le frontend existant.
2. `src/routes/invoices.js` — `GROUP BY` compatible Postgres (la liste des factures
   plantait sans cela) + les PDF manquants sont **régénérés** automatiquement au téléchargement.
3. `src/routes/products.js` — `category != ""` → `''` (guillemets doubles = erreur sur Postgres).
4. `src/routes/printer.js` — double `LIMIT 1` supprimé (plantait sur les 2 bases).
5. `src/routes/treasury.js` + `src/routes/analytics.js` — bug `await` corrigé :
   le résumé mensuel et le P&L retournaient `null` au lieu des montants.
6. `render.yaml` — ajout des variables `DATABASE_URL` et `CLOUDINARY_URL`.

## À faire sur Render (5 min)
1. **Neon** (neon.tech) → projet gratuit → copier la *Connection string*.
2. **Cloudinary** (cloudinary.com) → Dashboard → copier **API Environment variable**,
   qui ressemble à : `cloudinary://API_KEY:API_SECRET@CLOUD_NAME`
3. Render → votre service → **Environment** → ajouter :
   - `DATABASE_URL` = connection string Neon
   - `CLOUDINARY_URL` = la variable Cloudinary complète ci-dessus
4. **Manual Deploy** → au redémarrage, l'avertissement « Stockage temporaire » disparaît
   (la page État système lit le vrai mode depuis l'API).

## Données existantes
Le passage à Neon = base **neuve** (l'ancienne SQLite de Render ne migre pas toute seule).
Pour garder clients/produits : **avant** le basculement, téléchargez
`/api/backup/export-json`, puis **après** utilisez `/api/backup/import-json`.
