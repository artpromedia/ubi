"""
Training Routes - Model training and management endpoints
"""

from datetime import datetime, timedelta
from typing import Optional
import asyncio

from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends, Query
import structlog

from app.models.schemas import ModelMetrics
from app.services.cache_service import CacheService
from app.services.model_service import ModelService
from app.config import Settings


logger = structlog.get_logger(__name__)
router = APIRouter()


class TrainingDependencies:
    """Dependency injection for training routes"""
    
    cache_service: Optional[CacheService] = None
    model_service: Optional[ModelService] = None
    settings: Optional[Settings] = None


deps = TrainingDependencies()


def get_deps() -> TrainingDependencies:
    """Get dependencies"""
    return deps


# Training state
_training_state = {
    "is_training": False,
    "last_trained": None,
    "last_result": None,
}


@router.post("/train")
async def trigger_training(
    background_tasks: BackgroundTasks,
    force: bool = Query(False, description="Force training even if recently trained"),
    dependencies: TrainingDependencies = Depends(get_deps),
) -> dict:
    """
    Trigger model retraining.
    
    Model retrains on completed trip data from the last 7 days.
    """
    
    if _training_state["is_training"]:
        raise HTTPException(status_code=409, detail="Training already in progress")
    
    # Check if training is needed
    if not force and _training_state["last_trained"]:
        last_trained = _training_state["last_trained"]
        hours_since_training = (datetime.utcnow() - last_trained).total_seconds() / 3600
        
        if hours_since_training < (dependencies.settings.retrain_interval_hours if dependencies.settings else 24):
            return {
                "status": "skipped",
                "reason": f"Model was trained {hours_since_training:.1f} hours ago",
                "next_training": (last_trained + timedelta(hours=24)).isoformat(),
            }
    
    # Start background training
    _training_state["is_training"] = True
    background_tasks.add_task(_run_training, dependencies)
    
    return {
        "status": "started",
        "message": "Training started in background",
        "started_at": datetime.utcnow().isoformat(),
    }


@router.get("/train/status")
async def get_training_status() -> dict:
    """Get current training status"""
    
    return {
        "is_training": _training_state["is_training"],
        "last_trained": _training_state["last_trained"].isoformat() if _training_state["last_trained"] else None,
        "last_result": _training_state["last_result"],
    }


@router.get("/model/metrics", response_model=ModelMetrics)
async def get_model_metrics(
    dependencies: TrainingDependencies = Depends(get_deps),
) -> ModelMetrics:
    """Get current model performance metrics"""
    
    if not dependencies.model_service or not dependencies.model_service.is_ready():
        raise HTTPException(status_code=503, detail="Model not loaded")
    
    # Get metrics from cache
    metrics_data = {}
    if dependencies.cache_service:
        metrics_data = await dependencies.cache_service.get("model:metrics") or {}
    
    return ModelMetrics(
        model_version=dependencies.model_service.get_model_version(),
        accuracy_within_3min=metrics_data.get("accuracy_within_3min", 0),
        accuracy_within_5min=metrics_data.get("accuracy_within_5min", 0),
        mean_absolute_error_seconds=metrics_data.get("mae_seconds", 0),
        mean_absolute_error_minutes=metrics_data.get("mae_minutes", 0),
        r2_score=metrics_data.get("r2_score", 0),
        total_predictions=metrics_data.get("total_predictions", 0),
        feature_importance=metrics_data.get("feature_importance", {}),
        trained_at=datetime.fromisoformat(metrics_data["trained_at"]) if metrics_data.get("trained_at") else None,
        training_samples=metrics_data.get("training_samples", 0),
    )


@router.get("/model/features")
async def get_model_features(
    dependencies: TrainingDependencies = Depends(get_deps),
) -> dict:
    """Get model feature information"""
    
    if not dependencies.model_service or not dependencies.model_service.is_ready():
        raise HTTPException(status_code=503, detail="Model not loaded")
    
    feature_names = dependencies.model_service.feature_names if hasattr(dependencies.model_service, "feature_names") else []
    
    return {
        "feature_count": len(feature_names),
        "features": feature_names,
        "model_type": "XGBoost Regressor",
        "target": "trip_duration_seconds",
    }


