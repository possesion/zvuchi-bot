# Implementation Plan: Grafana + Loki + Promtail Logging Stack

## Overview

This implementation plan integrates centralized structured logging into the Zvuchi Telegram Bot. The solution uses Winston for application logging, Promtail for log collection, Loki for log storage, and Grafana for visualization. All console.log statements will be replaced with structured JSON logging, and the entire observability stack will be deployed via docker-compose.

## Tasks

- [x] 1. Set up infrastructure configuration
  - [x] 1.1 Create configuration directory and files
    - Create `config/` directory in project root
    - Create `config/loki-config.yml` with retention policy (30 days)
    - Create `config/promtail-config.yml` with Docker log scraping and label extraction
    - Create `config/grafana-datasources.yml` with Loki datasource provisioning
    - Update `.gitignore` to exclude `config/`, `grafana-data/`, `loki-data/`
    - _Requirements: 2.4, 2.5, 5.1, 6.1-6.5, 8.1-8.4_

- [x] 2. Implement Winston logger module
  - [x] 2.1 Install Winston dependency
    - Run `npm install winston` to add winston@^3.11.0
    - Verify package.json includes winston in dependencies
    - _Requirements: 1.1_
  
  - [x] 2.2 Create logger module
    - Create `src/logger.js` with Winston configuration
    - Configure JSON format with timestamp, level, message fields
    - Configure ISO 8601 timestamp format with milliseconds
    - Configure error stack trace capture
    - Set log level from `LOG_LEVEL` env variable (default: info)
    - Configure Console transport with all logs to stdout
    - Set `exitOnError: false` to prevent crashes on logging errors
    - Set `handleExceptions: false` on Console transport
    - Add error event listener for graceful error handling
    - Export logger instance
    - _Requirements: 1.1-1.6, 10.1-10.3_
  
  - [ ]* 2.3 Write property test for JSON output format
    - **Property 1: JSON Output Format**
    - **Validates: Requirements 1.1**
    - Generate arbitrary log messages and metadata
    - Verify all logger output can be parsed as valid JSON
    - Verify no parse errors occur for any valid input
  
  - [ ]* 2.4 Write property test for timestamp format
    - **Property 2: Timestamp Presence and Format**
    - **Validates: Requirements 1.2**
    - Generate arbitrary log calls at all levels
    - Verify every output contains `timestamp` field
    - Verify timestamp matches ISO 8601 pattern `YYYY-MM-DDTHH:mm:ss.sssZ`
  
  - [ ]* 2.5 Write property test for log level preservation
    - **Property 3: Log Level Preservation**
    - **Validates: Requirements 1.3**
    - Generate logs at all levels (info, warn, error, debug)
    - Verify output JSON `level` field matches input level exactly

- [ ] 3. Replace console statements in core files
  - [ ] 3.1 Update index.js
    - Add `const logger = require('./src/logger');` at top
    - Replace all `console.log` with `logger.info`
    - Replace all `console.error` with `logger.error`
    - Add contextual metadata where applicable (error objects)
    - _Requirements: 1.7, 7.1, 7.7_
  
  - [ ] 3.2 Update src/handlers.js
    - Add `const logger = require('./logger');` at top
    - Replace all `console.log` with `logger.info` or `logger.warn`
    - Replace all `console.error` with `logger.error`
    - Add contextual metadata (user_id, phone) where applicable
    - _Requirements: 1.7-1.8, 7.2, 7.8_
  
  - [ ] 3.3 Update src/database.js
    - Add `const logger = require('./logger');` at top
    - Replace all `console.log` with `logger.info`
    - Add contextual metadata (user_id, phone) where applicable
    - _Requirements: 1.7, 7.3_
  
  - [ ] 3.4 Update src/api.js
    - Add `const logger = require('./logger');` at top
    - Replace all `console.log` with `logger.info`
    - Replace all `console.error` with `logger.error`
    - Add contextual metadata (phone, error, crm_response) where applicable
    - _Requirements: 1.7-1.9, 7.4, 7.9, 10.3-10.5_
  
  - [ ] 3.5 Update src/notifications.js
    - Add `const logger = require('./logger');` at top
    - Replace all `console.log` with `logger.info`
    - Replace all `console.error` with `logger.error`
    - Add contextual metadata where applicable
    - _Requirements: 1.7-1.8, 7.5, 7.10_
  
  - [x] 3.6 Update src/healthcheck.js
    - Add `const logger = require('./logger');` at top
    - Replace all `console.log` with `logger.info`
    - Replace all `console.warn` with `logger.warn`
    - Replace all `console.error` with `logger.error`
    - _Requirements: 1.7-1.9, 7.6, 7.11-7.12_
  
  - [ ]* 3.7 Write property test for message content preservation
    - **Property 4: Message Content Preservation**
    - **Validates: Requirements 1.4**
    - Generate arbitrary strings (including special chars, whitespace)
    - Log each string as a message
    - Verify output JSON `message` field contains exact input string
  
  - [ ]* 3.8 Write property test for structured fields inclusion
    - **Property 5: Structured Fields Inclusion**
    - **Validates: Requirements 1.5**
    - Generate arbitrary objects with various key-value pairs
    - Log with these objects as metadata
    - Verify all input fields appear in output JSON with preserved values

