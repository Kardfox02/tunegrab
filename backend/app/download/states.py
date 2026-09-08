from enum import StrEnum


class TrackStatus(StrEnum):
    PENDING = "pending"
    DOWNLOADING = "downloading"
    CONVERTING = "converting"
    FINALIZING = "finalizing"
    DONE = "done"
    ERROR = "error"
    CANCELLED = "cancelled"


ALLOWED_TRANSITIONS: dict[TrackStatus, frozenset[TrackStatus]] = {
    TrackStatus.PENDING: frozenset({TrackStatus.DOWNLOADING, TrackStatus.CANCELLED, TrackStatus.ERROR}),
    TrackStatus.DOWNLOADING: frozenset({TrackStatus.CONVERTING, TrackStatus.CANCELLED, TrackStatus.ERROR}),
    TrackStatus.CONVERTING: frozenset({TrackStatus.FINALIZING, TrackStatus.CANCELLED, TrackStatus.ERROR}),
    TrackStatus.FINALIZING: frozenset({TrackStatus.DONE, TrackStatus.CANCELLED, TrackStatus.ERROR}),
    TrackStatus.DONE: frozenset({TrackStatus.ERROR}),
    TrackStatus.ERROR: frozenset({TrackStatus.PENDING}),
    TrackStatus.CANCELLED: frozenset({TrackStatus.PENDING}),
}


class InvalidTrackTransitionError(ValueError):
    """Raised when a download status transition is not allowed."""


def transition_status(current: str, target: TrackStatus) -> TrackStatus:
    try:
        current_status = TrackStatus(current)
    except ValueError as error:
        raise InvalidTrackTransitionError(f"Unknown track status: {current}") from error
    if target not in ALLOWED_TRANSITIONS[current_status]:
        raise InvalidTrackTransitionError(f"Cannot transition {current_status} to {target}")
    return target
