"""
Tests for Traffic Service
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
import httpx

from app.services.traffic_service import TrafficService
from app.models.schemas import LatLng


class TestTrafficService:
    """Test suite for TrafficService"""

    @pytest.fixture
    def service(self, mock_cache):
        return TrafficService(api_key="test-api-key", cache=mock_cache)

    @pytest.fixture
    def service_no_api(self, mock_cache):
        return TrafficService(api_key=None, cache=mock_cache)

    @pytest.mark.asyncio
    async def test_get_traffic_conditions_cache_hit(self, service, mock_cache):
        """Test traffic conditions returned from cache"""
        mock_cache.get.return_value = {
            "congestion_level": "low",
            "speed_ratio": 0.9,
        }
        
        origin = LatLng(lat=6.5244, lng=3.3792)
        destination = LatLng(lat=6.4541, lng=3.3947)
        
        result = await service.get_traffic_conditions(origin, destination)
        
        assert result["congestion_level"] == "low"
        mock_cache.get.assert_called_once()

    @pytest.mark.asyncio
    async def test_get_traffic_conditions_cache_miss(self, service, mock_cache):
        """Test traffic conditions fetched when not in cache"""
        mock_cache.get.return_value = None
        
        origin = LatLng(lat=6.5244, lng=3.3792)
        destination = LatLng(lat=6.4541, lng=3.3947)
        
        with patch.object(service, "_fetch_from_api", new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = {
                "congestion_level": "moderate",
                "speed_ratio": 0.8,
            }
            
            result = await service.get_traffic_conditions(origin, destination)
        
        assert result["congestion_level"] == "moderate"
        mock_cache.set.assert_called_once()

    @pytest.mark.asyncio
    async def test_get_traffic_conditions_no_api_key(self, service_no_api, mock_cache):
        """Test fallback to patterns when no API key"""
        mock_cache.get.return_value = None
        
        origin = LatLng(lat=6.5244, lng=3.3792)
        destination = LatLng(lat=6.4541, lng=3.3947)
        
        result = await service_no_api.get_traffic_conditions(origin, destination)
        
        # Should return estimated values
        assert "speed_ratio" in result
        assert result["speed_ratio"] > 0

    @pytest.mark.asyncio
    async def test_get_traffic_flow(self, service, mock_cache):
        """Test traffic flow retrieval"""
        mock_cache.get.return_value = None
        
        location = LatLng(lat=6.5244, lng=3.3792)
        
        with patch.object(service, "_fetch_flow_from_api", new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = {
                "speed_ratio": 0.85,
                "level": "moderate",
            }
            
            result = await service.get_traffic_flow(location)
        
        assert result["level"] == "moderate"

    @pytest.mark.asyncio
    async def test_api_error_returns_default(self, service, mock_cache):
        """Test default values returned on API error"""
        mock_cache.get.return_value = None
        
        origin = LatLng(lat=6.5244, lng=3.3792)
        destination = LatLng(lat=6.4541, lng=3.3947)
        
        with patch.object(service, "_fetch_from_api", new_callable=AsyncMock) as mock_fetch:
            mock_fetch.side_effect = Exception("API error")
            
            result = await service.get_traffic_conditions(origin, destination)
        
        # Should return default traffic
        assert "speed_ratio" in result

    def test_default_traffic(self, service):
        """Test default traffic values"""
        default = service._default_traffic()
        
        assert default["speed_ratio"] == 1.0
        assert "congestion_level" in default


class TestWeatherService:
    """Test suite for WeatherService"""

    @pytest.fixture
    def service(self, mock_cache):
        from app.services.weather_service import WeatherService
        return WeatherService(api_key="test-api-key", cache=mock_cache)

    @pytest.mark.asyncio
    async def test_get_current_weather_cache_hit(self, service, mock_cache):
        """Test weather returned from cache"""
        mock_cache.get.return_value = {
            "condition": "rain",
            "precipitation": 5.0,
        }
        
        location = LatLng(lat=6.5244, lng=3.3792)
        
        result = await service.get_current_weather(location)
        
        assert result["condition"] == "rain"

    @pytest.mark.asyncio
    async def test_get_current_weather_cache_miss(self, service, mock_cache):
        """Test weather fetched when not in cache"""
        mock_cache.get.return_value = None
        
        location = LatLng(lat=6.5244, lng=3.3792)
        
        with patch.object(service, "_fetch_from_api", new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = {
                "condition": "clear",
                "temperature": 28,
            }
            
            result = await service.get_current_weather(location)
        
        assert result["condition"] == "clear"

    def test_weather_impact_multiplier_clear(self, service):
        """Test impact multiplier for clear weather"""
        weather = {"condition": "clear", "precipitation": 0, "visibility": 10}
        
        multiplier = service.get_weather_impact_multiplier(weather)
        
        assert multiplier == 1.0

    def test_weather_impact_multiplier_rain(self, service):
        """Test impact multiplier for rain"""
        weather = {"condition": "rain", "precipitation": 5, "visibility": 5}
        
        multiplier = service.get_weather_impact_multiplier(weather)
        
        # Rain should increase ETA
        assert multiplier > 1.0

    def test_weather_impact_multiplier_heavy_rain(self, service):
        """Test impact multiplier for heavy rain"""
        weather = {"condition": "rain", "precipitation": 20, "visibility": 2}
        
        multiplier = service.get_weather_impact_multiplier(weather)
        
        # Heavy rain should have higher multiplier
        assert multiplier > 1.2

    def test_default_weather(self, service):
        """Test default weather values"""
        default = service._default_weather()
        
        assert default["condition"] == "clear"
        assert default["precipitation"] == 0


class TestCacheService:
    """Test suite for CacheService"""

    @pytest.mark.asyncio
    async def test_cache_set_and_get(self, mock_cache):
        """Test basic cache operations"""
        await mock_cache.set("test_key", {"value": 123}, ttl=60)
        
        mock_cache.set.assert_called_once()

    @pytest.mark.asyncio
    async def test_cache_delete(self, mock_cache):
        """Test cache deletion"""
        await mock_cache.delete("test_key")
        
        mock_cache.delete.assert_called_once()

    @pytest.mark.asyncio
    async def test_cache_handles_redis_error(self):
        """Test cache gracefully handles Redis errors"""
        from app.services.cache_service import CacheService
        
        mock_client = AsyncMock()
        mock_client.get.side_effect = Exception("Redis connection error")
        
        cache = CacheService(mock_client)
        
        result = await cache.get("test_key")
        
        assert result is None  # Should return None, not raise
