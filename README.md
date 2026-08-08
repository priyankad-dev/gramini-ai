# ग्रामिणी AI · Gramini AI

**A voice-first AI assistant for rural India.** The user speaks — they never
type. It answers in their own language about government schemes, weather, health
and rights, and **every scheme answer carries the government website it came
from**.

**Team Viykon** · ACM SIGCHI IIIT Pune × IIT Bombay
**PS07** (Human-Centered AI for Rural Communities) + **PS03** (Government Schemes)

📄 Full technical documentation: **[ARCHITECTURE.md](ARCHITECTURE.md)**
🎬 Demo video script: **[DEMO_VIDEO_SCRIPT.md](DEMO_VIDEO_SCRIPT.md)**

---

## 1. The problem

India runs hundreds of welfare schemes. The money is allocated. The gap is not
information — it is **reachability**:

- Information lives on **websites**, in **English or formal Hindi**, behind
  **forms**.
- The people entitled to it are often **semi-literate**, speak a **regional
  language**, and use a phone mainly for **WhatsApp voice notes**.
- When stuck, they **ask a person**, not an app.

This is an **interface** problem. Gramini AI is an interface answer.

---

## 2. Key features

| Feature | What it does |
|---|---|
| 🎤 **Hands-free voice** | Tap once; the mic reopens by itself after every answer |
| 🏛️ **9 verified schemes** | Answers come from a hand-checked local database, never from the model |
| 🗣️ **24 languages** | Switch by **saying** it — or just speak yours and it detects you |
| 🌦️ **Live weather** | Real forecasts from Open-Meteo, cached for offline |
| 📷 **Camera** | Crop leaf, medicine strip, government document |
| 📴 **Offline mode** | Schemes, language switching and cached weather work with no network |
| 🔊 **Offline voice** | Pre-recorded audio speaks when the browser cannot |
| ♿ **Accessibility** | Large text, high contrast, dark mode, ≥48px targets, WCAG AA |
| 🛡️ **Refuses to guess** | If a scheme is not in the verified data, it says so |

---

## 3. Architecture

### Development

```
React (Vite :5173)
      │  relative /api → Vite dev proxy
      ▼
FastAPI (:8000)
      │
      ├─→ Gemini API      (intent, chat, vision, translation)
      ├─→ Open-Meteo      (live weather, no key needed)
      └─→ Local JSON      (government schemes — SOURCE OF TRUTH)
```

### Production

```
        Judge
          │  HTTPS
          ▼
   React on Vercel
          │  HTTPS · VITE_API_BASE_URL
          ▼
  FastAPI on Render
          │
   ┌──────┼───────────┐
   ▼      ▼           ▼
Gemini  Open-Meteo  Local JSON
   │
   ▼
GEMINI_API_KEY  ← backend environment ONLY
```

### The rule that shapes everything

> **Gemini never decides what a government scheme says.**

Gemini does four things: classify intent, detect language, hold free
conversation, and read a photo. Every scheme fact is assembled
**deterministically** from `backend/data/schemes.json` with the official link
attached. If nothing matches, the app **refuses** rather than guessing.

Wrong information about money causes real harm — so the model is not allowed to
produce it. This is enforced by architecture, not by prompt wording, and is
covered by **37 automated tests** (25 must-match, 12 must-refuse).

---

## 4. Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, Tailwind CSS |
| Backend | Python 3.12, FastAPI, Uvicorn |
| AI | Google Gemini (`google-genai` SDK) |
| Weather | Open-Meteo (free, no API key) |
| Speech | Web Speech API + pre-recorded WAV fallback |
| Data | Verified JSON, checked against government portals |

> **No animation library.** Runtime dependencies are `react` and `react-dom`
> only. All motion is CSS keyframes — it runs on the compositor thread (smooth on
> low-end phones) and `prefers-reduced-motion` disables it with zero information
> loss, because every state is also carried by text and colour.

---

## 5. Local setup

### Prerequisites

- Python **3.12**
- Node **18+**
- **Google Chrome** — voice needs the Web Speech API, which Firefox lacks

### Backend

```bash
cd backend

python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # macOS / Linux

pip install -r requirements.txt

copy .env.example .env          # Windows   (cp on macOS/Linux)
# open .env and paste your Gemini key

uvicorn main:app --reload --port 8000
```

Check it: <http://127.0.0.1:8000/api/health>

> On Windows, set `PYTHONIOENCODING=utf-8` before starting Uvicorn if you want
> the Hindi and Marathi log lines to be readable. The API is unaffected.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open **<http://localhost:5173>** in **Chrome**.

---

## 6. Environment variables

### Backend (`backend/.env` — **never committed**)

| Variable | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | **Yes** | Primary key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| `GEMINI_API_KEY_BACKUP` | No | Used automatically when the first hits quota |
| `GEMINI_MODEL` | No | Default `gemini-3.5-flash` |
| `GEMINI_TRANSLATE_MODEL` | No | Default `gemini-3.5-flash-lite` — kept separate so bulk translation cannot eat the demo's quota |
| `GEMINI_MAX_ATTEMPTS` | No | Retries per key, default 3 |
| `FRONTEND_URL` | Production | Deployed frontend origin, for CORS |
| `FRONTEND_URL_REGEX` | No | Allows Vercel preview subdomains |
| `GRAMINI_LOG_LEVEL` | No | `DEBUG` for full tracebacks |

### Frontend (`frontend/.env.local`)

| Variable | Purpose |
|---|---|
| `VITE_API_BASE_URL` | Backend origin. **Leave empty in development** — the Vite proxy handles it. |

