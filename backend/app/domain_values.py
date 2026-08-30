from __future__ import annotations

from enum import StrEnum


class Priority(StrEnum):
    LOW = "Low"
    NORMAL = "Normal"
    HIGH = "High"
    URGENT = "Urgent"


class RoomKind(StrEnum):
    ROOM = "room"
    AREA = "area"


class RoomStatus(StrEnum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    MAINTENANCE = "maintenance"


class TaskStatus(StrEnum):
    TODO = "To Do"
    DOING = "Doing"
    REVIEW = "Review"
    DONE = "Done"


class ProjectStatus(StrEnum):
    PLANNED = "Planned"
    ACTIVE = "Active"
    PAUSED = "Paused"
    DONE = "Done"


class RequestStatus(StrEnum):
    DRAFT = "Draft"
    REVIEW = "Review"
    APPROVED = "Approved"
    REJECTED = "Rejected"
    PLANNED = "Planned"
    DONE = "Done"


class ShiftStatus(StrEnum):
    NEW = "New"
    SEEN = "Seen"
    FOLLOW = "Follow"
    DONE = "Done"


class GuestStatus(StrEnum):
    OPEN = "Open"
    FOLLOW = "Follow"
    DONE = "Done"


class FixStatus(StrEnum):
    OPEN = "Open"
    WORKING = "Working"
    DONE = "Done"
    VERIFIED = "Verified"


class PostStatus(StrEnum):
    IDEA = "Idea"
    DRAFT = "Draft"
    REVIEW = "Review"
    FIX = "Fix"
    OK = "OK"
    SET = "Set"
    POSTED = "Posted"


class Platform(StrEnum):
    FACEBOOK = "Facebook"
    INSTAGRAM = "Instagram"
    TIKTOK = "TikTok"
    GOOGLE_BUSINESS = "Google Business"
    WEBSITE = "Website"


class ContentFormat(StrEnum):
    REEL = "Reel"
    STORY = "Story"
    STATIC = "Static"
    CAROUSEL = "Carousel"
    AD = "Ad"
    BLOG = "Blog"


WORKFLOW_RESOURCES = frozenset({"tasks", "projects", "requests", "shift-notes", "guests", "fixes", "posts"})


def values(enum_type: type[StrEnum]) -> frozenset[str]:
    return frozenset(item.value for item in enum_type)


ALLOWED_STATUSES = {
    "tasks": values(TaskStatus),
    "projects": values(ProjectStatus),
    "requests": values(RequestStatus),
    "shift-notes": values(ShiftStatus),
    "guests": values(GuestStatus),
    "fixes": values(FixStatus),
    "posts": values(PostStatus),
}


__all__ = [
    "ALLOWED_STATUSES",
    "ContentFormat",
    "FixStatus",
    "GuestStatus",
    "Platform",
    "PostStatus",
    "Priority",
    "ProjectStatus",
    "RequestStatus",
    "RoomKind",
    "RoomStatus",
    "ShiftStatus",
    "TaskStatus",
    "WORKFLOW_RESOURCES",
]
