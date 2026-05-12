"""
SQLAlchemy ORM models for the Sentinel-AI persistence layer.

Schema overview:
  users                     One row per Google account that signed in.

  weekly_report_emails      One row per Gmail message (PB Weekly report).
  weekly_report_rows        One row per CSV row inside a weekly email.
  weekly_report_overrides   Audit-logged manual edits for weekly rows.

  daily_report_emails       One row per Gmail message (PB Daily report).
  daily_report_rows         One row per CSV row inside a daily email.
  daily_report_overrides    Audit-logged manual edits for daily rows --
                            shared between the Daily Alerts page and the
                            Jira Tickets page (which both edit the same
                            underlying alert).
  jira_created_tickets      One row per (message_id, row_index) that has had
                            a Jira issue created for it. Lets the backend
                            de-duplicate "Create Jira" clicks across browser
                            refreshes / different machines.

Design choices:
  - Stable Gmail `message id` is used as the primary key for emails so
    re-fetches are idempotent (upsert by id).
  - `headers_json` and `values_json` are stored as JSON text (TEXT in SQLite,
    JSON in Postgres) so we don't need to re-parse the email each render.
  - Overrides are SHARED across users (per the user's choice), with `updated_by`
    + `updated_at` audit columns so we always know who last edited a cell.
  - All identifiers used as DB inputs come via ORM bound parameters (no raw SQL
    string concatenation), per the workspace SQL-injection rule.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Index,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db import Base


def _utcnow() -> datetime:
    return datetime.utcnow()


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, nullable=False)
    last_seen_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    weekly_overrides: Mapped[list["WeeklyReportOverride"]] = relationship(
        back_populates="updated_by_user", cascade="save-update"
    )
    daily_overrides: Mapped[list["DailyReportOverride"]] = relationship(
        back_populates="updated_by_user", cascade="save-update"
    )
    created_jira_tickets: Mapped[list["JiraCreatedTicket"]] = relationship(
        back_populates="created_by_user", cascade="save-update"
    )


class WeeklyReportEmail(Base):
    __tablename__ = "weekly_report_emails"

    # Gmail message id is globally stable; use it directly as the primary key.
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    thread_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)

    from_address: Mapped[Optional[str]] = mapped_column(String(320), nullable=True, index=True)
    subject: Mapped[Optional[str]] = mapped_column(String(998), nullable=True)
    # Header date string as it came from Gmail (kept for parity with the existing payload)
    date_header: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    # Gmail's `internalDate` (ms since epoch) -- normalised so we can sort and range-filter quickly.
    internal_date_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)

    csv_filename: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    # Cached headers as JSON text (small + immutable per email).
    headers_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, nullable=False)
    fetched_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    rows: Mapped[list["WeeklyReportRow"]] = relationship(
        back_populates="email",
        cascade="all, delete-orphan",
        order_by="WeeklyReportRow.row_index",
    )

    __table_args__ = (
        Index("ix_wre_internal_date_ms", "internal_date_ms"),
    )


class WeeklyReportRow(Base):
    __tablename__ = "weekly_report_rows"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    message_id: Mapped[str] = mapped_column(
        ForeignKey("weekly_report_emails.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Row position inside the original CSV (stable for override keys).
    row_index: Mapped[int] = mapped_column(Integer, nullable=False)

    # Full original row preserved as JSON so the table renders identically to the email.
    values_json: Mapped[str] = mapped_column(Text, nullable=False)

    # Normalised columns (best-effort) so we can index / filter / search quickly.
    incident_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    servicenow_ticket: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    csv_status: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    # ISO date / datetime string from the Created column, when parseable.
    created_iso: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)

    email: Mapped["WeeklyReportEmail"] = relationship(back_populates="rows")

    __table_args__ = (
        UniqueConstraint("message_id", "row_index", name="uq_wrr_msg_row"),
    )


class WeeklyReportOverride(Base):
    """
    Shared, audit-logged user edits for a (message_id, row_index, field) tuple.

    `field` is one of:
      - "status"           -> Status dropdown value
      - "closure_comment"  -> Closure Comments cell text
      - "closure_date"     -> Closure Date cell value (ISO string)
    """
    __tablename__ = "weekly_report_overrides"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    message_id: Mapped[str] = mapped_column(
        ForeignKey("weekly_report_emails.id", ondelete="CASCADE"),
        nullable=False,
    )
    row_index: Mapped[int] = mapped_column(Integer, nullable=False)
    field: Mapped[str] = mapped_column(String(32), nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False, default="")

    updated_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow, onupdate=_utcnow, nullable=False
    )

    updated_by_user: Mapped[Optional[User]] = relationship(back_populates="weekly_overrides")

    __table_args__ = (
        UniqueConstraint(
            "message_id", "row_index", "field", name="uq_wro_msg_row_field"
        ),
        Index("ix_wro_msg_row", "message_id", "row_index"),
    )


# ---------------------------------------------------------------------------
# Daily Alerts pipeline (PB Daily) -- shared by Daily Alerts & Jira Tickets pages
# ---------------------------------------------------------------------------


class DailyReportEmail(Base):
    """One Gmail message of `PB Daily report`. Same shape as WeeklyReportEmail."""

    __tablename__ = "daily_report_emails"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    thread_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)

    from_address: Mapped[Optional[str]] = mapped_column(String(320), nullable=True, index=True)
    subject: Mapped[Optional[str]] = mapped_column(String(998), nullable=True)
    date_header: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    internal_date_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)

    csv_filename: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    headers_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, nullable=False)
    fetched_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    rows: Mapped[list["DailyReportRow"]] = relationship(
        back_populates="email",
        cascade="all, delete-orphan",
        order_by="DailyReportRow.row_index",
    )

    __table_args__ = (
        Index("ix_dre_internal_date_ms", "internal_date_ms"),
    )


class DailyReportRow(Base):
    """One CSV row inside a daily email; identity is (message_id, row_index)."""

    __tablename__ = "daily_report_rows"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    message_id: Mapped[str] = mapped_column(
        ForeignKey("daily_report_emails.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    row_index: Mapped[int] = mapped_column(Integer, nullable=False)

    values_json: Mapped[str] = mapped_column(Text, nullable=False)

    incident_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    servicenow_ticket: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    csv_status: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    created_iso: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)

    email: Mapped["DailyReportEmail"] = relationship(back_populates="rows")

    __table_args__ = (
        UniqueConstraint("message_id", "row_index", name="uq_drr_msg_row"),
    )


class DailyReportOverride(Base):
    """
    Shared analyst edits for a (message_id, row_index, field) tuple.

    `field` is one of:
      - "status"           -> Status dropdown value
      - "closure_comment"  -> Closure Comments cell text
      - "closure_date"     -> Closure Date (ISO string)

    The Daily Alerts and Jira Tickets pages both read/write these rows -- they
    were sharing the same `sentinel_daily_alerts_*` localStorage keys before
    the DB migration.
    """

    __tablename__ = "daily_report_overrides"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    message_id: Mapped[str] = mapped_column(
        ForeignKey("daily_report_emails.id", ondelete="CASCADE"),
        nullable=False,
    )
    row_index: Mapped[int] = mapped_column(Integer, nullable=False)
    field: Mapped[str] = mapped_column(String(32), nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False, default="")

    updated_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow, onupdate=_utcnow, nullable=False
    )

    updated_by_user: Mapped[Optional[User]] = relationship(back_populates="daily_overrides")

    __table_args__ = (
        UniqueConstraint(
            "message_id", "row_index", "field", name="uq_dro_msg_row_field"
        ),
        Index("ix_dro_msg_row", "message_id", "row_index"),
    )


class JiraCreatedTicket(Base):
    """
    Records that a Jira issue was created (or linked) for a given alert row.

    Identity is (message_id, row_index) because Gmail message ids are stable
    -- so re-fetching the same daily report keeps the same key. We additionally
    store incident_id / servicenow_ticket so the server can dedupe across
    re-fetches if the same incident shows up in multiple daily reports
    (e.g. a row that appears unchanged the next day).
    """

    __tablename__ = "jira_created_tickets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    message_id: Mapped[str] = mapped_column(
        ForeignKey("daily_report_emails.id", ondelete="CASCADE"),
        nullable=False,
    )
    row_index: Mapped[int] = mapped_column(Integer, nullable=False)

    jira_key: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    jira_url: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)

    # Denormalised search columns -- useful for "was this incident already ticketed?"
    incident_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    servicenow_ticket: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)

    created_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, nullable=False)

    created_by_user: Mapped[Optional[User]] = relationship(back_populates="created_jira_tickets")

    __table_args__ = (
        UniqueConstraint("message_id", "row_index", name="uq_jct_msg_row"),
        Index("ix_jct_msg_row", "message_id", "row_index"),
    )
