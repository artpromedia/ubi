"""
Traffic Service - Real-time traffic data integration

Integrates with TomTom/Google Traffic APIs for:
- Real-time traffic conditions
- Traffic incidents
- Speed flow data
"""

from typing import Dict, Any, Optional
from datetime import datetime, timedelta
import httpx
import structlog

from app.models.schemas import LatLng
from app.config import settings

logger = structlog.get_logger(__name__)


class TrafficService:
    """Real-time traffic data service"""
    
    CACHE_TTL = 30  # Cache traffic data for 30 seconds
    
    def __init__(self, api_key: str, cache: "CacheService"):
        self.api_key = api_key
        self.cache = cache
        self.base_url = settings.traffic_api_url
    
    async def get_traffic_conditions(
        self,
        origin: LatLng,
        destination: LatLng,
    ) -> Dict[str, Any]:
        """Get traffic conditions between two points"""
        
        # Check cache first
        cache_key = f"traffic:{origin.lat:.4f},{origin.lng:.4f}:{destination.lat:.4f},{destination.lng:.4f}"
        cached = await self.cache.get(cache_key)
        if cached:
            return cached
        
        try:
            if self.api_key:
                result = await self._fetch_from_api(origin, destination)
            else:
                # Use historical patterns if no API key
                result = await self._estimate_from_patterns(origin, destination)
            
            # Cache result
            await self.cache.set(cache_key, result, ttl=self.CACHE_TTL)
            return result
            
        except Exception as e:
            logger.error("Traffic service error", error=str(e))
            return self._default_traffic()
    
    async def get_traffic_flow(
        self,
        location: LatLng,
        radius_meters: int = 500,
    ) -> Dict[str, Any]:
        """Get traffic flow data for an area"""
        
        cache_key = f"traffic_flow:{location.lat:.4f},{location.lng:.4f}:{radius_meters}"
        cached = await self.cache.get(cache_key)
        if cached:
            return cached
        
        try:
            if self.api_key:
                result = await self._fetch_flow_from_api(location, radius_meters)
            else:
                result = self._estimate_flow_from_time()
            
            await self.cache.set(cache_key, result, ttl=self.CACHE_TTL)
            return result
            
        except Exception as e:
            logger.error("Traffic flow error", error=str(e))
            return {"speed_ratio": 1.0, "level": "moderate"}
    
    async def _fetch_from_api(
        self,
        origin: LatLng,
        destination: LatLng,
    ) -> Dict[str, Any]:
        """Fetch traffic data from TomTom API"""
        
        async with httpx.AsyncClient(timeout=5.0) as client:
            # TomTom Routing API with traffic
            url = f"{self.base_url}/routing/1/calculateRoute/{origin.lat},{origin.lng}:{destination.lat},{destination.lng}/json"
            
            response = await client.get(
                url,
                params={
                    "key": self.api_key,
                    "traffic": "true",
                    "travelMode": "car",
                },
            )
            
            if response.status_code != 200:
                return self._default_traffic()
            
            data = response.json()
            route = data.get("routes", [{}])[0]
            summary = route.get("summary", {})
            
            # Calculate traffic impact
            freeflow_time = summary.get("noTrafficTravelTimeInSeconds", 0)
            traffic_time = summary.get("travelTimeInSeconds", 0)
            
            if freeflow_time > 0:
                speed_ratio = freeflow_time / traffic_time
                delay_minutes = (traffic_time - freeflow_time) / 60
            else:
                speed_ratio = 1.0
                delay_minutes = 0
            
            # Determine traffic level
            if speed_ratio > 0.9:
                level = "low"
            elif speed_ratio > 0.7:
                level = "moderate"
            elif speed_ratio > 0.5:
                level = "heavy"
            else:
                level = "severe"
            
            return {
                "speed_ratio": speed_ratio,
                "delay_minutes": delay_minutes,
                "level": level,
                "incidents": len(route.get("incidents", [])),
                "congestion": int((1 - speed_ratio) * 100),
            }
    
    async def _fetch_flow_from_api(
        self,
        location: LatLng,
        radius_meters: int,
    ) -> Dict[str, Any]:
        """Fetch traffic flow from API"""
        
        async with httpx.AsyncClient(timeout=5.0) as client:
            url = f"{self.base_url}/traffic/services/4/flowSegmentData/absolute/10/json"
            
            response = await client.get(
                url,
                params={
                    "key": self.api_key,
                    "point": f"{location.lat},{location.lng}",
                },
            )
            
            if response.status_code != 200:
                return self._estimate_flow_from_time()
            
            data = response.json()
            flow = data.get("flowSegmentData", {})
            
            current_speed = flow.get("currentSpeed", 30)
            freeflow_speed = flow.get("freeFlowSpeed", 50)
            
            speed_ratio = current_speed / freeflow_speed if freeflow_speed > 0 else 1.0
            
            return {
                "speed_ratio": speed_ratio,
                "current_speed_kmh": current_speed,
                "freeflow_speed_kmh": freeflow_speed,
                "level": self._speed_ratio_to_level(speed_ratio),
            }
    
    async def _estimate_from_patterns(
        self,
        origin: LatLng,
        destination: LatLng,
    ) -> Dict[str, Any]:
        """Estimate traffic from historical patterns when no API available"""
        
        now = datetime.now()
        hour = now.hour
        day = now.weekday()
        
        # Historical traffic patterns for Nairobi
        # These would ideally come from a database of historical data
        
        # Check if CBD crossing
        is_cbd = self._crosses_cbd(origin, destination)
        
        # Rush hour patterns
        if day < 5:  # Weekday
            if 7 <= hour <= 9:
                base_ratio = 0.5 if is_cbd else 0.7
            elif 17 <= hour <= 19:
                base_ratio = 0.45 if is_cbd else 0.65
            elif 12 <= hour <= 14:
                base_ratio = 0.75
            elif 22 <= hour or hour <= 5:
                base_ratio = 0.95
            else:
                base_ratio = 0.8
        else:  # Weekend
            if 11 <= hour <= 15:
                base_ratio = 0.7
            else:
                base_ratio = 0.85
        
        return {
            "speed_ratio": base_ratio,
            "delay_minutes": (1 / base_ratio - 1) * 10,  # Estimated delay per 10 min trip
            "level": self._speed_ratio_to_level(base_ratio),
            "incidents": 0,
            "congestion": int((1 - base_ratio) * 100),
        }
    
    def _estimate_flow_from_time(self) -> Dict[str, Any]:
        """Estimate traffic flow from time of day"""
        
        now = datetime.now()
        hour = now.hour
        day = now.weekday()
        
        if day < 5 and (7 <= hour <= 9 or 17 <= hour <= 19):
            return {"speed_ratio": 0.6, "level": "heavy"}
        elif 22 <= hour or hour <= 5:
            return {"speed_ratio": 0.95, "level": "low"}
        else:
            return {"speed_ratio": 0.8, "level": "moderate"}
    
    def _speed_ratio_to_level(self, ratio: float) -> str:
        """Convert speed ratio to traffic level"""
        
        if ratio > 0.9:
            return "low"
        elif ratio > 0.7:
            return "moderate"
        elif ratio > 0.5:
            return "heavy"
        else:
            return "severe"
    
    def _crosses_cbd(self, origin: LatLng, destination: LatLng) -> bool:
        """Check if route likely crosses CBD"""
        
        CBD_CENTER = (-1.285, 36.820)
        CBD_RADIUS = 0.02  # ~2km
        
        def in_cbd(lat: float, lng: float) -> bool:
            return (
                abs(lat - CBD_CENTER[0]) < CBD_RADIUS
                and abs(lng - CBD_CENTER[1]) < CBD_RADIUS
            )
        
        origin_in = in_cbd(origin.lat, origin.lng)
        dest_in = in_cbd(destination.lat, destination.lng)
        
        return origin_in or dest_in
    
    def _default_traffic(self) -> Dict[str, Any]:
        """Default traffic values"""
        
        return {
            "speed_ratio": 0.75,
            "delay_minutes": 5,
            "level": "moderate",
            "incidents": 0,
            "congestion": 25,
        }
