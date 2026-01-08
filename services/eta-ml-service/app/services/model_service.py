"""
ML Model Service for ETA Prediction

Handles model loading, prediction, and versioning.
Uses XGBoost for gradient boosting predictions.
"""

import time
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, Tuple
import numpy as np
import structlog

try:
    import xgboost as xgb
    import joblib
except ImportError:
    xgb = None
    joblib = None

from app.config import settings

logger = structlog.get_logger(__name__)


class ModelService:
    """ML model management and prediction"""
    
    # Feature names expected by model
    FEATURE_NAMES = [
        "straight_distance_km",
        "estimated_road_distance_km",
        "bearing_sin",
        "bearing_cos",
        "hour",
        "hour_sin",
        "hour_cos",
        "day_of_week",
        "day_sin",
        "day_cos",
        "is_weekend",
        "is_rush_hour_morning",
        "is_rush_hour_evening",
        "is_night",
        "is_holiday",
        "traffic_speed_ratio",
        "traffic_delay_minutes",
        "traffic_level_encoded",
        "traffic_incidents_count",
        "traffic_congestion_percent",
        "weather_condition_encoded",
        "is_raining",
        "precipitation_mm",
        "visibility_km",
        "is_cbd_origin",
        "is_cbd_dest",
        "crosses_cbd",
        "h3_distance",
        "vehicle_type_encoded",
        "is_bike",
        "driver_rating",
    ]
    
    def __init__(self, model_path: str):
        self.model_path = Path(model_path)
        self.model: Optional[xgb.XGBRegressor] = None
        self.model_version: str = settings.model_version
        self.loaded_at: Optional[datetime] = None
        self.prediction_count: int = 0
        self.avg_prediction_time_ms: float = 0
    
    async def load_model(self) -> bool:
        """Load the XGBoost model from disk"""
        
        if xgb is None or joblib is None:
            logger.warning("XGBoost or joblib not installed, using fallback")
            return False
        
        try:
            if self.model_path.exists():
                self.model = joblib.load(self.model_path)
                self.loaded_at = datetime.utcnow()
                logger.info(
                    "Model loaded successfully",
                    path=str(self.model_path),
                    version=self.model_version,
                )
                return True
            else:
                logger.warning(
                    "Model file not found, using fallback",
                    path=str(self.model_path),
                )
                return False
        except Exception as e:
            logger.error("Failed to load model", error=str(e))
            return False
    
    async def predict(
        self,
        features: Dict[str, Any],
    ) -> Tuple[float, float, float]:
        """
        Make ETA prediction with confidence interval
        
        Returns:
            Tuple of (eta_seconds, min_eta_seconds, max_eta_seconds)
        """
        
        start_time = time.perf_counter()
        
        if self.model is None:
            # Fallback to simple calculation
            return await self._fallback_prediction(features)
        
        try:
            # Prepare feature vector in correct order
            feature_vector = self._prepare_features(features)
            
            # Make prediction
            prediction = self.model.predict(np.array([feature_vector]))[0]
            eta_seconds = max(60, float(prediction))  # Minimum 1 minute
            
            # Calculate confidence interval (±10-20% based on conditions)
            uncertainty = self._calculate_uncertainty(features)
            min_eta = eta_seconds * (1 - uncertainty)
            max_eta = eta_seconds * (1 + uncertainty)
            
            # Update metrics
            elapsed_ms = (time.perf_counter() - start_time) * 1000
            self._update_prediction_metrics(elapsed_ms)
            
            return eta_seconds, min_eta, max_eta
            
        except Exception as e:
            logger.error("Prediction failed, using fallback", error=str(e))
            return await self._fallback_prediction(features)
    
    def _prepare_features(self, features: Dict[str, Any]) -> list:
        """Prepare feature vector in correct order"""
        
        vector = []
        for name in self.FEATURE_NAMES:
            value = features.get(name, 0)
            vector.append(float(value) if value is not None else 0.0)
        return vector
    
    def _calculate_uncertainty(self, features: Dict[str, Any]) -> float:
        """Calculate prediction uncertainty based on conditions"""
        
        base_uncertainty = 0.10  # 10% base
        
        # Increase uncertainty for adverse conditions
        if features.get("is_raining", 0):
            base_uncertainty += 0.05
        
        if features.get("traffic_level_encoded", 0) >= 2:  # heavy traffic
            base_uncertainty += 0.08
        
        if features.get("is_rush_hour_morning", 0) or features.get("is_rush_hour_evening", 0):
            base_uncertainty += 0.05
        
        # Longer trips have more variability
        distance = features.get("estimated_road_distance_km", 0)
        if distance > 10:
            base_uncertainty += 0.05
        
        return min(0.30, base_uncertainty)  # Cap at 30%
    
    async def _fallback_prediction(
        self,
        features: Dict[str, Any],
    ) -> Tuple[float, float, float]:
        """Simple ETA calculation as fallback"""
        
        # Average speed assumptions (km/h)
        BASE_SPEED = 25  # Urban average
        
        distance_km = features.get("estimated_road_distance_km", 5)
        
        # Adjust for traffic
        traffic_level = features.get("traffic_level_encoded", 1)
        traffic_multipliers = {0: 1.0, 1: 1.3, 2: 1.8, 3: 2.5}
        traffic_mult = traffic_multipliers.get(traffic_level, 1.3)
        
        # Adjust for time of day
        time_mult = 1.0
        if features.get("is_rush_hour_morning") or features.get("is_rush_hour_evening"):
            time_mult = 1.4
        elif features.get("is_night"):
            time_mult = 0.8
        
        # Calculate ETA
        effective_speed = BASE_SPEED / (traffic_mult * time_mult)
        eta_hours = distance_km / effective_speed
        eta_seconds = eta_hours * 3600
        
        # Confidence interval (wider for fallback)
        uncertainty = 0.25
        min_eta = eta_seconds * (1 - uncertainty)
        max_eta = eta_seconds * (1 + uncertainty)
        
        return max(60, eta_seconds), max(60, min_eta), max_eta
    
    def _update_prediction_metrics(self, elapsed_ms: float):
        """Update rolling average prediction time"""
        
        self.prediction_count += 1
        alpha = 0.1  # Exponential moving average
        self.avg_prediction_time_ms = (
            alpha * elapsed_ms + (1 - alpha) * self.avg_prediction_time_ms
        )
    
    async def get_model_info(self) -> Dict[str, Any]:
        """Get current model information"""
        
        return {
            "version": self.model_version,
            "loaded": self.model is not None,
            "loaded_at": self.loaded_at.isoformat() if self.loaded_at else None,
            "path": str(self.model_path),
            "prediction_count": self.prediction_count,
            "avg_prediction_time_ms": round(self.avg_prediction_time_ms, 2),
            "feature_count": len(self.FEATURE_NAMES),
        }
    
    async def reload_model(self) -> bool:
        """Reload model from disk (for hot reloading)"""
        
        logger.info("Reloading model...")
        return await self.load_model()


class SimpleFallbackCalculator:
    """Simple ETA calculator for comparison and fallback"""
    
    # Average speeds by vehicle type (km/h)
    SPEEDS = {
        "economy": 22,
        "standard": 25,
        "premium": 25,
        "xl": 23,
        "bike": 30,
    }
    
    @classmethod
    def calculate_eta(
        cls,
        distance_km: float,
        vehicle_type: str = "standard",
        traffic_multiplier: float = 1.0,
    ) -> float:
        """Calculate simple ETA in seconds"""
        
        base_speed = cls.SPEEDS.get(vehicle_type.lower(), 25)
        effective_speed = base_speed / traffic_multiplier
        eta_hours = distance_km / effective_speed
        return max(60, eta_hours * 3600)  # Minimum 1 minute
