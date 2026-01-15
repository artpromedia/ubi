"""
Sample Data Generator for ETA Model Training

Generates realistic synthetic training data based on typical African city patterns.
This can be used to bootstrap the model before real production data is available.

Usage:
    python -m app.training.generate_sample_data [options]
"""

import argparse
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict
import random
import math

import numpy as np
import pandas as pd

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# City zones with typical characteristics
ZONES = {
    "commercial": {"base_speed": 25, "rush_multiplier": 2.0, "name": "Commercial District"},
    "residential": {"base_speed": 35, "rush_multiplier": 1.3, "name": "Residential Area"},
    "industrial": {"base_speed": 40, "rush_multiplier": 1.5, "name": "Industrial Zone"},
    "airport": {"base_speed": 50, "rush_multiplier": 1.2, "name": "Airport Area"},
    "downtown": {"base_speed": 20, "rush_multiplier": 2.5, "name": "Downtown"},
}

ZONE_CODES = {zone: i for i, zone in enumerate(ZONES.keys())}

VEHICLE_TYPES = {
    "car": {"speed_multiplier": 1.0, "code": 0},
    "motorcycle": {"speed_multiplier": 1.3, "code": 1},
    "bicycle": {"speed_multiplier": 0.4, "code": 2},
}

WEATHER_CONDITIONS = {
    "clear": {"speed_multiplier": 1.0, "code": 0, "probability": 0.6},
    "clouds": {"speed_multiplier": 0.95, "code": 1, "probability": 0.2},
    "rain": {"speed_multiplier": 0.7, "code": 2, "probability": 0.15},
    "thunderstorm": {"speed_multiplier": 0.5, "code": 3, "probability": 0.05},
}


def is_rush_hour(hour: int, day_of_week: int) -> bool:
    """Determine if given time is rush hour"""
    if day_of_week >= 5:  # Weekend
        return False
    
    morning_rush = 7 <= hour <= 9
    evening_rush = 17 <= hour <= 20
    
    return morning_rush or evening_rush


def generate_traffic_conditions(
    hour: int,
    day_of_week: int,
    zone: str,
) -> Dict[str, float]:
    """Generate realistic traffic conditions"""
    
    base_congestion = 0.2
    
    # Rush hour effect
    if is_rush_hour(hour, day_of_week):
        congestion = base_congestion + random.uniform(0.3, 0.6)
    else:
        congestion = base_congestion + random.uniform(0, 0.2)
    
    # Zone effect
    zone_info = ZONES[zone]
    congestion *= zone_info["rush_multiplier"] / 2
    
    # Night time is clearer
    if hour >= 22 or hour <= 5:
        congestion *= 0.3
    
    congestion = min(congestion, 1.0)
    speed_ratio = max(0.3, 1.0 - congestion)
    
    return {
        "congestion": congestion,
        "speed_ratio": speed_ratio,
    }


def generate_weather() -> Dict[str, any]:
    """Generate random weather condition"""
    
    rand = random.random()
    cumulative = 0
    
    for condition, info in WEATHER_CONDITIONS.items():
        cumulative += info["probability"]
        if rand <= cumulative:
            precipitation = 0
            visibility = 10
            
            if condition == "rain":
                precipitation = random.uniform(1, 10)
                visibility = random.uniform(3, 7)
            elif condition == "thunderstorm":
                precipitation = random.uniform(10, 30)
                visibility = random.uniform(1, 3)
            
            return {
                "condition": condition,
                "code": info["code"],
                "precipitation": precipitation,
                "visibility": visibility,
                "speed_multiplier": info["speed_multiplier"],
            }
    
    return {
        "condition": "clear",
        "code": 0,
        "precipitation": 0,
        "visibility": 10,
        "speed_multiplier": 1.0,
    }


def calculate_eta(
    distance_km: float,
    traffic: Dict[str, float],
    weather: Dict[str, any],
    vehicle_type: str,
    origin_zone: str,
    destination_zone: str,
    is_rush: bool,
) -> float:
    """Calculate realistic ETA based on conditions"""
    
    # Base speed from zones
    origin_speed = ZONES[origin_zone]["base_speed"]
    dest_speed = ZONES[destination_zone]["base_speed"]
    avg_speed = (origin_speed + dest_speed) / 2
    
    # Apply traffic
    avg_speed *= traffic["speed_ratio"]
    
    # Apply weather
    avg_speed *= weather["speed_multiplier"]
    
    # Apply vehicle type
    avg_speed *= VEHICLE_TYPES[vehicle_type]["speed_multiplier"]
    
    # Rush hour penalty
    if is_rush:
        rush_multiplier = (
            ZONES[origin_zone]["rush_multiplier"] +
            ZONES[destination_zone]["rush_multiplier"]
        ) / 2
        avg_speed /= rush_multiplier
    
    # Calculate base ETA
    base_eta = (distance_km / avg_speed) * 60  # Convert to minutes
    
    # Add randomness (real-world variability)
    variability = random.gauss(1.0, 0.1)
    base_eta *= variability
    
    # Add minimum time (pickup, dropoff, etc.)
    base_eta += random.uniform(2, 5)
    
    return max(1.0, base_eta)


