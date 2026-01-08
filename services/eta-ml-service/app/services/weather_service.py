"""
Weather Service - Weather data integration for ETA adjustments
"""

from typing import Dict, Any
import httpx
import structlog

from app.models.schemas import LatLng
from app.config import settings

logger = structlog.get_logger(__name__)


class WeatherService:
    """Weather data service for ETA adjustments"""
    
    CACHE_TTL = 300  # Cache weather for 5 minutes
    
    def __init__(self, api_key: str, cache: "CacheService"):
        self.api_key = api_key
        self.cache = cache
        self.base_url = settings.weather_api_url
    
    async def get_current_weather(self, location: LatLng) -> Dict[str, Any]:
        """Get current weather conditions"""
        
        # Use rounded coordinates for cache
        cache_key = f"weather:{location.lat:.2f},{location.lng:.2f}"
        cached = await self.cache.get(cache_key)
        if cached:
            return cached
        
        try:
            if self.api_key:
                result = await self._fetch_from_api(location)
            else:
                result = self._default_weather()
            
            await self.cache.set(cache_key, result, ttl=self.CACHE_TTL)
            return result
            
        except Exception as e:
            logger.error("Weather service error", error=str(e))
            return self._default_weather()
    
    async def _fetch_from_api(self, location: LatLng) -> Dict[str, Any]:
        """Fetch weather from OpenWeatherMap API"""
        
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(
                f"{self.base_url}/weather",
                params={
                    "lat": location.lat,
                    "lon": location.lng,
                    "appid": self.api_key,
                    "units": "metric",
                },
            )
            
            if response.status_code != 200:
                return self._default_weather()
            
            data = response.json()
            weather = data.get("weather", [{}])[0]
            main = data.get("main", {})
            
            condition = weather.get("main", "Clear").lower()
            rain = data.get("rain", {}).get("1h", 0)
            
            return {
                "condition": condition,
                "description": weather.get("description", ""),
                "temperature": main.get("temp", 25),
                "humidity": main.get("humidity", 50),
                "precipitation": rain,
                "visibility": data.get("visibility", 10000) / 1000,  # km
                "wind_speed": data.get("wind", {}).get("speed", 0),
            }
    
    def _default_weather(self) -> Dict[str, Any]:
        """Default weather (clear conditions)"""
        
        return {
            "condition": "clear",
            "description": "clear sky",
            "temperature": 25,
            "humidity": 50,
            "precipitation": 0,
            "visibility": 10,
            "wind_speed": 5,
        }
    
    def get_weather_impact_multiplier(self, weather: Dict[str, Any]) -> float:
        """Calculate impact multiplier for ETA based on weather"""
        
        condition = weather.get("condition", "clear").lower()
        precipitation = weather.get("precipitation", 0)
        visibility = weather.get("visibility", 10)
        
        multiplier = 1.0
        
        # Rain impact
        if "rain" in condition:
            if precipitation > 10:
                multiplier *= 1.3  # Heavy rain
            else:
                multiplier *= 1.15  # Light rain
        elif "storm" in condition or "thunder" in condition:
            multiplier *= 1.5
        
        # Visibility impact
        if visibility < 1:
            multiplier *= 1.3  # Very poor visibility
        elif visibility < 3:
            multiplier *= 1.1
        
        return multiplier
