# ♟ LabChess

> Play chess with your friend on another lab PC — no login, no account, just a 6-letter room code.

---

## How It Works

1. **Player 1** opens the app → clicks **Create Game** → picks a color → gets a 6-letter code like `XK92TF`
2. **Player 2** opens the same URL on another PC → types the code → clicks **Join Game**
3. Moves sync instantly via Firebase. No login required.

---

## Project Structure

```
labchess/
├── index.html          # Entry point, loads all scripts & styles
├── config.js           # Your Firebase credentials (fill this in)
├── css/
│   ├── board.css       # Board colors, highlights, animations
│   ├── ui.css          # Lobby, buttons, player bars, toast
│   └── responsive.css  # Breakpoints for all screen sizes
├── js/
│   ├── firebase.js     # Firebase DB read/write/listen
│   ├── game.js         # Chess logic, move validation, game state
│   ├── board.js        # Board rendering, drag & drop, overlays
│   └── ui.js           # Screen flow, button handlers, status updates
└── README.md
```

---

## Setup Guide

### Step 1 — Firebase

1. Go to [firebase.google.com](https://firebase.google.com) → **Get Started**
2. Create a project named `labchess` (skip Google Analytics)
3. In the left sidebar → **Build** → **Realtime Database** → **Create Database**
4. Choose any region → select **Start in test mode** → **Enable**
5. Go to **Project Settings** (gear icon) → scroll to **Your apps** → click `</>` (Web)
6. Register the app as `labchess` → copy the `firebaseConfig` values

### Step 2 — Fill in config.js

Open `config.js` and replace the placeholder values:

```js
const config = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL:       "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_APP_ID"
};
```

### Step 3 — Push to GitHub

```bash
git init
git add .
git commit -m "init labchess"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/labchess.git
git push -u origin main
```

> ⚠️ If you added `config.js` to `.gitignore`, push it separately or use Vercel environment variables (see below).

### Step 4 — Deploy on Vercel

1. Go to [vercel.com](https://vercel.com) → **Sign up with GitHub**
2. Click **Add New Project** → import your `labchess` repo
3. Leave all settings as default → click **Deploy**
4. Vercel gives you a live URL like `https://labchess.vercel.app`

Every `git push` to `main` auto-redeploys in ~30 seconds.

---

## Firebase Database Rules

In the Firebase console → **Realtime Database** → **Rules**, use:

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

> This is fine for a lab game. If you want basic protection later, you can restrict by room path.

---

## Customization

| What | Where | How |
|---|---|---|
| Board colors | `css/board.css` | Change `--light-square` and `--dark-square` |
| Board size | `css/board.css` | Change `--board-size` |
| App theme colors | `css/ui.css` | Change `#c9a84c` (gold) and `#0d0d1a` (dark bg) |
| Room code length | `js/firebase.js` | Change the loop count in `generateRoomCode()` |
| Piece theme | `js/board.js` | Change `pieceTheme` URL in `initBoard()` |

---

## Tech Stack

| Library | Version | Purpose |
|---|---|---|
| [chess.js](https://github.com/jhlywa/chess.js) | 0.10.3 | Move validation, game state |
| [chessboard.js](https://chessboardjs.com) | 1.0.0 | Board rendering, drag & drop |
| [Firebase](https://firebase.google.com) | 10.x | Realtime Database sync |
| [jQuery](https://jquery.com) | 3.7.1 | Required by chessboard.js |

No bundler. No build step. Pure HTML + JS modules.

---

## Known Limitations

- No spectator mode (only 2 players per room)
- Room codes expire when Firebase test mode expires (30 days) — just reset the rules
- No time controls / chess clock (yet)
- No game history storage between sessions

---

Built for lab PCs. No login. Just chess. ♟