from datetime import datetime

from sqlalchemy import DateTime, Float, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Track(Base):
    __tablename__ = "tracks"
    __table_args__ = (
        Index("ix_tracks_title", "title"),
        Index("ix_tracks_author", "author"),
        Index("ix_tracks_status_created_at", "status", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    youtube_id: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    author: Mapped[str] = mapped_column(Text, nullable=False)
    duration: Mapped[float | None] = mapped_column(Float)
    file_path: Mapped[str | None] = mapped_column(Text)
    cover_path: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    progress: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    file_size: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.current_timestamp(), nullable=False)

    playlist_links = relationship("PlaylistTrack", back_populates="track", cascade="all, delete-orphan")
    listen_events = relationship("ListenEvent", back_populates="track", cascade="all, delete-orphan")
    likes = relationship("Like", back_populates="track", cascade="all, delete-orphan")
