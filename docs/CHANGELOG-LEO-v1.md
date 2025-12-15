# CHANGELOG LEO V1

- Ajout de la spécification complète du protocole (LEO-001-v1) : handshake, framing, commandes et codes d'erreur normalisés.
- Nouvelles commandes applicatives : `DEL`/`DEL_OK`/`DEL_ERROR` pour supprimer des fichiers et `INFO`/`INFO_RESULT` pour exposer version et capacités du serveur.
- Erreurs enrichies et normalisées (`errorCode`, `message`, `details`) pour toutes les réponses d'erreur, y compris AUTH.
- Robustesse accrue côté client (timeouts, détection fermeture socket) et côté serveur (validation stricte, réponses typées).
- Logs serveur structurés (JSON) pour les connexions, commandes et erreurs.
