"""
ETA Prediction Routes - Main prediction endpoint
"""

from datetime import datetime
from typing import Optional
import time

from fastapi import APIRouter, HTTPException, Depends, Query
import structlog

from app.models.schemas import (
    ETAPredictionRequest,
    ETAPredictionResponse,
    ConfidenceInterval,
    Location,
    TripCompletionRecord,
    PredictionMethod,
)
from app.services.feature_service import FeatureService
from app.services.model_service import ModelService
from app.services.traffic_service import TrafficService
from app.services.weather_service import WeatherService
from app.services.cache_service import CacheService
from app.config import Settings
from app.metrics import (
    PREDICTION_LATENCY,
    PREDICTION_COUNT,
    PREDICTION_ERRORS,
    FEATURE_GENERATION_LATENCY,
)


logger = structlog.get_logger(__name__)
router = APIRouter()


class PredictionDependencies:
    """Dependency injection for prediction routes"""
    
    feature_service: Optional[FeatureService] = None
    model_service: Optional[ModelService] = None
    traffic_service: Optional[TrafficService] = None
    weather_service: Optional[WeatherService] = None
    cache_service: Optional[CacheService] = None
    settings: Optional[Settings] = None


deps = PredictionDependencies()


def get_deps() -> PredictionDependencies:
    """Get dependencies"""
    return deps


@router.post("/predict", response_model=ETAPredictionResponse)
async def predict_eta(
    request: ETAPredictionRequest,
    dependencies: PredictionDependencies = Depends(get_deps),
) -> ETAPredictionResponse:
    """
    Predict ETA for a trip.
    
    Returns ML-powered prediction with confidence interval.
    Falls back to simple calculation if ML model unavailable.
    """
    
    start_time = time.time()
    
    try:
        # Generate cache key
        cache_key = _generate_cache_key(request)
        
        # Check cache (short TTL for dynamic data)
        if dependencies.cache_service:
            cached = await dependencies.cache_service.get(cache_key)
            if cached:
                logger.debug("Returning cached prediction", request_id=request.request_id)
                response = ETAPredictionResponse(**cached)
                response.cached = True
                PREDICTION_COUNT.labels(method="cached", status="success").inc()
                return response
        
        # Get real-time data
        traffic_data = None
        weather_data = None
        
        try:
            if dependencies.traffic_service:
                traffic_data = await dependencies.traffic_service.get_traffic_conditions(
                    request.pickup_location.latitude,
                    request.pickup_location.longitude,
                    request.dropoff_location.latitude,
                    request.dropoff_location.longitude,
                )
        except Exception as e:
            logger.warning("Traffic service error", error=str(e))
        
        try:
            if dependencies.weather_service:
                weather_data = await dependencies.weather_service.get_current_weather(
                    request.pickup_location.latitude,
                    request.pickup_location.longitude,
                )
        except Exception as e:
            logger.warning("Weather service error", error=str(e))
        
        # Generate features
        feature_start = time.time()
        
        if dependencies.feature_service:
            features = await dependencies.feature_service.generate_features(
                pickup=request.pickup_location,
                dropoff=request.dropoff_location,
                timestamp=request.requested_time or datetime.utcnow(),
                vehicle_type=request.vehicle_type or "standard",
                driver_rating=request.driver_rating,
                traffic_data=traffic_data,
                weather_data=weather_data,
            )
        else:
            features = {}
        
        FEATURE_GENERATION_LATENCY.observe(time.time() - feature_start)
        
        # Make prediction
        eta_seconds: float
        confidence_min: float
        confidence_max: float
        method: PredictionMethod
        model_version: Optional[str] = None
        
        if dependencies.model_service and dependencies.model_service.is_ready():
            # Use ML model
            eta_seconds, confidence_min, confidence_max = await dependencies.model_service.predict(
                features
            )
            method = PredictionMethod.ML_MODEL
            model_version = dependencies.model_service.get_model_version()
        else:
            # Fall back to simple calculation
            eta_seconds, confidence_min, confidence_max = _simple_eta_calculation(
                request.pickup_location,
                request.dropoff_location,
                traffic_data,
            )
            method = PredictionMethod.SIMPLE_CALCULATION
        
        # Convert to minutes
        eta_minutes = eta_seconds / 60
        eta_min_minutes = confidence_min / 60
        eta_max_minutes = confidence_max / 60
        
        # Build response
        response = ETAPredictionResponse(
            request_id=request.request_id,
            eta_seconds=int(eta_seconds),
            eta_minutes=round(eta_minutes, 1),
            confidence_interval=ConfidenceInterval(
                lower_bound_minutes=round(eta_min_minutes, 1),
                upper_bound_minutes=round(eta_max_minutes, 1),
                confidence_level=0.90,
            ),
            display_text=_format_display_text(eta_min_minutes, eta_max_minutes),
            prediction_method=method,
            model_version=model_version,
            factors={
                "traffic_level": traffic_data.get("congestion_level") if traffic_data else None,
                "weather_impact": weather_data.get("impact_multiplier") if weather_data else None,
                "distance_km": features.get("distance_km"),
                "is_rush_hour": features.get("is_rush_hour"),
            },
            timestamp=datetime.utcnow(),
            cached=False,
        )
        
        # Cache response (30s TTL for dynamic predictions)
        if dependencies.cache_service:
            await dependencies.cache_service.set(
                cache_key,
                response.model_dump(mode="json"),
                ttl=30,
            )
        
        # Record metrics
        latency = time.time() - start_time
        PREDICTION_LATENCY.observe(latency)
        PREDICTION_COUNT.labels(method=method.value, status="success").inc()
        
        logger.info(
            "ETA prediction completed",
            request_id=request.request_id,
            eta_minutes=response.eta_minutes,
            method=method.value,
            latency_ms=round(latency * 1000, 2),
        )
        
        return response
    
    except Exception as e:
        PREDICTION_ERRORS.labels(error_type=type(e).__name__).inc()
        logger.error("Prediction failed", error=str(e), request_id=request.request_id)
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")


