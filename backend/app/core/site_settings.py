from copy import deepcopy
from typing import Any, Dict, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


FeatureAccess = Literal["disabled", "authenticated", "admin"]


class BrandingSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    siteName: str = Field(default="Analytics Dashboard", min_length=2, max_length=80)
    homeTitle: str = Field(default="Analytics Dashboard", min_length=2, max_length=120)
    homeDescription: str = Field(
        default="Turn spreadsheets into practical dashboards and direct answers.",
        min_length=10,
        max_length=300,
    )
    primaryColor: str = "#2563EB"
    template: Literal["standard", "focused"] = "standard"

    @field_validator("primaryColor")
    @classmethod
    def validate_hex_color(cls, value: str) -> str:
        if len(value) != 7 or not value.startswith("#"):
            raise ValueError("primaryColor must be a six-digit hexadecimal color")
        try:
            int(value[1:], 16)
        except ValueError as error:
            raise ValueError("primaryColor must be a six-digit hexadecimal color") from error
        return value.upper()


class SectionSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    showCapabilities: bool = True
    showDashboard: bool = True
    showUpload: bool = True


class FeatureSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    localUpload: bool = True
    urlImport: bool = True
    dataAssistant: bool = True
    reports: bool = True
    exports: bool = True
    serverWorkspace: FeatureAccess = "admin"
    serverAnalytics: FeatureAccess = "admin"
    serverLayouts: FeatureAccess = "admin"
    serverExports: FeatureAccess = "admin"
    aiLayoutSuggestions: FeatureAccess = "disabled"


class SiteSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    branding: BrandingSettings = Field(default_factory=BrandingSettings)
    sections: SectionSettings = Field(default_factory=SectionSettings)
    features: FeatureSettings = Field(default_factory=FeatureSettings)


class SiteSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    branding: BrandingSettings | None = None
    sections: SectionSettings | None = None
    features: FeatureSettings | None = None


def merge_dicts(base: Dict[str, Any], updates: Dict[str, Any]) -> Dict[str, Any]:
    merged = deepcopy(base)
    for key, value in updates.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = merge_dicts(merged[key], value)
        else:
            merged[key] = value
    return merged


def resolve_site_settings(config_values: Dict[str, Any]) -> SiteSettings:
    raw_settings = config_values.get("site_settings", {})
    if not isinstance(raw_settings, dict):
        raw_settings = {}
    defaults = SiteSettings().model_dump()
    return SiteSettings.model_validate(merge_dicts(defaults, raw_settings))


def update_site_settings(current: SiteSettings, updates: SiteSettingsUpdate) -> SiteSettings:
    return SiteSettings.model_validate(
        merge_dicts(current.model_dump(), updates.model_dump(exclude_none=True))
    )
