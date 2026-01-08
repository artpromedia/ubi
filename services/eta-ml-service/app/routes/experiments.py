"""
A/B Testing Routes - Experiment management for ETA predictions
"""

from datetime import datetime
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Depends
import structlog

from app.models.schemas import (
    ExperimentConfig,
    ExperimentResult,
    ETAPredictionRequest,
    ETAPredictionResponse,
    PredictionMethod,
)
from app.services.cache_service import CacheService


logger = structlog.get_logger(__name__)
router = APIRouter()


class ExperimentDependencies:
    """Dependency injection for experiment routes"""
    
    cache_service: Optional[CacheService] = None


deps = ExperimentDependencies()


def get_deps() -> ExperimentDependencies:
    """Get dependencies"""
    return deps


# In-memory experiment registry
_active_experiments: dict[str, ExperimentConfig] = {}


@router.post("/experiments", response_model=ExperimentConfig)
async def create_experiment(
    config: ExperimentConfig,
    dependencies: ExperimentDependencies = Depends(get_deps),
) -> ExperimentConfig:
    """
    Create a new A/B test experiment.
    
    Experiments compare ML predictions vs simple calculations.
    """
    
    # Generate ID if not provided
    if not config.experiment_id:
        config.experiment_id = f"exp_{uuid4().hex[:8]}"
    
    # Validate
    if config.experiment_id in _active_experiments:
        raise HTTPException(status_code=400, detail="Experiment ID already exists")
    
    if config.traffic_percentage < 0 or config.traffic_percentage > 100:
        raise HTTPException(status_code=400, detail="Traffic percentage must be 0-100")
    
    # Store experiment
    _active_experiments[config.experiment_id] = config
    
    # Persist to cache
    if dependencies.cache_service:
        await dependencies.cache_service.set(
            f"experiment:{config.experiment_id}",
            config.model_dump(mode="json"),
            ttl=86400 * 30,  # 30 days
        )
    
    logger.info(
        "Experiment created",
        experiment_id=config.experiment_id,
        name=config.name,
        traffic_percentage=config.traffic_percentage,
    )
    
    return config


@router.get("/experiments", response_model=list[ExperimentConfig])
async def list_experiments() -> list[ExperimentConfig]:
    """List all active experiments"""
    
    return [
        exp for exp in _active_experiments.values()
        if exp.status == "active"
    ]


@router.get("/experiments/{experiment_id}", response_model=ExperimentConfig)
async def get_experiment(experiment_id: str) -> ExperimentConfig:
    """Get experiment by ID"""
    
    if experiment_id not in _active_experiments:
        raise HTTPException(status_code=404, detail="Experiment not found")
    
    return _active_experiments[experiment_id]


@router.post("/experiments/{experiment_id}/stop")
async def stop_experiment(
    experiment_id: str,
    dependencies: ExperimentDependencies = Depends(get_deps),
) -> dict:
    """Stop an active experiment"""
    
    if experiment_id not in _active_experiments:
        raise HTTPException(status_code=404, detail="Experiment not found")
    
    experiment = _active_experiments[experiment_id]
    experiment.status = "stopped"
    experiment.end_time = datetime.utcnow()
    
    # Update cache
    if dependencies.cache_service:
        await dependencies.cache_service.set(
            f"experiment:{experiment_id}",
            experiment.model_dump(mode="json"),
            ttl=86400 * 30,
        )
    
    logger.info("Experiment stopped", experiment_id=experiment_id)
    
    return {"status": "stopped", "experiment_id": experiment_id}


