# UBI Database Initialization Script
# Creates necessary schemas and extensions

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- Create schemas for multi-tenancy (optional)
-- CREATE SCHEMA IF NOT EXISTS b2b;
-- CREATE SCHEMA IF NOT EXISTS drivers;
-- CREATE SCHEMA IF NOT EXISTS merchants;

-- Grant permissions to ubi user
GRANT ALL PRIVILEGES ON DATABASE ubi_production TO ubi;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ubi;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ubi;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ubi;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ubi;

-- Performance configuration (adjust based on Hetzner instance size)
-- These are recommendations for a CX41 (8 vCPU, 16GB RAM)
-- ALTER SYSTEM SET shared_buffers = '4GB';
-- ALTER SYSTEM SET effective_cache_size = '12GB';
-- ALTER SYSTEM SET maintenance_work_mem = '1GB';
-- ALTER SYSTEM SET work_mem = '64MB';
-- ALTER SYSTEM SET wal_buffers = '64MB';
-- ALTER SYSTEM SET max_connections = '200';
-- ALTER SYSTEM SET checkpoint_completion_target = '0.9';
-- ALTER SYSTEM SET random_page_cost = '1.1';  -- SSD
-- ALTER SYSTEM SET effective_io_concurrency = '200';  -- SSD

-- Logging configuration
-- ALTER SYSTEM SET log_min_duration_statement = '1000';  -- Log queries > 1s
-- ALTER SYSTEM SET log_checkpoints = 'on';
-- ALTER SYSTEM SET log_connections = 'on';
-- ALTER SYSTEM SET log_disconnections = 'on';
-- ALTER SYSTEM SET log_lock_waits = 'on';
-- ALTER SYSTEM SET log_temp_files = '0';

-- Create a readonly user for analytics (optional)
-- CREATE USER ubi_readonly WITH PASSWORD 'readonly_password';
-- GRANT CONNECT ON DATABASE ubi_production TO ubi_readonly;
-- GRANT USAGE ON SCHEMA public TO ubi_readonly;
-- GRANT SELECT ON ALL TABLES IN SCHEMA public TO ubi_readonly;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ubi_readonly;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'UBI database initialization complete';
END $$;
