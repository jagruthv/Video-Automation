# AURA — Autonomous Unified Rendering Architecture

> High-throughput, zero-cloud-cost automated YouTube Shorts production pipeline.

---

## 🌟 Overview

**AURA** is an end-to-end automation engine that converts topic hooks and Reddit-style storytelling prompts into fully rendered, caption-synchronized 9:16 YouTube Shorts. 

The system operates locally without paid rendering services, leveraging local FFmpeg, the Google Gemini API (with a 9-tier cascade fallback), Pollinations.ai, and Edge-TTS WordBoundary alignment.

---

## 🏛 Architecture

```
                       ┌────────────────────────────────┐
                       │          AURA-V2               │
                       │   (Node.js Orchestrator)       │
                       └───────────────┬────────────────┘
                                       │
                                       │ 1. LLM Writes Script
                                       │ 2. Dispatches Director Script JSON
                                       ▼
                       ┌────────────────────────────────┐
                       │          AURA-V3               │
                       │   (Python Rendering Engine)    │
                       └───────────────┬────────────────┘
                                       │
           ┌───────────────────────────┼───────────────────────────┐
           ▼                           ▼                           ▼
    ┌───────────────┐           ┌───────────────┐           ┌───────────────┐
    │  Audio Forge  │           │ Visual Forges │           │ Caption Forge │
    │  Gemini TTS   │           │ Maps, Manim,  │           │ 3-word chunks │
    │ WordBoundaries│           │ UI, Vaults    │           │ Active color  │
    └───────┬───────┘           └───────┬───────┘           └───────┬───────┘
            │                           │                           │
            └───────────────────────────┼───────────────────────────┘
                                        ▼
                       ┌────────────────────────────────┐
                       │        FFmpeg Assembler        │
                       │   Zero-loss MP4 Compilation    │
                       └────────────────┬───────────────┘
                                        │
                                        ▼
                               output/[VideoID].mp4
```

---

## 📁 Repository Structure

```
d:/Automation/
├── .agents/                 # AI agent rules, skill references & model registries
├── AURA-V2/                 # Orchestrator (Express, queue, YouTube publisher, dashboard)
│   ├── dashboard/           # Next.js web dashboard
│   ├── src/                 # Orchestrator core, modules, database
│   ├── resources/           # Background footage (gaming/sand) & audio resources
│   └── .env.example         # Environment template for V2 & V3
├── AURA-V3/                 # Rendering Engine (FastAPI on port 8001)
│   ├── engine/              # Forges (audio, visual, caption, compositor, metadata)
│   ├── models.py            # Pydantic v2 schemas for Director Script
│   └── config.py            # Rendering paths, fonts, FFmpeg presets
├── SFX/                     # High-impact sound effects library (impact, whoosh, ping, etc.)
├── Vaults/                  # Video clip vault storage
├── n8n/                     # FFmpeg binary, yt-dlp, and raw asset vaults
└── README.md                # System documentation
```

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: v20+
- **Python**: v3.11+
- **FFmpeg**: Configured locally or located in `n8n/ffmpeg.exe`
- **pnpm** / **npm**

### 1. Configuration
Copy the environment template in `AURA-V2`:
```bash
cp AURA-V2/.env.example AURA-V2/.env
```
Fill in your `GEMINI_API_KEY`, optional `POLLINATIONS_BYOP_KEY`, and YouTube OAuth credentials.

### 2. Launch AURA-V3 (Rendering Server)
```bash
cd AURA-V3
python -m venv venv
# On Windows:
.\venv\Scripts\activate
pip install -r requirements.txt
python api.py
```
*Server runs on `http://127.0.0.1:8001`.*

### 3. Launch AURA-V2 (Orchestrator)
```bash
cd AURA-V2
pnpm install
pnpm start
```
*Orchestrator runs on `http://localhost:3001`.*

### 4. Launch Dashboard (Optional)
```bash
cd AURA-V2/dashboard
pnpm install
pnpm dev
```
*Dashboard available on `http://localhost:3000`.*

---

## 🛡 Design & Production Standards

1. **Titanium Aesthetic**: Dark modes, high contrast, vibrant accents, optimized for 9:16 Shorts.
2. **Retention First**: 3-word subtitle blocks, active word highlighting, fast-paced audio cues.
3. **Zero Waste**: All video rendering and audio composition run locally via FFmpeg.
4. **9-Tier Model Cascade**: Automatic graceful fallback across Google Gemini models.
