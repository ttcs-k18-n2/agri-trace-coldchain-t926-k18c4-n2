-- Rollback Migration 025: Drop cold chain monitoring tables
DROP TABLE IF EXISTS temperature_violations CASCADE;
DROP TABLE IF EXISTS temperature_readings CASCADE;