@router.get("/experiments/{experiment_id}/results", response_model=ExperimentResult)
async def get_experiment_results(
    experiment_id: str,
    dependencies: ExperimentDependencies = Depends(get_deps),
) -> ExperimentResult:
    """
    Get results for an experiment.
    
    Compares ML model vs simple calculation accuracy.
    """
    
    if experiment_id not in _active_experiments:
        raise HTTPException(status_code=404, detail="Experiment not found")
    
    experiment = _active_experiments[experiment_id]
    
    # Get metrics from cache
    ml_total = 0
    ml_within_3min = 0
    simple_total = 0
    simple_within_3min = 0
    
    if dependencies.cache_service:
        ml_total = await dependencies.cache_service.get(f"exp:{experiment_id}:ml:total") or 0
        ml_within_3min = await dependencies.cache_service.get(f"exp:{experiment_id}:ml:within_3min") or 0
        simple_total = await dependencies.cache_service.get(f"exp:{experiment_id}:simple:total") or 0
        simple_within_3min = await dependencies.cache_service.get(f"exp:{experiment_id}:simple:within_3min") or 0
    
    # Calculate accuracies
    ml_accuracy = (ml_within_3min / ml_total * 100) if ml_total > 0 else 0
    simple_accuracy = (simple_within_3min / simple_total * 100) if simple_total > 0 else 0
    
    # Calculate improvement
    improvement = ml_accuracy - simple_accuracy if ml_accuracy > 0 and simple_accuracy > 0 else 0
    
    # Statistical significance (simplified)
    # Would use proper statistical test in production
    min_samples = 100
    is_significant = ml_total >= min_samples and simple_total >= min_samples
    
    result = ExperimentResult(
        experiment_id=experiment_id,
        status=experiment.status,
        start_time=experiment.start_time,
        end_time=experiment.end_time,
        control_group={
            "name": "simple_calculation",
            "sample_size": simple_total,
            "accuracy_within_3min": round(simple_accuracy, 2),
            "mean_error_minutes": None,  # Would calculate from stored data
        },
        treatment_group={
            "name": "ml_model",
            "sample_size": ml_total,
            "accuracy_within_3min": round(ml_accuracy, 2),
            "mean_error_minutes": None,
        },
        improvement_percent=round(improvement, 2),
        is_statistically_significant=is_significant,
        recommendation=_generate_recommendation(improvement, is_significant, ml_total + simple_total),
    )
    
    return result


@router.post("/experiments/{experiment_id}/record")
async def record_experiment_result(
    experiment_id: str,
    method: PredictionMethod,
    actual_seconds: float,
    predicted_seconds: float,
    dependencies: ExperimentDependencies = Depends(get_deps),
) -> dict:
    """Record a prediction result for an experiment"""
    
    if experiment_id not in _active_experiments:
        raise HTTPException(status_code=404, detail="Experiment not found")
    
    error_seconds = abs(actual_seconds - predicted_seconds)
    error_minutes = error_seconds / 60
    within_3min = error_minutes <= 3
    
    if dependencies.cache_service:
        prefix = f"exp:{experiment_id}:{method.value}"
        
        await dependencies.cache_service.increment(f"{prefix}:total")
        if within_3min:
            await dependencies.cache_service.increment(f"{prefix}:within_3min")
    
    return {
        "recorded": True,
        "method": method.value,
        "error_minutes": round(error_minutes, 2),
        "within_3min": within_3min,
    }


def _generate_recommendation(improvement: float, is_significant: bool, sample_size: int) -> str:
    """Generate recommendation based on experiment results"""
    
    if sample_size < 200:
        return "Insufficient data. Continue running experiment to reach minimum 100 samples per group."
    
    if not is_significant:
        return "Results not yet statistically significant. Continue running experiment."
    
    if improvement >= 20:
        return f"ML model shows {improvement:.1f}% improvement. Recommend rolling out to 100% of traffic."
    elif improvement >= 10:
        return f"ML model shows {improvement:.1f}% improvement. Consider gradual rollout."
    elif improvement >= 0:
        return f"ML model shows minimal improvement ({improvement:.1f}%). Further optimization may be needed."
    else:
        return f"ML model performs worse than simple calculation by {abs(improvement):.1f}%. Do not deploy."


async def get_experiment_assignment(user_id: str, experiment_id: str) -> Optional[str]:
    """
    Determine which experiment group a user belongs to.
    Uses consistent hashing for stable assignment.
    """
    
    if experiment_id not in _active_experiments:
        return None
    
    experiment = _active_experiments[experiment_id]
    
    if experiment.status != "active":
        return None
    
    # Simple hash-based assignment
    hash_value = hash(f"{user_id}:{experiment_id}") % 100
    
    if hash_value < experiment.traffic_percentage:
        return "treatment"  # ML model
    else:
        return "control"  # Simple calculation
