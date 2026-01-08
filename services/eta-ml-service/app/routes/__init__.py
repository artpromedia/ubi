"""
ETA ML Service - Route exports
"""

from app.routes.predictions import router as predictions_router
from app.routes.health import router as health_router
from app.routes.experiments import router as experiments_router
from app.routes.training import router as training_router

__all__ = [
    "predictions_router",
    "health_router",
    "experiments_router",
    "training_router",
]
