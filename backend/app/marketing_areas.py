"""Explicit area labels; never infer from an older campaign's title."""
from fastapi import HTTPException

AREAS = ("Rooms", "Pool", "Café", "Kitchen", "Bar")


def validate_marketing_areas(areas):
    if areas is None:
        return
    names = [item.value if hasattr(item, "value") else item for item in areas]
    if not names or len(names) > len(AREAS) or any(name not in AREAS for name in names) or len(set(names)) != len(names):
        raise HTTPException(status_code=422, detail="Choose one or more different areas: Rooms, Pool, Café, Kitchen or Bar.")
