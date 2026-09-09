"""playlist access table (co-author subscriptions)

Revision ID: 0003_playlist_access
Revises: 0002_active_downloads_index
"""

import sqlalchemy as sa
from alembic import op

revision = "0003_playlist_access"
down_revision = "0002_active_downloads_index"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "playlist_access",
        sa.Column("playlist_id", sa.Integer(), sa.ForeignKey("playlists.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
    )
    op.create_index("ix_playlist_access_user_id", "playlist_access", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_playlist_access_user_id", table_name="playlist_access")
    op.drop_table("playlist_access")
