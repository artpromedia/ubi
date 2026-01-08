"""
Health Check Routes
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter
import structlog

from app.services.model_service import ModelService
from app.services.cache_service import CacheService


logger = structlog.get_logger(__name__)
router = APIRouter()


class HealthDependencies:
    """Dependency injection for health routes"""
    
    model_service: Optional[ModelService] = None
    cache_service: Optional[CacheService] = None
    start_time: Optional[datetime] = None


deps = HealthDependencies()


@router.get("/health")
async def health_check() -> dict:
    """Basic health check"""
    
    return {
        "status": "healthy",
        "service": "eta-ml-service",
        "timestamp": datetime.utcnow().isoformat(),
    }


@router.get("/health/ready")
async def readiness_check() -> dict:
    """
    Readiness check - verifies service can accept requests.
    Checks model availability and cache connectivity.
    """
    
    checks = {
        "model_loaded": False,
        "cache_connected": False,
    }
    
    # Check model
    if deps.model_service:
        checks["model_loaded"] = deps.model_service.is_ready()
        if checks["model_loaded"]:
            checks["model_version"] = deps.model_service.get_model_version()
    
    # Check cache
    if deps.cache_service:
        try:
            await deps.cache_service.set("health:check", "ok", ttl=10)
            result = await deps.cache_service.get("health:check")
            checks["cache_connected"] = result == "ok"
        except Exception:
            checks["cache_connected"] = False
    
    # Overall status
    # Service can work without ML model (falls back to simple calculation)
    is_ready = checks["cache_connected"] or checks["model_loaded"]
    
    return {
        "status": "ready" if is_ready else "not_ready",
        "checks": checks,
        "timestamp": datetime.utcnow().isoformat(),
    }


@router.get("/health/live")
async def liveness_check() -> dict:
    """Liveness check - verifies service is running"""
    
    uptime_seconds = 0
    if deps.start_time:
        uptime_seconds = (datetime.utcnow() - deps.start_time).total_seconds()
    
    return {
        "status": "alive",
        "uptime_seconds": int(uptime_seconds),
        "timestamp": datetime.utcnow().isoformat(),
    }


@router.get("/health/detailed")
async def detailed_health() -> dict:
    """Detailed health information"""
    
    details = {
        "service": "eta-ml-service",
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "uptime_seconds": 0,
        "components": {
            "ml_model": {
                "status": "unknown",
                "version": None,
                "features_count": None,
            },
            "cache": {
                "status": "unknown",
            },
        },
    }
    
    if deps.start_time:
        details["uptime_seconds"] = int((datetime.utcnow() - deps.start_time).total_seconds())
    
    # Model details
    if deps.model_service:
        if deps.model_service.is_ready():
            details["components"]["ml_model"] = {
                "status": "loaded",
                "version": deps.model_service.get_model_version(),
                "features_count": len(deps.model_service.feature_names) if hasattr(deps.model_service, "feature_names") else None,
            }
        else:
            details["components"]["ml_model"]["status"] = "not_loaded"
    
    # Cache details
    if deps.cache_service:
        try:
            await deps.cache_service.set("health:ping", "pong", ttl=5)
            details["components"]["cache"]["status"] = "connected"
        except Exception as e:
            details["components"]["cache"]["status"] = f"error: {str(e)}"
    
    return details
