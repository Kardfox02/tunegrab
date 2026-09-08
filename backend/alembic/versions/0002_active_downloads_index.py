"""add active downloads lookup index

Revision ID: 0002_active_downloads_index
Revises: 0001_initial_schema
"""

from alembic import op

revision = "0002_active_downloads_index"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_tracks_status_created_at",
        "tracks",
        ["status", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_tracks_status_created_at", table_name="tracks")
