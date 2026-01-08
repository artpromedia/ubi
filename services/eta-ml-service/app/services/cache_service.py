"""
Cache Service - Redis caching for feature data and predictions
"""

from typing import Any, Optional
import json
import redis.asyncio as redis
import structlog

logger = structlog.get_logger(__name__)


class CacheService:
    """Async Redis cache service"""
    
    def __init__(self, client: redis.Redis):
        self._client = client
    
    @classmethod
    async def create(cls, redis_url: str) -> "CacheService":
        """Factory method to create cache service"""
        
        client = redis.from_url(
            redis_url,
            encoding="utf-8",
            decode_responses=True,
        )
        
        # Test connection
        try:
            await client.ping()
            logger.info("Redis connected", url=redis_url.split("@")[-1])
        except Exception as e:
            logger.warning("Redis connection failed, using fallback", error=str(e))
        
        return cls(client)
    
    async def get(self, key: str) -> Optional[Any]:
        """Get value from cache"""
        
        try:
            value = await self._client.get(key)
            if value:
                return json.loads(value)
            return None
        except Exception:
            return None
    
    async def set(
        self,
        key: str,
        value: Any,
        ttl: int = 300,
    ) -> bool:
        """Set value in cache with TTL"""
        
        try:
            await self._client.setex(
                key,
                ttl,
                json.dumps(value),
            )
            return True
        except Exception:
            return False
    
    async def delete(self, key: str) -> bool:
        """Delete key from cache"""
        
        try:
            await self._client.delete(key)
            return True
        except Exception:
            return False
    
    async def increment(self, key: str, amount: int = 1) -> int:
        """Increment counter"""
        
        try:
            return await self._client.incr(key, amount)
        except Exception:
            return 0
    
    async def get_list(self, key: str, start: int = 0, end: int = -1) -> list:
        """Get list from cache"""
        
        try:
            items = await self._client.lrange(key, start, end)
            return [json.loads(item) for item in items]
        except Exception:
            return []
    
    async def push_list(self, key: str, value: Any, ttl: int = 3600) -> int:
        """Push to list and set TTL"""
        
        try:
            length = await self._client.rpush(key, json.dumps(value))
            await self._client.expire(key, ttl)
            return length
        except Exception:
            return 0
    
    async def close(self):
        """Close Redis connection"""
        
        try:
            await self._client.close()
        except Exception:
            pass