- [x] 4. Checkpoint - Verify logger integration
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Update Docker Compose configuration
  - [x] 5.1 Add Loki service to docker-compose.yml
    - Add `loki` service using grafana/loki:2.9.3 image
    - Mount `./config/loki-config.yml` to `/etc/loki/local-config.yaml` (read-only)
    - Mount named volume `loki-data` to `/loki`
    - Expose port 3100 (internal only, not to host)
    - Add health check using wget to `/ready` endpoint
    - Set restart policy to `unless-stopped`
    - _Requirements: 2.1, 2.4, 2.8, 9.1, 9.3_
  
  - [x] 5.2 Add Promtail service to docker-compose.yml
    - Add `promtail` service using grafana/promtail:2.9.3 image
    - Mount `./config/promtail-config.yml` to `/etc/promtail/config.yml` (read-only)
    - Mount `/var/run/docker.sock` to `/var/run/docker.sock` (read-only)
    - Add dependency on `loki` service
    - Set restart policy to `unless-stopped`
    - _Requirements: 2.2, 2.5, 2.6, 9.1, 9.4_
  
  - [x] 5.3 Add Grafana service to docker-compose.yml
    - Add `grafana` service using grafana/grafana:10.2.3 image
    - Bind to `176.124.198.245:3001:3000`
    - Mount named volume `grafana-data` to `/var/lib/grafana`
    - Mount `./config/grafana-datasources.yml` to provisioning directory (read-only)
    - Use `${GF_SECURITY_ADMIN_USER:?GF_SECURITY_ADMIN_USER must be set in .env}` syntax for admin user (REQUIRED - no default)
    - Use `${GF_SECURITY_ADMIN_PASSWORD:?GF_SECURITY_ADMIN_PASSWORD must be set in .env}` syntax for admin password (REQUIRED - no default)
    - Set `GF_USERS_ALLOW_SIGN_UP=false`
    - Add dependency on `loki` service
    - Set restart policy to `unless-stopped`
    - _Requirements: 2.3, 2.7, 2.9, 3.1-3.3, 4.1-4.6, 9.2, 9.5_
  
  - [x] 5.4 Update zvuchi-bot service in docker-compose.yml
    - Add Docker labels: `app.name: "zvuchi-bot"`, `app.version: "1.0.0"`
    - Configure json-file logging driver with max-size 10m and max-file 3
    - _Requirements: 6.4-6.5_
  
  - [ ] 5.5 Define named volumes in docker-compose.yml
    - Add `loki-data` volume definition
    - Add `grafana-data` volume definition
    - _Requirements: 2.7, 2.8_

- [ ] 6. Update environment configuration
  - [ ] 6.1 Update .env file
    - Add `GF_SECURITY_ADMIN_USER` variable with secure username (REQUIRED - no default provided)
    - Add `GF_SECURITY_ADMIN_PASSWORD` variable with STRONG password (REQUIRED - no default provided)
    - **PASSWORD REQUIREMENTS**: Minimum 12 characters, must include uppercase, lowercase, numbers, and special characters
    - **SECURITY WARNING**: NEVER use default password "admin" in production - this creates a critical security vulnerability
    - Add `LOG_LEVEL=info` variable
    - Document variables in comments
    - _Requirements: 4.1-4.2_
  
  - [ ] 6.2 Validate required environment variables
    - Run `docker-compose config` to validate configuration
    - Verify command fails if `GF_SECURITY_ADMIN_USER` is missing from .env
    - Verify command fails if `GF_SECURITY_ADMIN_PASSWORD` is missing from .env
    - Verify error messages clearly indicate which variable is missing
    - _Requirements: 4.1-4.2_
  
  - [ ]* 6.3 Write property test for error message extraction
    - **Property 6: Error Message Extraction**
    - **Validates: Requirements 10.1**
    - Generate arbitrary Error objects with various messages
    - Log each error
    - Verify output JSON contains `error.message` field with exact error message
  
  - [ ]* 6.4 Write property test for error stack extraction
    - **Property 7: Error Stack Extraction**
    - **Validates: Requirements 10.2**
    - Generate arbitrary Error objects
    - Log each error
    - Verify output JSON contains `error.stack` field with stack trace