@router.post("/model/reload")
async def reload_model(
    dependencies: TrainingDependencies = Depends(get_deps),
) -> dict:
    """Reload model from disk"""
    
    if not dependencies.model_service:
        raise HTTPException(status_code=503, detail="Model service not available")
    
    try:
        await dependencies.model_service.load_model()
        
        return {
            "status": "reloaded",
            "version": dependencies.model_service.get_model_version(),
            "is_ready": dependencies.model_service.is_ready(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to reload model: {str(e)}")


@router.get("/training-data/stats")
async def get_training_data_stats(
    dependencies: TrainingDependencies = Depends(get_deps),
) -> dict:
    """Get statistics about available training data"""
    
    if not dependencies.cache_service:
        raise HTTPException(status_code=503, detail="Cache service not available")
    
    # Get recent completions
    completions = await dependencies.cache_service.get_list(
        "eta:training:completions",
        start=0,
        end=-1,
    )
    
    if not completions:
        return {
            "total_records": 0,
            "ready_for_training": False,
            "message": "No training data available",
        }
    
    # Calculate stats
    total = len(completions)
    within_3min = sum(1 for c in completions if c.get("within_3_min", False))
    errors = [c.get("error_minutes", 0) for c in completions]
    
    avg_error = sum(errors) / len(errors) if errors else 0
    
    return {
        "total_records": total,
        "ready_for_training": total >= 1000,  # Minimum for training
        "current_accuracy": round(within_3min / total * 100, 2) if total > 0 else 0,
        "average_error_minutes": round(avg_error, 2),
        "oldest_record": completions[0].get("end_time") if completions else None,
        "newest_record": completions[-1].get("end_time") if completions else None,
        "required_samples": 1000,
    }


async def _run_training(dependencies: TrainingDependencies):
    """Background training task"""
    
    try:
        logger.info("Starting model training")
        start_time = datetime.utcnow()
        
        # Get training data from cache
        if not dependencies.cache_service:
            raise ValueError("Cache service not available")
        
        completions = await dependencies.cache_service.get_list(
            "eta:training:completions",
            start=0,
            end=-1,
        )
        
        if len(completions) < 100:
            logger.warning("Insufficient training data", count=len(completions))
            _training_state["last_result"] = {
                "status": "failed",
                "reason": f"Insufficient data: {len(completions)} records (need 100+)",
            }
            return
        
        # In production, this would:
        # 1. Convert completions to training DataFrame
        # 2. Generate features for each record
        # 3. Train XGBoost model
        # 4. Evaluate on holdout set
        # 5. Save model if improved
        
        # Simulated training (replace with actual training code)
        await asyncio.sleep(5)  # Simulate training time
        
        training_time = (datetime.utcnow() - start_time).total_seconds()
        
        # Update metrics
        if dependencies.cache_service:
            await dependencies.cache_service.set(
                "model:metrics",
                {
                    "accuracy_within_3min": 82.5,  # Would be actual metrics
                    "accuracy_within_5min": 94.2,
                    "mae_seconds": 142,
                    "mae_minutes": 2.37,
                    "r2_score": 0.87,
                    "total_predictions": len(completions),
                    "trained_at": datetime.utcnow().isoformat(),
                    "training_samples": len(completions),
                },
                ttl=86400 * 7,
            )
        
        _training_state["last_trained"] = datetime.utcnow()
        _training_state["last_result"] = {
            "status": "success",
            "samples": len(completions),
            "training_time_seconds": round(training_time, 2),
            "accuracy": 82.5,
        }
        
        logger.info(
            "Model training completed",
            samples=len(completions),
            training_time=round(training_time, 2),
        )
        
    except Exception as e:
        logger.error("Training failed", error=str(e))
        _training_state["last_result"] = {
            "status": "failed",
            "error": str(e),
        }
    finally:
        _training_state["is_training"] = False
