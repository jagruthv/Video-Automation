# AURA-V2 AI Model Intelligence

This document tracks the active AI model tiers and quotas for the AURA-V2 workspace, ensuring architectural decisions align with available compute.

## 🧠 Brain Tier (Gemini / Google AI Studio)
As of April 2026, the following models are verified for **Production** use based on active quotas:

| Model ID | Category | RPM | TPM | RPD | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `gemini-3.1-flash-lite-preview` | Text-out | 15 | 250K | 500 | **PRIMARY** |
| `gemini-2.5-flash` | Text-out | 5 | 250K | 20 | **FALLBACK** |
| `Gemini 2.5 Flash Native Audio` | Live API | ∞ | 1M | ∞ | Available |

> [!CAUTION]
> **CLOSED MODELS**: Gemini 1.5 Flash, Gemini 2.0, and Gemini 3.0 Pro currently show **0/0** quota or are unavailable for this tier. Avoid using these in orchestrator logic.

## 🎥 Visual Tier (Image & Motion)

| Provider | Model / Engine | Status | Notes |
| :--- | :--- | :--- | :--- |
| **Pollinations** | Standard AI | ✅ Active | Unlimited free tier. |
| **Pexels** | Stock Motion | ✅ Active | High-fidelity video fallbacks. |
| **Hugging Face** | FLUX.1-schnell | ❌ Depleted | 402 Payment Required for April. |
| **Modal GPU** | AnimateDiff-Lightning | ⚠️ Hashed | Use `videoengine--ca67e9` endpoint. |

## 🕹️ Orchestrator Logic
- **Primary Scripting**: `gemini-3.1-flash-lite-preview`
- **Primary Visuals**: Pollinations (due to HF depletion)
- **Primary Motion**: Pexels Video (due to Modal stability)