def generate_sample(
    sample_id: int,
    timestamp: datetime,
) -> Dict[str, any]:
    """Generate a single training sample"""
    
    # Random distance (1-50 km, weighted towards shorter)
    distance = np.random.exponential(8) + 1
    distance = min(distance, 50)
    
    # Random zones
    origin_zone = random.choice(list(ZONES.keys()))
    destination_zone = random.choice(list(ZONES.keys()))
    
    # Random vehicle type
    vehicle_type = random.choice(list(VEHICLE_TYPES.keys()))
    
    # Extract temporal features
    hour = timestamp.hour
    day_of_week = timestamp.weekday()
    is_weekend = 1 if day_of_week >= 5 else 0
    is_rush = 1 if is_rush_hour(hour, day_of_week) else 0
    is_night = 1 if (hour >= 22 or hour <= 5) else 0
    month = timestamp.month
    
    # Generate conditions
    traffic = generate_traffic_conditions(hour, day_of_week, origin_zone)
    weather = generate_weather()
    
    # Calculate actual ETA
    actual_eta = calculate_eta(
        distance,
        traffic,
        weather,
        vehicle_type,
        origin_zone,
        destination_zone,
        bool(is_rush),
    )
    
    return {
        "sample_id": sample_id,
        "timestamp": timestamp.isoformat(),
        "distance_km": round(distance, 2),
        "hour_of_day": hour,
        "day_of_week": day_of_week,
        "is_weekend": is_weekend,
        "is_rush_hour": is_rush,
        "is_night": is_night,
        "month": month,
        "traffic_speed_ratio": round(traffic["speed_ratio"], 3),
        "traffic_congestion": round(traffic["congestion"], 3),
        "weather_condition_code": weather["code"],
        "precipitation": round(weather["precipitation"], 1),
        "visibility_km": round(weather["visibility"], 1),
        "vehicle_type": vehicle_type,
        "vehicle_type_code": VEHICLE_TYPES[vehicle_type]["code"],
        "origin_zone": origin_zone,
        "origin_zone_type_code": ZONE_CODES[origin_zone],
        "destination_zone": destination_zone,
        "destination_zone_type_code": ZONE_CODES[destination_zone],
        "actual_eta_minutes": round(actual_eta, 2),
    }


def generate_dataset(
    num_samples: int,
    start_date: datetime,
    end_date: datetime,
) -> pd.DataFrame:
    """Generate full training dataset"""
    
    logger.info(f"Generating {num_samples} samples...")
    
    samples = []
    date_range = (end_date - start_date).total_seconds()
    
    for i in range(num_samples):
        # Random timestamp in range
        random_seconds = random.uniform(0, date_range)
        timestamp = start_date + timedelta(seconds=random_seconds)
        
        sample = generate_sample(i, timestamp)
        samples.append(sample)
        
        if (i + 1) % 10000 == 0:
            logger.info(f"  Generated {i + 1} samples...")
    
    df = pd.DataFrame(samples)
    
    logger.info(f"Dataset generated: {len(df)} samples")
    logger.info(f"Date range: {df['timestamp'].min()} to {df['timestamp'].max()}")
    logger.info(f"ETA range: {df['actual_eta_minutes'].min():.1f} to {df['actual_eta_minutes'].max():.1f} minutes")
    logger.info(f"Distance range: {df['distance_km'].min():.1f} to {df['distance_km'].max():.1f} km")
    
    return df


def main():
    """Main function to generate sample data"""
    
    parser = argparse.ArgumentParser(description="Generate sample training data")
    parser.add_argument(
        "--num-samples",
        type=int,
        default=100000,
        help="Number of samples to generate",
    )
    parser.add_argument(
        "--output-path",
        type=str,
        default="data/training_data.csv",
        help="Output path for CSV file",
    )
    parser.add_argument(
        "--start-date",
        type=str,
        default="2025-01-01",
        help="Start date for sample range (YYYY-MM-DD)",
    )
    parser.add_argument(
        "--end-date",
        type=str,
        default="2025-12-31",
        help="End date for sample range (YYYY-MM-DD)",
    )
    
    args = parser.parse_args()
    
    # Parse dates
    start_date = datetime.strptime(args.start_date, "%Y-%m-%d")
    end_date = datetime.strptime(args.end_date, "%Y-%m-%d")
    
    # Generate dataset
    df = generate_dataset(args.num_samples, start_date, end_date)
    
    # Save to CSV
    output_path = Path(args.output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(output_path, index=False)
    
    logger.info(f"\nDataset saved to {output_path}")
    logger.info(f"File size: {output_path.stat().st_size / 1024 / 1024:.2f} MB")
    
    # Print summary statistics
    logger.info("\nDataset Statistics:")
    logger.info(f"  Total samples: {len(df)}")
    logger.info(f"  Mean ETA: {df['actual_eta_minutes'].mean():.2f} minutes")
    logger.info(f"  Median ETA: {df['actual_eta_minutes'].median():.2f} minutes")
    logger.info(f"  Std ETA: {df['actual_eta_minutes'].std():.2f} minutes")
    
    logger.info("\nVehicle type distribution:")
    for vtype in VEHICLE_TYPES:
        count = len(df[df['vehicle_type'] == vtype])
        logger.info(f"  {vtype}: {count} ({count/len(df)*100:.1f}%)")
    
    logger.info("\nWeather distribution:")
    for condition, info in WEATHER_CONDITIONS.items():
        count = len(df[df['weather_condition_code'] == info['code']])
        logger.info(f"  {condition}: {count} ({count/len(df)*100:.1f}%)")


if __name__ == "__main__":
    main()
