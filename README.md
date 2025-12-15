# LEO Protocol

## Aperçu
LEO est un protocole applicatif sécurisé au-dessus de TCP pour transférer, synchroniser et lister des fichiers. Le projet fournit un serveur TCP, un client CLI et des utilitaires de synchronisation implémentés en TypeScript (ESM NodeNext) avec chiffrement X25519 + AES-256-GCM.

## Fonctionnalités
- Handshake sécurisé avec échange X25519, dérivation HKDF-SHA256 et clés de session séparées client/serveur.
- Chiffrement AES-256-GCM pour toutes les commandes applicatives après handshake.
- Commandes AUTH, PUT, GET, LIST et BYE.
- Stockage disque avec validation de chemin pour éviter les échappements.
- Client CLI pour upload, download et listing; utilitaire de synchronisation récursive.
- Client graphique Electron pour naviguer et transférer les fichiers.
- Tests unitaires et d'intégration avec Vitest.

## Prérequis
- Node.js 20+
- npm

## Installation
```bash
npm install
```

## Compilation TypeScript
```bash
npm run build
```

## Lancer le serveur
Variables supportées :
- `LEO_HOST` (défaut `127.0.0.1`)
- `LEO_PORT` (défaut `9000`)
- `LEO_STORAGE` chemin racine de stockage (défaut `./data` depuis le cwd)
- `LEO_USER` nom d'utilisateur pour AUTH (défaut `user`)
- `LEO_PASS` mot de passe pour AUTH (défaut `pass`)
- `LEO_TIMEOUT_MS` (optionnel) délai d'attente des réponses côté client (défaut 15000 ms)

Commande :
```bash
npm run server
```

## Utilisation du client CLI
Les mêmes variables d'environnement `LEO_HOST`, `LEO_PORT`, `LEO_USER`, `LEO_PASS` s'appliquent côté client.

Uploads :
```bash
node --loader ts-node/esm src/client/client.ts put ./local/file.txt remote/file.txt
```

Downloads :
```bash
node --loader ts-node/esm src/client/client.ts get remote/file.txt ./local/file.txt
```

Suppression :
```bash
node --loader ts-node/esm src/client/client.ts del remote/file.txt
```

Informations serveur :
```bash
node --loader ts-node/esm src/client/client.ts info
```

Listing :
```bash
node --loader ts-node/esm src/client/client.ts list .
```

Fermeture de session : la commande BYE est envoyée automatiquement en fin d'exécution du client.

## Synchronisation de dossier
L'utilitaire `syncDirectory` parcourt récursivement un dossier local et uploade chaque fichier. Exemple d'exécution :
```bash
node --loader ts-node/esm -e "import { LeoClient } from './src/client/client.ts'; import { syncDirectory } from './src/client/sync.ts'; (async () => { const client = new LeoClient(); await client.connect(process.env.LEO_HOST ?? '127.0.0.1', Number(process.env.LEO_PORT ?? '9000')); await client.auth(process.env.LEO_USER ?? 'user', process.env.LEO_PASS ?? 'pass'); await syncDirectory(client, './local-folder', 'remote-prefix'); await client.bye(); })();"
```

## Résumé du protocole
1. Handshake en clair via JSON `CLIENT_HELLO` puis `SERVER_HELLO`.
2. Calcul du secret partagé X25519 puis dérivation HKDF-SHA256(info `LEO-SESSION-<sessionId>`) pour obtenir deux clés de 32 octets.
3. Toutes les commandes applicatives sont sérialisées JSON puis chiffrées en AES-256-GCM et envoyées via un framing binaire `[length][nonce|ciphertext|tag]`.

### Commandes applicatives
- AUTH `{ type: "AUTH", username, password }`
- PUT séquencé avec `PUT_BEGIN`, `PUT_CHUNK`, `PUT_END` puis `PUT_OK`.
- GET séquencé avec `GET_BEGIN`, `GET_META`, `GET_CHUNK...`, `GET_END`.
- LIST `{ type: "LIST", path }` réponse `LIST_RESULT`.
- DEL `{ type: "DEL", path }` réponse `DEL_OK` ou `DEL_ERROR`.
- INFO `{ type: "INFO" }` réponse `INFO_RESULT` avec version et capacités.
- BYE `{ type: "BYE" }`.

## Logs serveur
Les logs sont émis au format JSON sur la sortie standard/erreur. Chaque entrée contient un `ts`, un `level`, un `context` et des métadonnées (session, commande, erreur). Ils permettent de tracer les connexions, AUTH, PUT/GET/LIST/DEL/INFO et les erreurs internes.

## Tests
```bash
npm test
```
Les tests couvrent la crypto X25519/HKDF, AES-GCM, le framing JSON, ainsi que des intégrations handshake, AUTH, PUT/GET et LIST sur un serveur démarré en mémoire.

## Client graphique Electron
Le client GUI fournit une interface proche d'un client SFTP pour piloter le protocole LEO.

### Démarrage
```bash
npm run desktop
```

### Flux d'utilisation
- Renseigner l'hôte, le port et les identifiants puis cliquer sur Se connecter.
- Utiliser Listing pour parcourir les répertoires distants.
- Utiliser Upload pour choisir un fichier local et saisir le chemin distant.
- Utiliser Download pour définir le chemin distant et sélectionner une destination locale.
- Cliquer sur Déconnexion pour envoyer BYE et fermer la session chiffrée.

## Structure du projet
- `src/crypto.ts` génération de clés X25519 et dérivation HKDF
- `src/cipher.ts` chiffrement/déchiffrement AES-256-GCM
- `src/protocol.ts` types et framing du protocole
- `src/server/` serveur TCP, gestion de session et stockage
- `src/client/` client CLI et synchronisation
- `src/tests/` tests unitaires et intégration Vitest
