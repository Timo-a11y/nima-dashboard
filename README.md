# Google Drive Desktop (macOS MVP)

Deze repository bevat nu een **Electron + Next.js desktop-app** die zich gedraagt als een basisversie van Google Drive Desktop:

- Inloggen met Google OAuth
- Lokale sync-map kiezen
- Lijst lokale bestanden en Drive-bestanden
- Handmatige upload/download per bestand
- Bidirectionele "Sync now" actie

## 1) Voorbereiding Google OAuth

Maak in Google Cloud Console een OAuth client aan (type: **Web application** werkt het makkelijkst voor deze MVP):

1. Zet **Google Drive API** aan.
2. Maak OAuth credentials aan (Client ID + Client Secret).
3. Voeg deze redirect URI toe:

```txt
http://127.0.0.1:53682/oauth2callback
```

De app vraagt in de UI om Client ID en Client Secret.

## 2) Installeren

```bash
npm install
```

## 3) Desktop development starten

```bash
npm run dev:desktop
```

Dit start:

- Next.js renderer op `http://localhost:3000`
- Electron desktop window

## 4) Werken met de app

1. Vul OAuth Client ID en Client Secret in en klik **OAuth opslaan**
2. Klik **Verbinden met Google**
3. Kies een lokale sync-map
4. Klik **Nu synchroniseren** of gebruik upload/download per bestand

De app maakt in je Drive een dedicated map:

```txt
Cursor Google Drive Desktop Sync
```

## 5) macOS build

```bash
npm run dist:mac
```

De artifacts komen in `release/`.

## Bekende MVP-beperkingen

- Sync is handmatig (geen achtergrond daemon of realtime file watcher)
- Gericht op reguliere bestanden (geen Google Docs native documenttypes)
- Nog geen conflict-resolutie UI behalve timestamp-vergelijking
