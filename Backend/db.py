"""
SQLAlchemy engine + session factory for Sentinel-AI.

Default DB is a single SQLite file at Backend/storage/sentinel.db (zero install).
Switch to PostgreSQL later by setting the DATABASE_URL env var, e.g.
  DATABASE_URL=postgresql+psycopg2://user:pass@host:5432/sentinel

All ORM access goes through `SessionLocal()`. SQL is built only via the ORM /
parameterized statements -- never via string concatenation -- per workspace
SQL-injection rules.
"""
from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker, DeclarativeBase


_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
_STORAGE_DIR = os.path.join(_BACKEND_DIR, "storage")
os.makedirs(_STORAGE_DIR, exist_ok=True)

_DEFAULT_SQLITE_PATH = os.path.join(_STORAGE_DIR, "sentinel.db")
DATABASE_URL: str = os.environ.get(
    "DATABASE_URL",
    f"sqlite:///{_DEFAULT_SQLITE_PATH.replace(os.sep, '/')}",
)


def _make_engine(url: str) -> Engine:
    """SQLite needs check_same_thread=False because Flask serves multiple threads."""
    if url.startswith("sqlite"):
        return create_engine(
            url,
            future=True,
            connect_args={"check_same_thread": False},
        )
    return create_engine(url, future=True, pool_pre_ping=True)


engine: Engine = _make_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    """Common declarative base for all ORM models."""


def init_db() -> None:
    """
    Create all tables if they don't exist. Safe to call repeatedly.

    For schema evolution beyond additive changes we should adopt Alembic;
    for now this is a single-process app and additive-only schema, so
    create_all is sufficient.
    """
    # Local import avoids circular import at module load time.
    from models import db_models  # noqa: F401

    Base.metadata.create_all(bind=engine)


@contextmanager
def session_scope() -> Iterator[Session]:
    """
    Yield a session and commit/rollback automatically. Use for request handlers
    that don't need fine-grained transaction control:

        with session_scope() as db:
            db.add(obj)
    """
    db: Session = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
