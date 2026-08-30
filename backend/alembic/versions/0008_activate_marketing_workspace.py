"""activate scoped campaigns, concepts, and platform deliverables

Revision ID: 0008_activate_marketing_workspace
Revises: 0007_timezone_aware_utc
"""

from alembic import op
import sqlalchemy as sa


revision = "0008_activate_marketing_workspace"
down_revision = "0007_timezone_aware_utc"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    with op.batch_alter_table("marketing_campaigns", recreate="auto") as batch:
        batch.add_column(sa.Column("department_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_marketing_campaigns_department", "departments", ["department_id"], ["id"])
    with op.batch_alter_table("content_concepts", recreate="auto") as batch:
        batch.add_column(sa.Column("content_pillar", sa.String(length=80), nullable=True, server_default="General"))

    bind.execute(sa.text("""
        UPDATE marketing_campaigns
        SET department_id = COALESCE(
            (SELECT id FROM departments WHERE lower(name) = 'marketing' LIMIT 1),
            (SELECT id FROM departments ORDER BY id LIMIT 1)
        )
        WHERE department_id IS NULL
    """))
    missing = bind.execute(sa.text("SELECT count(*) FROM marketing_campaigns WHERE department_id IS NULL")).scalar_one()
    if missing:
        raise RuntimeError("Marketing campaigns exist but no department is available for required scope.")
    bind.execute(sa.text("UPDATE content_concepts SET content_pillar = 'General' WHERE content_pillar IS NULL OR trim(content_pillar) = ''"))

    with op.batch_alter_table("marketing_campaigns", recreate="auto") as batch:
        batch.alter_column("department_id", existing_type=sa.Integer(), nullable=False)
        batch.create_check_constraint("ck_marketing_campaigns_status", "status IN ('Planning', 'Active', 'Paused', 'Completed', 'Archived')")
        batch.create_index("ix_marketing_campaigns_department_status", ["department_id", "status", "updated_at"])
    with op.batch_alter_table("content_concepts", recreate="auto") as batch:
        batch.alter_column("content_pillar", existing_type=sa.String(length=80), nullable=False, server_default=None)
        batch.create_check_constraint("ck_content_concepts_status", "status IN ('Idea', 'Active', 'Completed', 'Archived')")
        batch.create_index("ix_content_concepts_campaign_pillar", ["campaign_id", "content_pillar", "updated_at"])
    with op.batch_alter_table("platform_deliverables", recreate="auto") as batch:
        batch.create_unique_constraint("uq_deliverable_concept_platform", ["concept_id", "platform"])
        batch.create_check_constraint("ck_platform_deliverables_platform", "platform IN ('Facebook', 'Instagram', 'TikTok', 'Google Business', 'Website')")
        batch.create_check_constraint("ck_platform_deliverables_format", "format IN ('Reel', 'Story', 'Static', 'Carousel', 'Ad', 'Blog')")
        batch.create_check_constraint("ck_platform_deliverables_status", "status IN ('Planned', 'Draft', 'Review', 'Fix', 'Approved', 'Scheduled', 'Published')")
        batch.create_index("ix_platform_deliverables_calendar", ["scheduled_at", "platform", "status", "id"])


def downgrade() -> None:
    with op.batch_alter_table("platform_deliverables", recreate="auto") as batch:
        batch.drop_index("ix_platform_deliverables_calendar")
        batch.drop_constraint("ck_platform_deliverables_status", type_="check")
        batch.drop_constraint("ck_platform_deliverables_format", type_="check")
        batch.drop_constraint("ck_platform_deliverables_platform", type_="check")
        batch.drop_constraint("uq_deliverable_concept_platform", type_="unique")
    with op.batch_alter_table("content_concepts", recreate="auto") as batch:
        batch.drop_index("ix_content_concepts_campaign_pillar")
        batch.drop_constraint("ck_content_concepts_status", type_="check")
        batch.drop_column("content_pillar")
    with op.batch_alter_table("marketing_campaigns", recreate="auto") as batch:
        batch.drop_index("ix_marketing_campaigns_department_status")
        batch.drop_constraint("ck_marketing_campaigns_status", type_="check")
        batch.drop_constraint("fk_marketing_campaigns_department", type_="foreignkey")
        batch.drop_column("department_id")
