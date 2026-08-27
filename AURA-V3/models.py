"""
models.py — AURA-V3 Director Script Schema (Pydantic v2)
==========================================================
Validates the JSON Director Script before any rendering starts.
If the JSON is malformed, the pipeline aborts immediately with a
clear, human-readable error message.

Supported Visual_Engine values:
  Map_Engine | Manim_Legal_Doc | Manim_Flowchart | UI_Popup | Background_Vault
"""

from __future__ import annotations
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field, PrivateAttr, field_validator, model_validator


# ─────────────────────────────────────────────
# VISUAL PARAMETER SCHEMAS  (one per engine)
# ─────────────────────────────────────────────

class MapEngineParams(BaseModel):
    location_name : str   = Field(..., description="Human-readable name, e.g. 'London, UK'")
    lat           : float = Field(..., description="WGS84 latitude")
    lon           : float = Field(..., description="WGS84 longitude")
    country_zoom  : Optional[int] = Field(None, description="Mapbox zoom for country view. Default: 4")
    city_zoom     : Optional[int] = Field(None, description="Mapbox zoom for city view. Default: 12")

    @field_validator("lat")
    @classmethod
    def _check_lat(cls, v: float) -> float:
        if not -90 <= v <= 90:
            raise ValueError(f"lat must be -90 to 90, got {v}")
        return v

    @field_validator("lon")
    @classmethod
    def _check_lon(cls, v: float) -> float:
        if not -180 <= v <= 180:
            raise ValueError(f"lon must be -180 to 180, got {v}")
        return v


class ManimLegalDocParams(BaseModel):
    document_text : str       = Field(..., description="Full body text of the legal document")
    highlight_text: List[str] = Field(..., description="Substrings to animate-highlight in yellow")
    title         : Optional[str] = Field(None, description="Optional bold heading at top of document")


class ManimFlowchartParams(BaseModel):
    nodes : List[str]                 = Field(..., min_length=2, description="Ordered step labels")
    edges : Optional[List[List[int]]] = Field(
        None,
        description="[[from_index, to_index], ...]. Linear chain if omitted."
    )
    title : Optional[str] = Field(None, description="Optional title displayed above the flowchart")


class UIPopupParams(BaseModel):
    popup_type    : Literal["sms", "email"] = Field(..., description="'sms' or 'email'")
    sender_name   : str                     = Field(..., description="Bold name at top of card")
    sender_handle : Optional[str]           = Field(None, description="Phone number or email address")
    body_text     : str                     = Field(..., description="Message preview text")
    timestamp     : Optional[str]           = Field(None, description="e.g. '9:41 AM'. Defaults to 'now'.")
    app_name      : Optional[str]           = Field(None, description="For email: app label (e.g. 'Gmail')")


class BackgroundVaultParams(BaseModel):
    filename   : Optional[str] = Field(None, description="Specific filename in vault dir. Random if None.")
    search_tag : Optional[str] = Field(None, description="Reserved for future tag-based clip matching")
    effect     : Optional[Literal["none", "slow_zoom", "ken_burns"]] = Field(
        "slow_zoom",
        description="Motion effect applied to the clip."
    )


# ─────────────────────────────────────────────
# ENGINE → PARAM MODEL REGISTRY
# ─────────────────────────────────────────────

VisualEngineType = Literal[
    "Map_Engine",
    "Manim_Legal_Doc",
    "Manim_Flowchart",
    "UI_Popup",
    "Background_Vault",
]

_ENGINE_MAP: Dict[str, type] = {
    "Map_Engine"      : MapEngineParams,
    "Manim_Legal_Doc" : ManimLegalDocParams,
    "Manim_Flowchart" : ManimFlowchartParams,
    "UI_Popup"        : UIPopupParams,
    "Background_Vault": BackgroundVaultParams,
}


# ─────────────────────────────────────────────
# TIMELINE BLOCK
# ─────────────────────────────────────────────

class TimelineBlock(BaseModel):
    """One scene block — audio narration + a visual forge + its parameters."""

    Block_ID         : int              = Field(..., ge=1, description="1-indexed block number")
    Audio_Narration  : str              = Field(..., min_length=1, description="TTS narration text")
    Visual_Engine    : VisualEngineType = Field(..., description="Which forge to invoke")
    Visual_Parameters: Dict[str, Any]   = Field(default_factory=dict)

    # BUG FIX: In Pydantic v2, attributes starting with _ must be declared
    # as PrivateAttr. Using `_params: Any = None` makes it a class variable
    # and object.__setattr__ would write to it but self._params would still
    # read the class-level None. PrivateAttr is the correct pattern.
    _params: Any = PrivateAttr(default=None)

    @model_validator(mode="after")
    def _parse_visual_params(self) -> "TimelineBlock":
        """
        Coerce Visual_Parameters dict into the strict typed model
        for the declared Visual_Engine. Raises immediately with a
        clear error if parameters are wrong.
        """
        model_cls = _ENGINE_MAP.get(self.Visual_Engine)
        if model_cls:
            try:
                self._params = model_cls(**self.Visual_Parameters)
            except Exception as exc:
                raise ValueError(
                    f"Block {self.Block_ID} ({self.Visual_Engine}): "
                    f"invalid Visual_Parameters — {exc}"
                ) from exc
        return self

    def get_params(self) -> Any:
        """Return the validated, typed Visual_Parameters object for this block."""
        return self._params


# ─────────────────────────────────────────────
# TOP-LEVEL DIRECTOR SCRIPT
# ─────────────────────────────────────────────

class VideoMetadata(BaseModel):
    Title: str = Field(..., min_length=1, description="Video title, used in output filename")


class DirectorScript(BaseModel):
    """
    Complete, validated Director Script.

    Usage:
        script = DirectorScript.model_validate(python_dict)
        script = DirectorScript.model_validate_json(json_string)
    """
    Video_Metadata : VideoMetadata       = Field(...)
    Timeline       : List[TimelineBlock] = Field(..., min_length=1)

    @model_validator(mode="after")
    def _check_sequential_block_ids(self) -> "DirectorScript":
        ids      = [b.Block_ID for b in self.Timeline]
        expected = list(range(1, len(ids) + 1))
        if ids != expected:
            raise ValueError(
                f"Block_IDs must be 1, 2, 3, ... with no gaps. "
                f"Expected {expected}, got {ids}."
            )
        return self