@router.post("/batch-predict", response_model=list[ETAPredictionResponse])
async def batch_predict_eta(
    requests: list[ETAPredictionRequest],
    dependencies: PredictionDependencies = Depends(get_deps),
) -> list[ETAPredictionResponse]:
    """
    Batch ETA predictions for multiple trips.
    More efficient than individual calls.
    """
    
    if len(requests) > 50:
        raise HTTPException(status_code=400, detail="Maximum 50 predictions per batch")
    
    results = []
    for request in requests:
        try:
            result = await predict_eta(request, dependencies)
            results.append(result)
        except HTTPException:
            # Create error response
            results.append(ETAPredictionResponse(
                request_id=request.request_id,
                eta_seconds=0,
                eta_minutes=0,
                confidence_interval=ConfidenceInterval(
                    lower_bound_minutes=0,
                    upper_bound_minutes=0,
                    confidence_level=0,
                ),
                display_text="Unable to calculate ETA",
                prediction_method=PredictionMethod.SIMPLE_CALCULATION,
                timestamp=datetime.utcnow(),
                cached=False,
            ))
    
    return results


@router.post("/record-completion")
async def record_trip_completion(
    record: TripCompletionRecord,
    dependencies: PredictionDependencies = Depends(get_deps),
) -> dict:
    """
    Record actual trip completion for model training.
    Used to calculate prediction accuracy and retrain model.
    """
    
    # Calculate prediction error
    error_minutes = abs(record.actual_duration_seconds / 60 - record.predicted_duration_seconds / 60)
    within_3_min = error_minutes <= 3
    
    # Store for batch training
    if dependencies.cache_service:
        training_record = {
            "trip_id": record.trip_id,
            "pickup_lat": record.pickup_location.latitude,
            "pickup_lng": record.pickup_location.longitude,
            "dropoff_lat": record.dropoff_location.latitude,
            "dropoff_lng": record.dropoff_location.longitude,
            "vehicle_type": record.vehicle_type,
            "start_time": record.start_time.isoformat(),
            "end_time": record.end_time.isoformat(),
            "predicted_seconds": record.predicted_duration_seconds,
            "actual_seconds": record.actual_duration_seconds,
            "weather_conditions": record.weather_conditions,
            "traffic_conditions": record.traffic_conditions,
            "error_minutes": error_minutes,
            "within_3_min": within_3_min,
        }
        
        await dependencies.cache_service.push_list(
            "eta:training:completions",
            training_record,
            ttl=86400 * 7,  # 7 days
        )
        
        # Update accuracy metrics
        await dependencies.cache_service.increment("eta:metrics:total_predictions")
        if within_3_min:
            await dependencies.cache_service.increment("eta:metrics:within_3min")
    
    logger.info(
        "Trip completion recorded",
        trip_id=record.trip_id,
        error_minutes=round(error_minutes, 2),
        within_3_min=within_3_min,
    )
    
    return {
        "status": "recorded",
        "trip_id": record.trip_id,
        "error_minutes": round(error_minutes, 2),
        "within_3_min": within_3_min,
    }


