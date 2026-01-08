"""
Pydantic models for ETA predictions
"""

from datetime import datetime
from typing import Optional, List, Any
from pydantic import BaseModel, Field
from enum import Enum


class TrafficLevel(str, Enum):
    """Traffic intensity levels"""
    LOW = "low"
    MODERATE = "moderate"
    HEAVY = "heavy"
    SEVERE = "severe"


class WeatherCondition(str, Enum):
    """Weather condition types"""
    CLEAR = "clear"
    CLOUDY = "cloudy"
    RAIN = "rain"
    HEAVY_RAIN = "heavy_rain"
    STORM = "storm"


class PredictionMethod(str, Enum):
    """Prediction method used"""
    ML_MODEL = "ml_model"
    SIMPLE_CALCULATION = "simple_calculation"


class Location(BaseModel):
    """Geographic coordinate"""
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    
    class Config:
        json_schema_extra = {
            "example": {"latitude": -1.2921, "longitude": 36.8219}
        }


# Alias for backwards compatibility
LatLng = Location


class ETAPredictionRequest(BaseModel):
    """Request for ETA prediction"""
    request_id: Optional[str] = None
    pickup_location: Location
    dropoff_location: Location
    requested_time: Optional[datetime] = None  # Defaults to now
    vehicle_type: Optional[str] = "standard"
    driver_id: Optional[str] = None
    driver_rating: Optional[float] = None
    trip_id: Optional[str] = None
    include_confidence: bool = True
    experiment_id: Optional[str] = None  # For A/B testing
    
    # Aliases for compatibility
    @property
    def origin(self) -> Location:
        return self.pickup_location
    
    @property
    def destination(self) -> Location:
        return self.dropoff_location
    
    class Config:
        json_schema_extra = {
            "example": {
                "pickup_location": {"latitude": -1.2921, "longitude": 36.8219},
                "dropoff_location": {"latitude": -1.2864, "longitude": 36.8172},
                "vehicle_type": "standard",
                "include_confidence": True,
            }
        }


class ConfidenceInterval(BaseModel):
    """ETA confidence interval"""
    lower_bound_minutes: float = Field(..., description="Optimistic ETA in minutes")
    upper_bound_minutes: float = Field(..., description="Pessimistic ETA in minutes")
    confidence_level: float = Field(0.9, description="Probability ETA falls in interval")


class ETAPredictionResponse(BaseModel):
    """Response for ETA prediction"""
    request_id: Optional[str] = None
    eta_seconds: int = Field(..., description="Predicted ETA in seconds")
    eta_minutes: float = Field(..., description="Predicted ETA in minutes")
    confidence_interval: Optional[ConfidenceInterval] = None
    display_text: str = Field(..., description="User-friendly ETA text")
    prediction_method: PredictionMethod
    model_version: Optional[str] = None
    factors: Optional[dict[str, Any]] = None
    timestamp: datetime
    cached: bool = False
    
    class Config:
        json_schema_extra = {
            "example": {
                "eta_seconds": 540,
                "eta_minutes": 9.0,
                "confidence_interval": {
                    "lower_bound_minutes": 8.0,
                    "upper_bound_minutes": 10.0,
                    "confidence_level": 0.9,
                },
                "display_text": "Arriving in 8-10 min",
                "prediction_method": "ml_model",
                "model_version": "v1.0.0",
                "timestamp": "2024-01-15T10:30:00Z",
                "cached": False,
            }
        }


class TripUpdateRequest(BaseModel):
    """Real-time trip ETA update request"""
    trip_id: str
    driver_id: str
    current_location: LatLng
    destination: LatLng
    elapsed_seconds: int = Field(..., description="Time since trip started")
    remaining_distance_meters: Optional[float] = None


class TripUpdateResponse(BaseModel):
    """Real-time ETA update during trip"""
    trip_id: str
    updated_eta_seconds: int
    confidence: Optional[ConfidenceInterval] = None
    traffic_level: TrafficLevel
    delay_seconds: Optional[int] = Field(None, description="Delay vs original ETA")
    display_text: str
    next_update_in_seconds: int = Field(30, description="Suggested refresh interval")


class TripCompletionRecord(BaseModel):
    """Record actual trip completion for model training"""
    trip_id: str
    driver_id: Optional[str] = None
    pickup_location: Location
    dropoff_location: Location
    predicted_duration_seconds: int
    actual_duration_seconds: int
    distance_meters: Optional[float] = None
    start_time: datetime
    end_time: datetime
    vehicle_type: str = "standard"
    weather_conditions: Optional[dict] = None
    traffic_conditions: Optional[dict] = None
    driver_rating: Optional[float] = None
    
    @property
    def prediction_error_seconds(self) -> int:
        """Absolute error in seconds"""
        return abs(self.actual_duration_seconds - self.predicted_duration_seconds)
    
    @property
    def prediction_error_percent(self) -> float:
        """Percentage error"""
        if self.actual_duration_seconds == 0:
            return 0
        return (self.prediction_error_seconds / self.actual_duration_seconds) * 100


class ModelMetrics(BaseModel):
    """ML model performance metrics"""
    model_version: str
    accuracy_within_3min: float = Field(..., description="% predictions within ±3 min")
    accuracy_within_5min: float = Field(..., description="% predictions within ±5 min")
    mean_absolute_error_seconds: float
    mean_absolute_error_minutes: float
    r2_score: Optional[float] = None
    total_predictions: int
    feature_importance: Optional[dict[str, float]] = None
    trained_at: Optional[datetime] = None
    training_samples: int = 0


class ExperimentConfig(BaseModel):
    """A/B test configuration"""
    experiment_id: Optional[str] = None
    name: str
    description: Optional[str] = None
    traffic_percentage: int = Field(50, ge=0, le=100, description="% using ML model")
    start_time: datetime = Field(default_factory=datetime.utcnow)
    end_time: Optional[datetime] = None
    status: str = "active"


class ExperimentResult(BaseModel):
    """A/B test results"""
    experiment_id: str
    status: str
    start_time: datetime
    end_time: Optional[datetime]
    control_group: dict
    treatment_group: dict
    improvement_percent: float
    is_statistically_significant: bool
    recommendation: str
