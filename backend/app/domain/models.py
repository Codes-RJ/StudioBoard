import uuid
import datetime
from sqlalchemy import (
    Column,
    String,
    Text,
    JSON,
    Integer,
    DateTime,
    ForeignKey,
    Index
)
from sqlalchemy.orm import relationship
from app.core.database import Base


def generate_cuid_like_id() -> str:
    """Generates a unique ID compatible with CUID/UUID strings."""
    return f"c{uuid.uuid4().hex[:24]}"


def utc_now() -> datetime.datetime:
    """Generates timezone-aware current UTC datetime."""
    return datetime.datetime.now(datetime.timezone.utc)


class User(Base):
    __tablename__ = "User"

    id = Column(String(191), primary_key=True, default=generate_cuid_like_id)
    email = Column(String(191), unique=True, nullable=False, index=True)
    password = Column(String(191), nullable=False)
    name = Column(String(191), nullable=True)
    role = Column(String(50), default="USER", nullable=False)
    tokenVersion = Column(Integer, default=0, nullable=False)
    createdAt = Column(DateTime(timezone=True), default=utc_now, nullable=False)
    updatedAt = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    datasets = relationship("Dataset", back_populates="user", cascade="all, delete-orphan")
    dashboardLayouts = relationship("DashboardLayout", back_populates="user", cascade="all, delete-orphan")
    logs = relationship("Log", back_populates="user", cascade="all, delete-orphan")


class Dataset(Base):
    __tablename__ = "Dataset"
    __table_args__ = (
        Index("ix_dataset_user_created", "userId", "createdAt"),
    )

    id = Column(String(191), primary_key=True, default=generate_cuid_like_id)
    name = Column(String(191), nullable=False)
    description = Column(String(1000), nullable=True)
    fileName = Column(String(191), nullable=False)
    filePath = Column(String(500), nullable=False)
    fileSize = Column(Integer, default=0, nullable=False)
    mimeType = Column(String(191), nullable=True)
    checksum = Column(String(64), nullable=True, index=True)
    rowCount = Column(Integer, default=0, nullable=False)
    columns = Column(JSON, nullable=False)
    createdAt = Column(DateTime(timezone=True), default=utc_now, nullable=False, index=True)
    updatedAt = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)
    userId = Column(String(191), ForeignKey("User.id", ondelete="CASCADE"), nullable=False, index=True)

    user = relationship("User", back_populates="datasets")
    logs = relationship("Log", back_populates="dataset")
    analyticsJobs = relationship("AnalyticsJob", back_populates="dataset")


class DashboardLayout(Base):
    __tablename__ = "DashboardLayout"
    __table_args__ = (
        Index("ix_dashboard_layout_user_created", "userId", "createdAt"),
    )

    id = Column(String(191), primary_key=True, default=generate_cuid_like_id)
    name = Column(String(191), nullable=False)
    layout = Column(JSON, nullable=False)
    version = Column(Integer, default=1, nullable=False)
    createdAt = Column(DateTime(timezone=True), default=utc_now, nullable=False)
    updatedAt = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)
    userId = Column(String(191), ForeignKey("User.id", ondelete="CASCADE"), nullable=False, index=True)

    user = relationship("User", back_populates="dashboardLayouts")


class Log(Base):
    __tablename__ = "Log"

    id = Column(String(191), primary_key=True, default=generate_cuid_like_id)
    action = Column(String(191), nullable=False)
    details = Column(JSON, nullable=True)
    createdAt = Column(DateTime(timezone=True), default=utc_now, nullable=False, index=True)
    userId = Column(String(191), ForeignKey("User.id", ondelete="CASCADE"), nullable=True, index=True)
    datasetId = Column(String(191), ForeignKey("Dataset.id", ondelete="SET NULL"), nullable=True, index=True)

    user = relationship("User", back_populates="logs")
    dataset = relationship("Dataset", back_populates="logs")


class SiteConfig(Base):
    __tablename__ = "SiteConfig"

    id = Column(String(191), primary_key=True, default=generate_cuid_like_id)
    key = Column(String(191), unique=True, nullable=False, index=True)
    value = Column(JSON, nullable=False)
    updatedAt = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class AnalyticsJob(Base):
    """Durable work item executed by the standalone analytics worker."""

    __tablename__ = "AnalyticsJob"
    __table_args__ = (
        Index("ix_analytics_job_status_created", "status", "createdAt"),
        Index("ix_analytics_job_user_created", "userId", "createdAt"),
    )

    id = Column(String(191), primary_key=True, default=generate_cuid_like_id)
    kind = Column(String(32), nullable=False)  # ANALYTICS or EXPORT
    strategy = Column(String(64), nullable=False)
    status = Column(String(32), nullable=False, default="QUEUED")
    parameters = Column(JSON, nullable=False)
    result = Column(JSON, nullable=True)
    error = Column(String(1000), nullable=True)
    outputPath = Column(String(500), nullable=True)
    outputMimeType = Column(String(191), nullable=True)
    attempts = Column(Integer, nullable=False, default=0)
    createdAt = Column(DateTime(timezone=True), default=utc_now, nullable=False, index=True)
    updatedAt = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)
    startedAt = Column(DateTime(timezone=True), nullable=True)
    leaseExpiresAt = Column(DateTime(timezone=True), nullable=True)
    completedAt = Column(DateTime(timezone=True), nullable=True)
    userId = Column(String(191), ForeignKey("User.id", ondelete="CASCADE"), nullable=False, index=True)
    datasetId = Column(String(191), ForeignKey("Dataset.id", ondelete="SET NULL"), nullable=True, index=True)

    user = relationship("User")
    dataset = relationship("Dataset", back_populates="analyticsJobs")