- [ ] 7. Property tests for conditional context fields
  - [ ]* 7.1 Write property test for conditional user_id field
    - **Property 8: Conditional Context Field - User ID**
    - **Validates: Requirements 10.3**
    - Generate logs with and without `user_id` metadata
    - When provided, verify `user_id` appears in output JSON
    - When not provided, verify `user_id` does NOT appear in output JSON
  
  - [ ]* 7.2 Write property test for conditional phone field
    - **Property 9: Conditional Context Field - Phone**
    - **Validates: Requirements 10.4**
    - Generate logs with and without `phone` metadata
    - When provided, verify `phone` appears in output JSON
    - When not provided, verify `phone` does NOT appear in output JSON
  
  - [ ]* 7.3 Write property test for conditional crm_response field
    - **Property 10: Conditional Context Field - CRM Response**
    - **Validates: Requirements 10.5**
    - Generate logs with and without `crm_response` metadata
    - When provided, verify `crm_response` appears in output JSON
    - When not provided, verify `crm_response` does NOT appear in output JSON
  
  - [ ]* 7.4 Write property test for forbidden APP_NAME field
    - **Property 11: Forbidden Field - APP_NAME**
    - **Validates: Requirements 6.6**
    - Generate arbitrary log entries
    - Verify output JSON never contains `APP_NAME` field
  
  - [ ]* 7.5 Write property test for forbidden SERVICE_NAME field
    - **Property 12: Forbidden Field - SERVICE_NAME**
    - **Validates: Requirements 6.7**
    - Generate arbitrary log entries
    - Verify output JSON never contains `SERVICE_NAME` field

- [ ] 8. Checkpoint - Verify configuration completeness
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Deploy and verify the logging stack
  - [ ] 9.1 Build and deploy services
    - Run `docker-compose down` to stop existing services
    - Run `docker-compose build` to rebuild zvuchi-bot image
    - Run `docker-compose up -d` to start all services
    - _Requirements: 2.1-2.3, 9.1-9.2_
  
  - [ ] 9.2 Verify service health
    - Run `docker-compose ps` to check all services are "Up"
    - Check Loki health: `curl http://localhost:3100/ready`
    - Verify Grafana accessible at http://176.124.198.245:3001
    - _Requirements: 3.1-3.3, 9.3-9.5_
  
  - [ ] 9.3 Verify log output format
    - Run `docker-compose logs zvuchi-bot --tail=10`
    - Verify logs are in JSON format
    - Parse sample log with jq to validate JSON structure
    - Verify required fields present (timestamp, level, message)
    - _Requirements: 1.1-1.6_
  
  - [ ] 9.4 Verify Loki integration
    - Access Grafana at http://176.124.198.245:3001
    - Login with credentials from .env
    - Navigate to Explore view
    - Verify Loki is default data source
    - Query logs: `{compose_service="zvuchi-bot"}`
    - Verify logs appear in results
    - _Requirements: 8.1-8.4_
  
  - [ ] 9.5 Verify label extraction
    - In Grafana Explore, inspect available labels
    - Verify `container_name` label exists
    - Verify `compose_project` label exists
    - Verify `compose_service` label exists
    - Verify `app_name` label exists with value "zvuchi-bot"
    - Verify `app_version` label exists with value "1.0.0"
    - _Requirements: 6.1-6.5_
  
  - [ ]* 9.6 Write integration test for log flow
    - Generate test log entry in application
    - Query Loki API for recent logs
    - Verify test log appears in Loki results within 10 seconds
    - Verify all expected labels are attached
  
  - [ ]* 9.7 Write integration test for missing credentials
    - Remove `GF_SECURITY_ADMIN_USER` from .env temporarily
    - Run `docker-compose up` and verify it fails before starting services
    - Restore credential and remove `GF_SECURITY_ADMIN_PASSWORD` from .env
    - Run `docker-compose up` and verify it fails before starting services
    - Restore all credentials
    - _Requirements: 4.1-4.2_

- [ ] 10. Final checkpoint - System validation
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional property-based tests and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at logical breaks
- Property tests validate universal correctness properties from the design document
- The infrastructure setup (Task 1) must complete before logger implementation (Task 2)
- Console statement replacement (Task 3) depends on logger module (Task 2)
- Docker compose updates (Task 5) can proceed in parallel with console replacement
- Deployment verification (Task 9) requires all previous implementation tasks to complete
- All property tests are optional but provide comprehensive validation of logger behavior
- Task 6.2 validates that deployment fails when required credentials are missing (fail-fast security pattern)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["2.2"] },
    { "id": 2, "tasks": ["2.3", "2.4", "2.5", "3.1", "3.2", "3.3", "3.4", "3.5", "3.6", "5.1"] },
    { "id": 3, "tasks": ["3.7", "3.8", "5.2", "5.3", "5.4"] },
    { "id": 4, "tasks": ["5.5", "6.1"] },
    { "id": 5, "tasks": ["6.2"] },
    { "id": 6, "tasks": ["6.3", "6.4", "7.1", "7.2", "7.3", "7.4", "7.5"] },
    { "id": 7, "tasks": ["9.1"] },
    { "id": 8, "tasks": ["9.2", "9.3"] },
    { "id": 9, "tasks": ["9.4", "9.5", "9.6", "9.7"] }
  ]
}
```