@router.get("/accuracy")
async def get_accuracy_metrics(
    hours: int = Query(24, ge=1, le=168),
    dependencies: PredictionDependencies = Depends(get_deps),
) -> dict:
    """Get current prediction accuracy metrics"""
    
    if dependencies.cache_service:
        total = await dependencies.cache_service.get("eta:metrics:total_predictions") or 0
        within_3min = await dependencies.cache_service.get("eta:metrics:within_3min") or 0
        
        accuracy = (within_3min / total * 100) if total > 0 else 0
        
        return {
            "total_predictions": total,
            "within_3min_count": within_3min,
            "accuracy_percent": round(accuracy, 2),
            "target_accuracy": 80.0,
            "meets_target": accuracy >= 80.0,
            "period_hours": hours,
        }
    
    return {"error": "Metrics not available"}


def _generate_cache_key(request: ETAPredictionRequest) -> str:
    """Generate cache key for prediction request"""
    
    # Round coordinates to reduce cache misses for nearby locations
    pickup_lat = round(request.pickup_location.latitude, 4)
    pickup_lng = round(request.pickup_location.longitude, 4)
    dropoff_lat = round(request.dropoff_location.latitude, 4)
    dropoff_lng = round(request.dropoff_location.longitude, 4)
    
    # Include time bucket (5-minute intervals)
    time = request.requested_time or datetime.utcnow()
    time_bucket = time.replace(minute=time.minute // 5 * 5, second=0, microsecond=0)
    
    return f"eta:{pickup_lat},{pickup_lng}:{dropoff_lat},{dropoff_lng}:{time_bucket.isoformat()}"


def _simple_eta_calculation(
    pickup: Location,
    dropoff: Location,
    traffic_data: Optional[dict],
) -> tuple[float, float, float]:
    """Simple ETA calculation fallback"""
    
    from math import radians, sin, cos, sqrt, atan2
    
    # Haversine distance
    R = 6371  # Earth radius km
    lat1, lng1 = radians(pickup.latitude), radians(pickup.longitude)
    lat2, lng2 = radians(dropoff.latitude), radians(dropoff.longitude)
    
    dlat = lat2 - lat1
    dlng = lng2 - lng1
    
    a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlng/2)**2
    c = 2 * atan2(sqrt(a), sqrt(1-a))
    distance_km = R * c
    
    # Base speed assumption
    avg_speed_kmh = 25  # Nairobi average
    
    # Adjust for traffic
    if traffic_data:
        speed_ratio = traffic_data.get("speed_ratio", 1.0)
        avg_speed_kmh *= speed_ratio
    
    # Calculate ETA
    eta_hours = distance_km / max(avg_speed_kmh, 5)
    eta_seconds = eta_hours * 3600
    
    # Simple confidence interval (±20%)
    margin = eta_seconds * 0.2
    
    return eta_seconds, eta_seconds - margin, eta_seconds + margin


def _format_display_text(min_minutes: float, max_minutes: float) -> str:
    """Format user-friendly display text"""
    
    min_int = max(1, round(min_minutes))
    max_int = round(max_minutes)
    
    if max_int <= 2:
        return "Arriving in 1-2 min"
    elif max_int <= 5:
        return f"Arriving in {min_int}-{max_int} min"
    elif max_int <= 60:
        return f"Arriving in {min_int}-{max_int} min"
    else:
        min_hr = min_int // 60
        max_hr = (max_int + 30) // 60
        if min_hr == max_hr:
            return f"Arriving in about {min_hr} hour{'s' if min_hr > 1 else ''}"
        return f"Arriving in {min_hr}-{max_hr} hours"
