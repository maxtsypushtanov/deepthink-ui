# DeepThink UI

Personal LLM Web UI with an advanced reasoning engine — 5 strategies to make any model think deeper.

![DeepThink UI](https://img.shields.io/badge/DeepThink-UI-blue?style=flat-square)
![Python](https://img.shields.io/badge/Python-3.11+-green?style=flat-square)
![React](https://img.shields.io/badge/React-19-blue?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)

## 💡 Idea

A beautiful, minimalist chat interface where **any model gains reasoning superpowers** through a built-in orchestration layer. No need for expensive Claude Opus — even a cheap model thinks deeply and structurally through the middleware.

## 🧠 Reasoning Engine — 5 Strategies

| Strategy | Description |
|---|---|
| **CoT Injection** | Forces step-by-step thinking via system prompt engineering |
| **Budget Forcing** | When a model wants to stop, appends "Wait..." to force deeper reasoning (s1-approach) |
| **Best-of-N** | Generates N parallel answers, picks the best by voting |
| **Tree of Thoughts** | Full tree search over reasoning paths with branch evaluation |
| **Auto** | Automatically detects question complexity and selects the optimal strategy |

## 🔌 Multi-Provider Support

- **OpenRouter** — Access to 200+ models via a single API key
- **Cloud.ru Foundation Models** — Russian servers
- **DeepSeek API** — Including R1 with native reasoning
- Any **OpenAI-compatible** endpoint

## 🎨 Design

- Dark-first minimalist UI inspired by Linear × iA Writer × Vercel
- **Geist** font family (Sans + Mono)
- Collapsible thinking panel with color-coded step badges
- Interactive reasoning tree (React Flow)
- Light theme available

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, TailwindCSS, shadcn/ui, Zustand |
| Backend | FastAPI, SQLite, httpx |
| Fonts | Geist Sans + Geist Mono |

## 📦 Quick Start

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env      # Add your API keys
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env      # Point to backend URL
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

## ⚙️ Configuration

All providers are configured in the Settings panel:

1. Open the app → click ⚙️ Settings
2. Add your API keys for desired providers
3. Select a model and reasoning strategy
4. Start chatting

## 📁 Project Structure

```
deepthink-ui/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI entry point
│   │   ├── api/                  # REST endpoints
│   │   ├── core/                 # Config, dependencies
│   │   ├── db/                   # SQLite models & migrations
│   │   ├── providers/            # LLM provider adapters
│   │   └── reasoning/            # Reasoning engine (5 strategies)
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── components/           # React components
│   │   ├── hooks/                # Custom hooks
│   │   ├── lib/                  # Utilities
│   │   ├── stores/               # Zustand stores
│   │   └── types/                # TypeScript types
│   ├── package.json
│   └── .env.example
└── README.md
```

## 📄 License

MIT
