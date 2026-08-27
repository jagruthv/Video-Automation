"""
Script Rewriter + Chunker
=========================
Calls the LLM cascade (same as metadata.py) to:
  1. Lightly rewrite the sanitised script with fresh vocabulary
     (same story / events / names — different phrasing & sentence structure)

Returns:
    {"script": str}

Each script goes to Pollinations TTS.
"""

import json
import logging
import re

from engine.metadata import _llm, extract_json   # re-use the 4-tier LLM cascade and robust JSON parser

logger = logging.getLogger("aura.rewriter")


def rewrite_and_chunk(script: str, title: str, retry_count: int = 0) -> dict[str, str]:
    """
    Rewrite the script and split into 3 chunks.
    Features self-healing: retries up to 2 times on JSON failure.
    Returns {"chunk_1": str, "chunk_2": str, "chunk_3": str}.
    Falls back to naive 3-way split if LLM fails repeatedly.
    """
    if retry_count >= 2:
        logger.warning("[REWRITER] max retries exceeded -- returning original script.")
        return {"script": script}

    word_count = len(script.split())
    # Target ~190 words → ≈55s output at 1.4x TTS speed, 150 WPM
    target_words = 190

    prompt = f"""You are an elite YouTube Shorts scriptwriter specializing in viral, high-retention Family Drama and Revenge storytelling.

CHANNEL CONTEXT: This is for "Vibecoder Daily" — a Family Drama / Reddit Revenge Shorts channel.
ORIGINAL TITLE: "{title}"

TASK — Execute BOTH steps in a single pass:

STEP 1 — AGGRESSIVE REWRITE

THE HOOK (First sentence ONLY — MOST CRITICAL RULE):
- Must be 5-7 words MAXIMUM. Strictly enforced. No exceptions.
- One punchy statement that creates immediate shock, curiosity, or stakes.
- Good examples: "She exposed herself at family dinner." / "My boss destroyed his own career."
- NEVER use "Imagine", "Have you ever", "I want to tell you". Drop the viewer INTO the action.
- Wrap the entire hook in <excitement> tags: <excitement>She exposed herself at family dinner.</excitement>

STORY BODY RULES — 3-ACT PACING (STRICTLY ENFORCED):
The script must follow this exact structure. Word budgets are hard limits:

  ACT 1 — CONTEXT (words 8–40, ≈10 seconds):
  - Maximum 2 sentences of backstory. That's it. No childhood dynamics, no long relationship history.
  - Establish WHO and WHAT the conflict is about in the fewest words possible.
  - BAD: "We grew up in a small house. My sister always got the better bedroom. Mom always favoured her. Even in school..."
  - GOOD: "My sister always came first. That ended the day she moved into my house."

  ACT 2 — TURNING POINT (words 40–120, ≈30 seconds):
  - The main conflict / inciting event MUST arrive by word 50. No exceptions.
  - This is the "five-bedroom listing" moment — the specific action that changes everything.
  - Drive straight to the confrontation: what happened, what was said, what was discovered.
  - Every sentence escalates. Remove any sentence that doesn't move the conflict forward.
  - Wrap the peak moment in <excitement> tags.

  ACT 3 — CLIMAX + CONSEQUENCE (words 120–185):
  - The revenge, justice, or twist payoff.
  - Show the result in 2-4 sentences. Make it satisfying and final.
  - Wrap the most satisfying moment in <excitement> tags.

BANNED IN ALL ACTS:
- Childhood memories longer than 1 sentence
- "Growing up...", "Ever since we were kids...", "For years..." openers
- Transition filler: "So anyway", "As I was saying", "To make a long story short"
- Any sentence that doesn't directly advance the conflict or payoff


ENDING — CALL TO ACTION (words 185–200, REQUIRED):
- End with a cliffhanger or open question that makes viewers demand Part 2.
- Then invite them to comment: "Comment 'PART 2' if you want to know what happened next."
- Keep it casual. One sentence reveal + one sentence CTA.
- Example: "And that's when the real bombshell dropped. Comment 'PART 2' if you want to know what happened next."

STRICT WORD COUNT: Total output MUST be between 170–200 words. Do NOT exceed 200 words. Video must stay under 60 seconds.

STEP 2 — JSON FORMATTING
Output BOTH the rewritten script AND a Story-First title into a single JSON object.

TITLE RULES (Critical for retention):
- Pattern: "[Person] [Shocking Action] [And Then X Happened]" — first-person narrative
- Good: "My Sister Stole My Wedding Fund So I Deleted Her Entire Digital Life"
- Good: "I Couldn't Stop Laughing at My Daughter's School Incident"
- BANNED: All-caps words (SHOCKING, AMAZING, SECRET, EXPOSED, REVEALED)
- BANNED: Trivia/fact style titles ("The Secret Hole in Your Spoon Will SHOCK You")
- BANNED: Generic "you won't believe" or "wait for it" phrases
- The title must deliver the NARRATIVE PROMISE — what is the revenge/drama payoff?

RETURN FORMAT:
Return ONLY valid JSON. No markdown, no explanation, no code blocks:
{{
  "script": "Full rewritten story here...",
  "title": "Story-First narrative title here"
}}

ORIGINAL SCRIPT ({word_count} words):
{script}"""

    if retry_count > 0:
        logger.info(f"[REWRITER] Retrying ({retry_count}/2) due to invalid JSON.")
        prompt += "\n\nCRITICAL: YOUR PREVIOUS OUTPUT HAD INVALID JSON OR WAS MISSING KEYS. ENSURE IT IS STRICTLY VALID PARSABLE JSON."

    try:
        raw = _llm(prompt)
        parsed = extract_json(raw)

        if "script" not in parsed:
            raise ValueError("Missing 'script' in output")

        # Use LLM-generated Story-First title if provided, else keep original
        new_title = parsed.get("title", "").strip() or title

        logger.info(f"[REWRITER] Success. Output length: {len(parsed['script'].split())} words | Title: {new_title[:60]}")
        return {
            "script": parsed["script"],
            "title":  new_title,
        }

    except Exception as e:
        logger.warning(f"[REWRITER] LLM rewrite failed ({type(e).__name__}: {e})")
        return rewrite_and_chunk(script, title, retry_count + 1)
