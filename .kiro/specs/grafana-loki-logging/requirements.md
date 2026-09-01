# Requirements Document

## Introduction

This document defines requirements for integrating a centralized logging stack (Grafana + Loki + Promtail) into the Zvuchi Telegram Bot. The system shall replace all console.log statements with structured JSON logging, deploy the observability stack via docker-compose, and provide web-based log access with authentication.

## Glossary

- **Logging_System**: The winston or pino library integrated into the application for structured JSON logging
- **Loki**: The log aggregation system that indexes and stores log data
- **Promtail**: The log shipping agent that reads Docker container logs and forwards them to Loki
- **Grafana**: The web-based visualization platform for querying and viewing logs from Loki
- **Docker_Compose_Stack**: The docker-compose.yml configuration that orchestrates the bot, Loki, Promtail, and Grafana containers
- **Application_Container**: The zvuchi-bot Docker container running the Node.js Telegram bot application
- **Retention_Policy**: The Loki configuration that automatically deletes logs older than a specified duration
- **Docker_Label**: Metadata attached to Docker containers (e.g., app.name, app.version) used by Promtail for log enrichment

## Requirements

### Requirement 1: Structured JSON Logging

**User Story:** As a developer, I want all application logs in structured JSON format, so that I can query and filter logs efficiently in Grafana.

#### Acceptance Criteria

1. THE Logging_System SHALL emit log entries in JSON format
2. THE Logging_System SHALL include timestamp in each log entry
3. THE Logging_System SHALL include level in each log entry
4. THE Logging_System SHALL include message field containing the log message in each log entry
5. THE Logging_System SHALL support additional structured fields (user_id, phone, error_stack) in log entries
6. THE Logging_System SHALL output logs to stdout for Docker container log collection
7. THE Application_Container SHALL NOT use console.log for any logging operations
8. THE Application_Container SHALL NOT use console.error for any logging operations
9. THE Application_Container SHALL NOT use console.warn for any logging operations

### Requirement 2: Docker Compose Stack Deployment

**User Story:** As an operations engineer, I want the entire logging stack deployed via docker-compose, so that I can manage all services with a single orchestration tool.

#### Acceptance Criteria

1. THE Docker_Compose_Stack SHALL define a loki service using the grafana/loki image
2. THE Docker_Compose_Stack SHALL define a promtail service using the grafana/promtail image
3. THE Docker_Compose_Stack SHALL define a grafana service using the grafana/grafana image
4. THE Docker_Compose_Stack SHALL mount Loki configuration file from the host into the loki service
5. THE Docker_Compose_Stack SHALL mount Promtail configuration file from the host into the promtail service
6. THE Docker_Compose_Stack SHALL mount the Docker socket (/var/run/docker.sock) read-only into the promtail service
7. THE Docker_Compose_Stack SHALL mount persistent volume for Grafana data storage
8. THE Docker_Compose_Stack SHALL mount persistent volume for Loki data storage
9. THE Docker_Compose_Stack SHALL expose Grafana web interface on host port 3001

### Requirement 3: Web Access

**User Story:** As a developer, I want to access Grafana via web browser using a specific IP and port, so that I can view logs from any workstation.

#### Acceptance Criteria

1. THE Grafana service SHALL bind to host IP address 176.124.198.245 on port 3001
2. WHEN a user navigates to http://176.124.198.245:3001, THE Grafana service SHALL serve the login page
3. WHEN a user submits valid credentials, THE Grafana service SHALL grant access to the dashboard interface
4. IF valid credentials are submitted AND internal errors prevent access, THEN THE Grafana service SHALL display a generic error message

### Requirement 4: Authentication

**User Story:** As a security-conscious operator, I want Grafana credentials stored in environment variables, so that credentials are not committed to version control.

#### Acceptance Criteria

1. IF GF_SECURITY_ADMIN_USER is not defined, THEN THE Docker_Compose_Stack SHALL fail deployment
2. IF GF_SECURITY_ADMIN_PASSWORD is not defined, THEN THE Docker_Compose_Stack SHALL fail deployment
3. THE Docker_Compose_Stack SHALL read GF_SECURITY_ADMIN_USER from .env file
4. THE Docker_Compose_Stack SHALL read GF_SECURITY_ADMIN_PASSWORD from .env file
5. THE Grafana service SHALL use GF_SECURITY_ADMIN_USER as the administrator username
6. THE Grafana service SHALL use GF_SECURITY_ADMIN_PASSWORD as the administrator password

