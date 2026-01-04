-- UBI Database Initialization Script
-- This script runs on first container creation

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create schemas for service isolation
CREATE SCHEMA IF NOT EXISTS users;
CREATE SCHEMA IF NOT EXISTS rides;
CREATE SCHEMA IF NOT EXISTS food;
CREATE SCHEMA IF NOT EXISTS delivery;
CREATE SCHEMA IF NOT EXISTS payments;
CREATE SCHEMA IF NOT EXISTS notifications;

-- Grant permissions
GRANT ALL PRIVILEGES ON SCHEMA users TO ubi;
GRANT ALL PRIVILEGES ON SCHEMA rides TO ubi;
GRANT ALL PRIVILEGES ON SCHEMA food TO ubi;
GRANT ALL PRIVILEGES ON SCHEMA delivery TO ubi;
GRANT ALL PRIVILEGES ON SCHEMA payments TO ubi;
GRANT ALL PRIVILEGES ON SCHEMA notifications TO ubi;

-- Create test database
CREATE DATABASE ubi_test OWNER ubi;

-- Connect to test database and set up extensions
\c ubi_test;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create schemas in test database
CREATE SCHEMA IF NOT EXISTS users;
CREATE SCHEMA IF NOT EXISTS rides;
CREATE SCHEMA IF NOT EXISTS food;
CREATE SCHEMA IF NOT EXISTS delivery;
CREATE SCHEMA IF NOT EXISTS payments;
CREATE SCHEMA IF NOT EXISTS notifications;

GRANT ALL PRIVILEGES ON SCHEMA users TO ubi;
GRANT ALL PRIVILEGES ON SCHEMA rides TO ubi;
GRANT ALL PRIVILEGES ON SCHEMA food TO ubi;
GRANT ALL PRIVILEGES ON SCHEMA delivery TO ubi;
GRANT ALL PRIVILEGES ON SCHEMA payments TO ubi;
GRANT ALL PRIVILEGES ON SCHEMA notifications TO ubi;

\echo 'UBI Database initialization complete!'