> ⚠️ **Anything prefixed `VITE_` is compiled into the JavaScript bundle and is
> publicly readable.** Never put an API key there. The Gemini key exists only in
> the backend environment.

---

## 7. Production deployment

The frontend is static and the backend is a long-running Python process, so they
deploy separately. **Deploy the backend first** — the frontend needs its URL.

### Step 1 — Backend on Render

1. Push this repository to GitHub.
2. Render → **New** → **Blueprint** → select the repo. It reads `render.yaml`.
3. When prompted, set the secrets:
   - `GEMINI_API_KEY`
   - `GEMINI_API_KEY_BACKUP` (optional)
   - Leave `FRONTEND_URL` blank for now.
4. Deploy, then confirm: `https://<your-backend>.onrender.com/api/health`

### Step 2 — Frontend on Vercel

1. Vercel → **New Project** → same repo.
2. **Root directory:** `frontend`
3. Environment variable:
   `VITE_API_BASE_URL = https://<your-backend>.onrender.com` *(no trailing slash)*
4. Deploy.

### Step 3 — Close the CORS loop

Back in Render, set `FRONTEND_URL` to your Vercel URL and **redeploy**. Until
this is done the browser will block requests with a CORS error.

### ⚠️ Render free tier sleeps

A free instance sleeps after ~15 minutes idle, and the next request takes
**30–60 seconds** to wake it. Before judging, open the health URL once to warm
it. Consider a free uptime pinger for the judging window.

---

## 8. Security

- ✅ The Gemini key is read **only** by the backend, via `os.getenv`.
- ✅ It never appears in React source, the bundle, HTML, or any `VITE_` variable
  — **verified by scanning the built bundle**.
- ✅ `.env` is gitignored; `.env.example` holds placeholders only.
- ✅ `/api/health` masks key fingerprints locally and **omits them entirely** in
  production.
- ✅ CORS is an explicit allow-list, not `*`.

**If a key is ever exposed, revoke it immediately** at
[aistudio.google.com/apikey](https://aistudio.google.com/apikey) and issue a new
one. A key in Git history stays there even after a later commit removes it.

---

## 9. Offline & cache behaviour

| Component | Cache | Behaviour without network |
|---|---|---|
| Schemes | `localStorage` scheme pack | ✅ Full answers, same matcher, citations intact |
| Weather | `data/weather_cache.json`, 30 min TTL | ✅ Serves cached, labelled stale |
| Translation | `data/translations/*.json` | ✅ Cached languages work; else verified Hindi |
| Voice out | `audio_cache/*.wav` (39 clips) | ✅ Local voice → recording → text + notice |
| Voice **in** | — | ❌ Server-side; the app offers typing instead |
| Free chat, camera | — | ❌ Declined honestly |

Nothing fails silently. Every degradation names itself in the user's language.

### Warming the caches (before a demo, while online)

```bash
cd backend
.venv\Scripts\python.exe prewarm.py            # translations: ta, bn, te, gu
.venv\Scripts\python.exe prewarm_audio.py hi mr --schemes   # offline voice
```

Re-running is cheap — it only fetches what is missing.

---

## 10. Demo instructions

Say these in order:

| # | Say | Expect |
|---|---|---|
| 1 | *(tap the microphone once)* | Spoken greeting, then it listens by itself |
| 2 | `मुझे किसान की योजना बताओ` | 4 farming schemes, cards with website + call buttons |
| 3 | `ऐप को इंग्लिश में कर दो` | **Whole UI becomes English** |
| 4 | `मला मराठीत बोल` | Whole UI becomes Marathi |
| 5 | `बीड में आज बारिश होगी क्या` | Live weather card for Beed |
| 6 | `मुझे लैपटॉप के लिए सरकारी पैसा चाहिए` | **Refuses** — "I will not guess" |
| 7 | *(airplane mode ON)* `किसान की योजना बताओ` | Same answer, from cache, 📴 badge |

**Before demoing**, confirm a Hindi voice exists — in the Chrome console:

```js
speechSynthesis.getVoices().filter(v => v.lang.startsWith('hi'))
```

An empty array means Hindi will not speak live; the recorded audio fallback
covers the cached sentences.

---

## 11. Data verification status

`backend/data/schemes.json` is marked **`"data_status": "partial"`** — and that
is deliberate.

5 of 9 schemes were read directly off government portals; the rest rest on
government press releases. **[VERIFICATION.md](backend/data/VERIFICATION.md)**
records every fact by evidence level (`PORTAL` / `PIB` / `UNCHECKED`) and lists
what remains.

Corrections this process found include a **dead government URL** (MGNREGA), a
**missing Ayushman 70+ eligibility rule**, and a helpline that belonged to a
**different scheme**. None of that was visible from reading the JSON.

Claiming "verified" over unchecked money advice is the one mistake this project
must not make.

---

## 12. Testing

```bash
cd backend
.venv\Scripts\python.exe test_schemes.py    # 37 cases, stdlib only
```

25 real questions must reach the right scheme; **12 questions we have no data
for must be refused.** A broad new keyword breaks the second half immediately.

---

## 13. Not built, on purpose

- **Indian Sign Language.** ISL varies state to state with no dependable
  recogniser. We would have demoed 3 rehearsed signs. Promising inclusion we
  cannot deliver is worse than naming it as future work.
- **On-device AI.** Not possible in the time. Offline mode is a cached data pack,
  and the app says so.
- **Login and accounts.** No user data is stored anywhere.