### Requirement 5: Log Retention

**User Story:** As an operations engineer, I want logs automatically deleted after 30 days, so that disk usage remains bounded.

#### Acceptance Criteria

1. THE Loki service SHALL delete log data older than 30 days
2. THE Retention_Policy SHALL execute daily at midnight UTC
3. THE Loki service SHALL NOT delete log data newer than 30 days

### Requirement 6: Automatic Log Labeling

**User Story:** As a developer, I want Promtail to automatically extract labels from Docker containers, so that I don't need to manually configure application names in each log entry.

#### Acceptance Criteria

1. THE Promtail service SHALL extract container_name label from Docker container metadata
2. THE Promtail service SHALL extract compose_project label from Docker Compose metadata
3. THE Promtail service SHALL extract compose_service label from Docker Compose metadata
4. WHEN a Docker_Label named "app.name" exists, THE Promtail service SHALL extract it as app_name label
5. WHEN a Docker_Label named "app.version" exists, THE Promtail service SHALL extract it as app_version label
6. THE Application_Container SHALL NOT include APP_NAME field in log JSON structure
7. THE Application_Container SHALL NOT include SERVICE_NAME field in log JSON structure

### Requirement 7: Log Replacement Throughout Codebase

**User Story:** As a developer, I want all console.log statements replaced with structured logging, so that all application logs are captured in Loki.

#### Acceptance Criteria

1. THE Logging_System SHALL replace console.log statements in index.js
2. THE Logging_System SHALL replace console.log statements in src/handlers.js
3. THE Logging_System SHALL replace console.log statements in src/database.js
4. THE Logging_System SHALL replace console.log statements in src/api.js
5. THE Logging_System SHALL replace console.log statements in src/notifications.js
6. THE Logging_System SHALL replace console.log statements in src/healthcheck.js
7. THE Logging_System SHALL replace console.error statements in index.js
8. THE Logging_System SHALL replace console.error statements in src/handlers.js
9. THE Logging_System SHALL replace console.error statements in src/api.js
10. THE Logging_System SHALL replace console.error statements in src/notifications.js
11. THE Logging_System SHALL replace console.error statements in src/healthcheck.js
12. THE Logging_System SHALL replace console.warn statements in src/healthcheck.js

### Requirement 8: Loki Data Source Configuration

**User Story:** As a developer, I want Grafana pre-configured with Loki as a data source, so that I can immediately query logs after deployment.

#### Acceptance Criteria

1. THE Grafana service SHALL provision Loki as a data source on first startup
2. THE Grafana service SHALL configure Loki data source URL to http://loki:3100
3. THE Grafana service SHALL set Loki as the default data source
4. WHEN a user opens Grafana Explore view, THE Grafana service SHALL default to the Loki data source
5. IF Loki provisioning fails, THEN THE Grafana service SHALL display an error message indicating the data source is unavailable

### Requirement 9: Service Dependencies

**User Story:** As an operations engineer, I want services to start in correct order, so that Promtail and Grafana can connect to Loki without retry loops.

#### Acceptance Criteria

1. THE Docker_Compose_Stack SHALL start loki service before promtail service
2. THE Docker_Compose_Stack SHALL start loki service before grafana service
3. WHEN loki service fails health check, THE Docker_Compose_Stack SHALL restart loki service
4. WHEN promtail service exits, THE Docker_Compose_Stack SHALL restart promtail service
5. WHEN grafana service exits, THE Docker_Compose_Stack SHALL restart grafana service

### Requirement 10: Error Context Preservation

**User Story:** As a developer debugging production issues, I want error logs to include stack traces and context, so that I can identify root causes quickly.

#### Acceptance Criteria

1. WHEN logging an Error object, THE Logging_System SHALL include error.message field
2. WHEN logging an Error object, THE Logging_System SHALL include error.stack field
3. IF the Logging_System fails to extract error fields, THEN THE Logging_System SHALL create the log entry with available fields
4. WHEN logging an error with user context, THE Logging_System SHALL include user_id field if available
5. WHEN logging an error with phone context, THE Logging_System SHALL include phone field if available
6. WHEN logging an error with CRM context, THE Logging_System SHALL include crm_response field if available
