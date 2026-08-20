# Brew New Tracker Web App

Una web app full-stack che replica l'output dello script [`brew-new-tracker-v2.sh`](https://github.com/cicciocanestro/brew-new-tracker), mostrando le formule, i cask e i font aggiunti di recente a Homebrew.

## Requisiti

- Node.js 18+ (per `fetch` nativo)
- npm

## Avvio

```bash
npm install
npm start
```

Il server avvia su `http://localhost:3000`.

## API

### `GET /api/brew-tracker`

Parametri di query:

| Parametro     | Default  | Descrizione                                         |
|---------------|----------|-----------------------------------------------------|
| `n`           | `25`     | Numero di risultati per categoria (1-100)           |
| `only`        | `both`   | `both`, `formula`, `cask`, `font`                   |
| `json`        | `true`   | `true` per JSON, `false` per testo con box drawing  |
| `noHomepage`  | `false`  | `true` salta il recupero delle homepage             |
| `combined`    | `false`  | `true` unisce formule+cask+font in una tabella       |
| `threads`     | `8`      | Worker paralleli per le homepage (1-64)             |
| `token`       | —        | Token GitHub opzionale (aumenta i rate limit). Alternativa consigliata: header `X-GitHub-Token` |

### Esempi

```
# JSON: ultime 5 formule
GET /api/brew-tracker?n=5&only=formula&json=true&noHomepage=true

# Testo: vista combinata
GET /api/brew-tracker?n=10&combined=true&json=false
```

### `GET /api/status`

Restituisce `{ "githubTokenSet": boolean }` — indica se il server ha un token GitHub configurato (`GITHUB_TOKEN`/`GH_TOKEN`). La landing page lo usa per mostrare il badge di stato del token.

## Token GitHub (opzionale)

Puoi impostare il token tramite:

1. **Variabile d'ambiente**: `export GITHUB_TOKEN=ghp_xxx`
2. **Interfaccia web**: incolla il token nel campo dedicato nel form (il frontend lo invia nell'header `X-GitHub-Token`, mai nella query string)
3. **Header HTTP** (per chiamate API dirette): `X-GitHub-Token: ghp_xxx`

Con un token: 30 richieste/min. Senza: 10 richieste/min.

> Il parametro di query `token` è ancora supportato per retrocompatibilità, ma è sconsigliato: i token nella query string finiscono nei log dei server/proxy.

## Stack tecnologico

- **Backend**: Node.js + Express
- **Frontend**: HTML, CSS, JavaScript (vanilla)

## Differenze dallo script originale

- Le date usano il fuso orario del server invece di Europe/Rome
- L'output JSON include campi aggiuntivi: `combined`, `warnings`
- L'output testuale è generato server-side (nessun terminale richiesto)

## Cache e rate limit

- Le risposte della ricerca GitHub sono memorizzate in cache per **5 minuti**
- I dati di `formulae.brew.sh` (versione, homepage, descrizione) per **24 ore** (max 2000 voci, con scadenza automatica)
- Il timeout delle chiamate esterne è di **15 secondi** (`AbortSignal.timeout`)
