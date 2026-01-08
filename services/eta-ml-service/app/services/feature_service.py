"""
Feature Engineering for ETA Prediction

Extracts features from trip requests for ML model:
- Distance and route characteristics
- Temporal features (hour, day, holiday)
- Traffic conditions
- Weather impact
- Historical patterns
- Driver performance
"""

import math
from datetime import datetime, timezone
from typing import Optional, Dict, Any, Tuple
import h3
import pytz

from app.services.traffic_service import TrafficService
from app.services.weather_service import WeatherService
from app.models.schemas import LatLng, TrafficLevel


class FeatureService:
    """Feature engineering for ETA prediction"""
    
    # Kenya timezone for local time features
    TIMEZONE = pytz.timezone("Africa/Nairobi")
    
    # H3 resolution for location bucketing
    H3_RESOLUTION = 7  # ~1.2km hexagons
    
    def __init__(
        self,
        traffic_service: TrafficService,
        weather_service: WeatherService,
    ):
        self.traffic_service = traffic_service
        self.weather_service = weather_service
    
    async def extract_features(
        self,
        origin: LatLng,
        destination: LatLng,
        departure_time: datetime,
        vehicle_type: str = "standard",
        driver_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Extract all features for ETA prediction"""
        
        # Basic distance features
        distance_features = self._calculate_distance_features(origin, destination)
        
        # Temporal features
        temporal_features = self._extract_temporal_features(departure_time)
        
        # Traffic features (async)
        traffic_features = await self._extract_traffic_features(origin, destination)
        
        # Weather features (async)
        weather_features = await self._extract_weather_features(origin)
        
        # Location features
        location_features = self._extract_location_features(origin, destination)
        
        # Vehicle features
        vehicle_features = self._extract_vehicle_features(vehicle_type)
        
        # Driver features (if available)
        driver_features = await self._extract_driver_features(driver_id) if driver_id else {}
        
        # Combine all features
        features = {
            **distance_features,
            **temporal_features,
            **traffic_features,
            **weather_features,
            **location_features,
            **vehicle_features,
            **driver_features,
        }
        
        return features
    
    def _calculate_distance_features(
        self,
        origin: LatLng,
        destination: LatLng,
    ) -> Dict[str, float]:
        """Calculate distance-based features"""
        
        # Haversine distance (straight line)
        straight_distance = self._haversine_distance(
            origin.lat, origin.lng,
            destination.lat, destination.lng,
        )
        
        # Bearing/direction
        bearing = self._calculate_bearing(
            origin.lat, origin.lng,
            destination.lat, destination.lng,
        )
        
        # Estimated road distance (approx 1.3x straight line in urban areas)
        estimated_road_distance = straight_distance * 1.3
        
        return {
            "straight_distance_km": straight_distance / 1000,
            "estimated_road_distance_km": estimated_road_distance / 1000,
            "bearing": bearing,
            "bearing_sin": math.sin(math.radians(bearing)),
            "bearing_cos": math.cos(math.radians(bearing)),
        }
    
    def _extract_temporal_features(
        self,
        departure_time: datetime,
    ) -> Dict[str, Any]:
        """Extract time-based features"""
        
        # Convert to local timezone
        if departure_time.tzinfo is None:
            departure_time = departure_time.replace(tzinfo=timezone.utc)
        local_time = departure_time.astimezone(self.TIMEZONE)
        
        hour = local_time.hour
        day_of_week = local_time.weekday()  # 0=Monday, 6=Sunday
        
        return {
            "hour": hour,
            "hour_sin": math.sin(2 * math.pi * hour / 24),
            "hour_cos": math.cos(2 * math.pi * hour / 24),
            "day_of_week": day_of_week,
            "day_sin": math.sin(2 * math.pi * day_of_week / 7),
            "day_cos": math.cos(2 * math.pi * day_of_week / 7),
            "is_weekend": 1 if day_of_week >= 5 else 0,
            "is_rush_hour_morning": 1 if 7 <= hour <= 9 else 0,
            "is_rush_hour_evening": 1 if 17 <= hour <= 19 else 0,
            "is_night": 1 if hour < 6 or hour > 22 else 0,
            "is_holiday": self._is_holiday(local_time),
            "month": local_time.month,
            "day_of_month": local_time.day,
        }
    
    async def _extract_traffic_features(
        self,
        origin: LatLng,
        destination: LatLng,
    ) -> Dict[str, Any]:
        """Extract real-time traffic features"""
        
        try:
            traffic_data = await self.traffic_service.get_traffic_conditions(
                origin, destination
            )
            
            return {
                "traffic_speed_ratio": traffic_data.get("speed_ratio", 1.0),
                "traffic_delay_minutes": traffic_data.get("delay_minutes", 0),
                "traffic_level_encoded": self._encode_traffic_level(
                    traffic_data.get("level", "moderate")
                ),
                "traffic_incidents_count": traffic_data.get("incidents", 0),
                "traffic_congestion_percent": traffic_data.get("congestion", 0),
            }
        except Exception:
            # Default values if traffic service unavailable
            return {
                "traffic_speed_ratio": 1.0,
                "traffic_delay_minutes": 0,
                "traffic_level_encoded": 1,  # moderate
                "traffic_incidents_count": 0,
                "traffic_congestion_percent": 0,
            }
    
    async def _extract_weather_features(
        self,
        location: LatLng,
    ) -> Dict[str, Any]:
        """Extract weather features"""
        
        try:
            weather_data = await self.weather_service.get_current_weather(location)
            
            return {
                "weather_condition_encoded": self._encode_weather(
                    weather_data.get("condition", "clear")
                ),
                "is_raining": 1 if "rain" in weather_data.get("condition", "").lower() else 0,
                "precipitation_mm": weather_data.get("precipitation", 0),
                "visibility_km": weather_data.get("visibility", 10),
                "temperature_c": weather_data.get("temperature", 25),
            }
        except Exception:
            # Default values if weather service unavailable
            return {
                "weather_condition_encoded": 0,  # clear
                "is_raining": 0,
                "precipitation_mm": 0,
                "visibility_km": 10,
                "temperature_c": 25,
            }
    
    def _extract_location_features(
        self,
        origin: LatLng,
        destination: LatLng,
    ) -> Dict[str, Any]:
        """Extract location-based features"""
        
        # H3 indices for location bucketing
        origin_h3 = h3.latlng_to_cell(origin.lat, origin.lng, self.H3_RESOLUTION)
        dest_h3 = h3.latlng_to_cell(destination.lat, destination.lng, self.H3_RESOLUTION)
        
        # Check if crossing CBD (Nairobi specific)
        is_cbd_origin = self._is_in_cbd(origin)
        is_cbd_dest = self._is_in_cbd(destination)
        
        return {
            "origin_h3_hash": hash(origin_h3) % 10000,  # Bucketed location
            "dest_h3_hash": hash(dest_h3) % 10000,
            "h3_distance": h3.grid_distance(origin_h3, dest_h3) if origin_h3 != dest_h3 else 0,
            "is_cbd_origin": 1 if is_cbd_origin else 0,
            "is_cbd_dest": 1 if is_cbd_dest else 0,
            "crosses_cbd": 1 if is_cbd_origin != is_cbd_dest else 0,
            "origin_lat": origin.lat,
            "origin_lng": origin.lng,
            "dest_lat": destination.lat,
            "dest_lng": destination.lng,
        }
    
    def _extract_vehicle_features(self, vehicle_type: str) -> Dict[str, int]:
        """Extract vehicle type features"""
        
        vehicle_encoding = {
            "economy": 0,
            "standard": 1,
            "premium": 2,
            "xl": 3,
            "bike": 4,
        }
        
        return {
            "vehicle_type_encoded": vehicle_encoding.get(vehicle_type.lower(), 1),
            "is_bike": 1 if vehicle_type.lower() == "bike" else 0,
            "is_premium": 1 if vehicle_type.lower() == "premium" else 0,
        }
    
    async def _extract_driver_features(
        self,
        driver_id: str,
    ) -> Dict[str, float]:
        """Extract driver-specific features"""
        
        # In production, fetch from driver service
        # For now, return defaults
        return {
            "driver_rating": 4.5,
            "driver_trip_count": 100,
            "driver_acceptance_rate": 0.85,
            "driver_completion_rate": 0.98,
        }
    
    def _haversine_distance(
        self,
        lat1: float,
        lng1: float,
        lat2: float,
        lng2: float,
    ) -> float:
        """Calculate haversine distance in meters"""
        
        R = 6371000  # Earth's radius in meters
        
        phi1 = math.radians(lat1)
        phi2 = math.radians(lat2)
        delta_phi = math.radians(lat2 - lat1)
        delta_lambda = math.radians(lng2 - lng1)
        
        a = (
            math.sin(delta_phi / 2) ** 2
            + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
        )
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        
        return R * c
    
    def _calculate_bearing(
        self,
        lat1: float,
        lng1: float,
        lat2: float,
        lng2: float,
    ) -> float:
        """Calculate bearing in degrees"""
        
        phi1 = math.radians(lat1)
        phi2 = math.radians(lat2)
        delta_lambda = math.radians(lng2 - lng1)
        
        x = math.sin(delta_lambda) * math.cos(phi2)
        y = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(
            delta_lambda
        )
        
        bearing = math.degrees(math.atan2(x, y))
        return (bearing + 360) % 360
    
    def _is_in_cbd(self, location: LatLng) -> bool:
        """Check if location is in Nairobi CBD"""
        
        # Approximate CBD bounds
        CBD_BOUNDS = {
            "min_lat": -1.295,
            "max_lat": -1.275,
            "min_lng": 36.810,
            "max_lng": 36.830,
        }
        
        return (
            CBD_BOUNDS["min_lat"] <= location.lat <= CBD_BOUNDS["max_lat"]
            and CBD_BOUNDS["min_lng"] <= location.lng <= CBD_BOUNDS["max_lng"]
        )
    
    def _is_holiday(self, date: datetime) -> int:
        """Check if date is a Kenyan holiday"""
        
        # Kenya public holidays (fixed dates)
        holidays = [
            (1, 1),   # New Year
            (5, 1),   # Labour Day
            (6, 1),   # Madaraka Day
            (10, 10), # Huduma Day
            (10, 20), # Mashujaa Day
            (12, 12), # Jamhuri Day
            (12, 25), # Christmas
            (12, 26), # Boxing Day
        ]
        
        return 1 if (date.month, date.day) in holidays else 0
    
    def _encode_traffic_level(self, level: str) -> int:
        """Encode traffic level as integer"""
        
        encoding = {
            "low": 0,
            "moderate": 1,
            "heavy": 2,
            "severe": 3,
        }
        return encoding.get(level.lower(), 1)
    
    def _encode_weather(self, condition: str) -> int:
        """Encode weather condition as integer"""
        
        condition = condition.lower()
        if "clear" in condition or "sunny" in condition:
            return 0
        elif "cloud" in condition:
            return 1
        elif "rain" in condition:
            return 2 if "heavy" in condition else 1
        elif "storm" in condition:
            return 3
        return 0
    
    def get_feature_names(self) -> list[str]:
        """Get ordered list of feature names for model"""
        
        return [
            # Distance
            "straight_distance_km",
            "estimated_road_distance_km",
            "bearing_sin",
            "bearing_cos",
            # Temporal
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
            # Traffic
            "traffic_speed_ratio",
            "traffic_delay_minutes",
            "traffic_level_encoded",
            "traffic_incidents_count",
            "traffic_congestion_percent",
            # Weather
            "weather_condition_encoded",
            "is_raining",
            "precipitation_mm",
            "visibility_km",
            # Location
            "is_cbd_origin",
            "is_cbd_dest",
            "crosses_cbd",
            "h3_distance",
            # Vehicle
            "vehicle_type_encoded",
            "is_bike",
            # Driver (optional)
            "driver_rating",
        ]
