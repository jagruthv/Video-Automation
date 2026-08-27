---
name: aura-director-script
description: >
  Complete reference for the AURA Director Script JSON format — the contract between
  AURA-V2 (orchestrator) and AURA-V3 (rendering engine). Use when building or debugging
  script generation, adding new visual engines, or validating JSON structure. Replaces
  reading models.py and forge schemas.
---

# AURA Director Script Reference

## Purpose
The Director Script is the JSON payload V2 sends to V3's `/render` endpoint.
It fully describes a video — narration text + visual instructions — per block.
Validated by Pydantic v2 (`AURA-V3/models.py`).

## Full JSON Schema
```json
{
  "Video_Metadata": {
    "Title": "string (required, used in output filename)"
  },
  "Timeline": [
    {
      "Block_ID": 1,
      "Audio_Narration": "Text read aloud by TTS for this block.",
      "Visual_Engine": "Background_Vault",
      "Visual_Parameters": {}
    }
  ]
}
```

**Rules:**
- `Block_ID` must be sequential: 1, 2, 3, ... no gaps
- `Timeline` must have at least 1 block
- Each block's `Visual_Parameters` is validated against its engine schema (see below)

## Visual Engines & Parameters

### `Background_Vault`
Selects a random clip from the ASMR vault. Most common engine.
```json
{
  "filename": null,          // optional — specific file. null = random
  "search_tag": null,        // reserved, unused
  "effect": "slow_zoom"      // "none" | "slow_zoom" | "ken_burns"
}
```

### `Map_Engine`
Renders a Mapbox static tile showing a location.
```json
{
  "location_name": "London, UK",
  "lat": 51.5074,
  "lon": -0.1278,
  "country_zoom": 4,   // optional, default 4
  "city_zoom": 12      // optional, default 12
}
```
Requires: `MAPBOX_TOKEN` in `.env`

### `Manim_Legal_Doc`
Animates a legal document with highlight effects.
```json
{
  "document_text": "Full body text of the document...",
  "highlight_text": ["clause to highlight", "another phrase"],
  "title": "Optional Title"   // optional
}
```

### `Manim_Flowchart`
Renders a step-by-step flowchart animation.
```json
{
  "nodes": ["Step 1", "Step 2", "Step 3"],  // min 2 nodes
  "edges": [[0, 1], [1, 2]],                // optional, linear chain if omitted
  "title": "Optional Flowchart Title"
}
```

### `UI_Popup`
Renders an iOS-style SMS or email notification popup.
```json
{
  "popup_type": "sms",             // "sms" | "email"
  "sender_name": "John",
  "sender_handle": "+1 555 0100",  // optional (phone or email)
  "body_text": "Message text here",
  "timestamp": "9:41 AM",          // optional
  "app_name": "Gmail"              // optional, for email type
}
```

## V3 API Endpoints
```
POST http://localhost:8001/render
Body: { "script": "...", "title": "...", "director_script": {...} }

GET  http://localhost:8001/status?id={video_id}
GET  http://localhost:8001/output/{video_id}
GET  http://localhost:8001/health
```

## Pydantic Validation
File: `AURA-V3/models.py`
- `DirectorScript.model_validate(dict)` — validates entire script
- `DirectorScript.model_validate_json(str)` — from JSON string
- On failure: raises `ValueError` with clear block-level error message

## Example Minimal Script
```json
{
  "Video_Metadata": {"Title": "My Mother Stole My Wedding Fund"},
  "Timeline": [
    {
      "Block_ID": 1,
      "Audio_Narration": "She exposed herself at family dinner.",
      "Visual_Engine": "Background_Vault",
      "Visual_Parameters": {"effect": "slow_zoom"}
    },
    {
      "Block_ID": 2,
      "Audio_Narration": "I had saved for three years.",
      "Visual_Engine": "Background_Vault",
      "Visual_Parameters": {}
    }
  ]
}
```
