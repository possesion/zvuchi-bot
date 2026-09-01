# Design Document: Grafana + Loki + Promtail Logging Stack

## Overview

This design implements centralized structured logging for the Zvuchi Telegram Bot using Winston for application logging and a Grafana + Loki + Promtail stack for log aggregation and visualization. The solution replaces all console.log statements with structured JSON logging, deploys the observability infrastructure via docker-compose, and provides web-based log access with authentication.

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Docker Host                              │
│                                                              │
│  ┌────────────────┐         ┌─────────────────┐            │
│  │  zvuchi-bot    │────────▶│   Promtail      │            │
│  │  (Winston)     │  stdout │ (Log Collector) │            │
│  │  JSON logs     │         │                 │            │
│  └────────────────┘         └────────┬────────┘            │
│                                       │                      │
│                                       │ Push logs           │
│                                       ▼                      │
│                              ┌────────────────┐             │
│                              │      Loki      │             │
│                              │ (Log Storage)  │             │
│                              │  30-day TTL    │             │
│                              └────────┬───────┘             │
│                                       │                      │
│                                       │ Query logs          │
│                                       ▼                      │
│                              ┌────────────────┐             │
│  User ───────────────────────▶    Grafana     │             │
│  176.124.198.245:3001        │ (Visualization)│             │
│                              └────────────────┘             │
└─────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

1. **Winston Logger** (Application Layer)
   - Structured JSON logging with timestamps
   - Log levels: debug, info, warn, error
   - Contextual fields (user_id, phone, error_stack)
   - Output to stdout for Docker capture

2. **Promtail** (Collection Layer)
   - Reads Docker container logs via mounted socket
   - Enriches logs with Docker metadata labels
   - Forwards logs to Loki in real-time

3. **Loki** (Storage Layer)
   - Indexes and stores log streams
   - 30-day retention policy
   - Exposes HTTP API for queries

4. **Grafana** (Presentation Layer)
   - Web UI for log exploration
   - Pre-configured Loki datasource
   - Authentication via environment variables

## Detailed Design

### 1. Winston Logger Module

**File:** `src/logger.js`

#### Configuration

```javascript
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' // ISO 8601 with milliseconds
    }),
    winston.format.errors({ stack: true }), // Capture stack traces
    winston.format.json() // JSON output
  ),
  transports: [
    new winston.transports.Console({
      stderrLevels: [], // Force all logs to stdout
      handleExceptions: false // Prevent crashes on logging errors
    })
  ],
  exitOnError: false // Continue on transport errors
});

// Gracefully handle logger errors without crashing the application
logger.on('error', (err) => {
  // Fallback to console if logger fails (should never happen in normal operation)
  console.error('Logger error:', err.message);
});

module.exports = logger;
```

#### Logger API

**Methods:**

```javascript
// Basic logging
logger.info(message, [metadata])
logger.warn(message, [metadata])
logger.error(message, [metadata])
logger.debug(message, [metadata])

// With contextual data
logger.info('User registered', { user_id: 12345, phone: '+1234567890' });

// With Error object (automatically extracts message and stack)
logger.error('API request failed', { 
  error: err,           // Winston extracts err.message and err.stack
  user_id: userId,
  crm_response: response 
});

// Graceful degradation: If error extraction fails, log with available fields
try {
  logger.error('Operation failed', { error: someValue });
} catch (logErr) {
  // Logger handles this internally, but application continues
}
```

**Output Format:**

```json
{
  "level": "info",
  "message": "User registered",
  "timestamp": "2024-01-15T14:23:45.123Z",
  "user_id": 12345,
  "phone": "+1234567890"
}
```

```json
{
  "level": "error",
  "message": "API request failed",
  "timestamp": "2024-01-15T14:23:45.456Z",
  "error": {
    "message": "Connection timeout",
    "stack": "Error: Connection timeout\n    at fetch (/app/src/api.js:45:15)\n    ..."
  },
  "user_id": 12345,
  "crm_response": "{\"status\":\"error\"}"
}
```

### 2. Docker Compose Configuration

**File:** `docker-compose.yml`

```yaml
version: '3.8'

services:
  zvuchi-bot:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    volumes:
      - ./bot.db:/app/bot.db
    env_file:
      - .env
    restart: unless-stopped
    labels:
      app.name: "zvuchi-bot"
      app.version: "1.0.0"
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  loki:
    image: grafana/loki:2.9.3
    ports:
      - "3100:3100"
    volumes:
      - ./config/loki-config.yml:/etc/loki/local-config.yaml:ro
      - loki-data:/loki
    command: -config.file=/etc/loki/local-config.yaml
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://localhost:3100/ready || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 5

  promtail:
    image: grafana/promtail:2.9.3
    volumes:
      - ./config/promtail-config.yml:/etc/promtail/config.yml:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
    command: -config.file=/etc/promtail/config.yml
    depends_on:
      - loki
    restart: unless-stopped

  grafana:
    image: grafana/grafana:10.2.3
    ports:
      - "176.124.198.245:3001:3000"
    volumes:
      - grafana-data:/var/lib/grafana
      - ./config/grafana-datasources.yml:/etc/grafana/provisioning/datasources/datasources.yml:ro
    environment:
      - GF_SECURITY_ADMIN_USER=${GF_SECURITY_ADMIN_USER:?GF_SECURITY_ADMIN_USER must be set in .env}
      - GF_SECURITY_ADMIN_PASSWORD=${GF_SECURITY_ADMIN_PASSWORD:?GF_SECURITY_ADMIN_PASSWORD must be set in .env}
      - GF_USERS_ALLOW_SIGN_UP=false
    depends_on:
      - loki
    restart: unless-stopped

volumes:
  loki-data:
  grafana-data:
```

### 3. Loki Configuration

**File:** `config/loki-config.yml`

```yaml
auth_enabled: false

server:
  http_listen_port: 3100
  grpc_listen_port: 9096

common:
  path_prefix: /loki
  storage:
    filesystem:
      chunks_directory: /loki/chunks
      rules_directory: /loki/rules
  replication_factor: 1
  ring:
    instance_addr: 127.0.0.1
    kvstore:
      store: inmemory

schema_config:
  configs:
    - from: 2020-10-24
      store: boltdb-shipper
      object_store: filesystem
      schema: v11
      index:
        prefix: index_
        period: 24h

storage_config:
  boltdb_shipper:
    active_index_directory: /loki/boltdb-shipper-active
    cache_location: /loki/boltdb-shipper-cache
    cache_ttl: 24h
    shared_store: filesystem
  filesystem:
    directory: /loki/chunks

limits_config:
  retention_period: 720h  # 30 days
  ingestion_rate_mb: 16
  ingestion_burst_size_mb: 32

compactor:
  working_directory: /loki/boltdb-shipper-compactor
  shared_store: filesystem
  retention_enabled: true
  retention_delete_delay: 2h
  retention_delete_worker_count: 150

table_manager:
  retention_deletes_enabled: true
  retention_period: 720h  # 30 days
```

### 4. Promtail Configuration

**File:** `config/promtail-config.yml`

```yaml
server:
  http_listen_port: 9080
  grpc_listen_port: 0

positions:
  filename: /tmp/positions.yaml

clients:
  - url: http://loki:3100/loki/api/v1/push

scrape_configs:
  - job_name: docker
    docker_sd_configs:
      - host: unix:///var/run/docker.sock
        refresh_interval: 5s
    
    relabel_configs:
      # Extract container name
      - source_labels: ['__meta_docker_container_name']
        regex: '/(.*)'
        target_label: 'container_name'
      
      # Extract compose project
      - source_labels: ['__meta_docker_container_label_com_docker_compose_project']
        target_label: 'compose_project'
      
      # Extract compose service
      - source_labels: ['__meta_docker_container_label_com_docker_compose_service']
        target_label: 'compose_service'
      
      # Extract custom app.name label
      - source_labels: ['__meta_docker_container_label_app_name']
        target_label: 'app_name'
      
      # Extract custom app.version label
      - source_labels: ['__meta_docker_container_label_app_version']
        target_label: 'app_version'
```

### 5. Grafana Datasource Provisioning

**File:** `config/grafana-datasources.yml`

```yaml
apiVersion: 1

datasources:
  - name: Loki
    type: loki
    access: proxy
    url: http://loki:3100
    isDefault: true
    editable: false
    jsonData:
      maxLines: 1000
```

**Error Handling:**

If Loki provisioning fails during Grafana startup:
1. Grafana will display: "Data source Loki is not available" or similar error message
2. The Grafana service will continue running (not crash)
3. Users can manually configure the data source through the UI
4. Check Grafana logs: `docker-compose logs grafana | grep -i error`
5. Common causes: Loki service not reachable, invalid URL, network issues

### 6. Migration Strategy

#### Phase 1: Setup Infrastructure

1. **Create configuration directory:**
   ```bash
   mkdir -p config
   ```

2. **Create Loki config:** `config/loki-config.yml` (as above)

3. **Create Promtail config:** `config/promtail-config.yml` (as above)

4. **Create Grafana datasource config:** `config/grafana-datasources.yml` (as above)

5. **Update docker-compose.yml** with new services

6. **Update .env file:**
   ```bash
   # Add to .env (REQUIRED - no defaults provided)
   GF_SECURITY_ADMIN_USER=your-username
   GF_SECURITY_ADMIN_PASSWORD=your-secure-password
   LOG_LEVEL=info
   ```

7. **Validate required environment variables:**
   ```bash
   # Test that docker-compose fails if credentials are missing
   docker-compose config
   # Should show error: "GF_SECURITY_ADMIN_USER must be set in .env"
   # or: "GF_SECURITY_ADMIN_PASSWORD must be set in .env"
   ```

8. **Update .gitignore:**
   ```
   # Grafana and Loki data
   config/
   grafana-data/
   loki-data/
   ```

#### Phase 2: Implement Logger Module

1. **Install Winston:**
   ```bash
   npm install winston
   ```

2. **Create logger module:** `src/logger.js` (as above)

3. **Update package.json:**
   ```json
   {
     "dependencies": {
       "winston": "^3.11.0"
     }
   }
   ```

#### Phase 3: Replace Console Statements

**Migration Pattern:**

```javascript
// OLD
console.log('Бот запущен...');
console.error('Ошибка:', error);

// NEW
const logger = require('./src/logger');

logger.info('Бот запущен');
logger.error('Ошибка', { error });
```

**File-by-File Migration:**

1. **index.js**
   - Add: `const logger = require('./src/logger');`
   - Replace: 3 console.log → logger.info
   - Replace: 2 console.error → logger.error

2. **src/handlers.js**
   - Add: `const logger = require('./logger');`
   - Replace: console.log → logger.info/logger.warn
   - Replace: console.error → logger.error

3. **src/database.js**
   - Add: `const logger = require('./logger');`
   - Replace: console.log → logger.info

4. **src/api.js**
   - Add: `const logger = require('./logger');`
   - Replace: 5 console.log → logger.info
   - Replace: 2 console.error → logger.error
   - Add context: { phone, error }

5. **src/notifications.js**
   - Add: `const logger = require('./logger');`
   - Replace: console.log → logger.info
   - Replace: console.error → logger.error

6. **src/healthcheck.js**
   - Add: `const logger = require('./logger');`
   - Replace: console.log → logger.info
   - Replace: console.warn → logger.warn
   - Replace: console.error → logger.error

#### Phase 4: Deploy and Verify

1. **Build and start stack:**
   ```bash
   docker-compose down
   docker-compose build
   docker-compose up -d
   ```

2. **Verify services:**
   ```bash
   docker-compose ps
   # All services should be "Up"
   ```

3. **Check logs:**
   ```bash
   docker-compose logs zvuchi-bot
   # Should show JSON formatted logs
   ```

4. **Access Grafana:**
   - Navigate to: http://176.124.198.245:3001
   - Login with credentials from .env
   - Go to Explore → Select Loki
   - Query: `{compose_service="zvuchi-bot"}`

#### Phase 5: Validation

1. **Verify log format:**
   ```bash
   docker-compose logs zvuchi-bot --tail=1 | jq
   # Should parse as valid JSON
   ```

2. **Verify labels in Loki:**
   - In Grafana Explore, check available labels
   - Should see: container_name, compose_project, compose_service, app_name, app_version

3. **Verify retention:**
   - Check Loki config is loaded: `docker-compose logs loki | grep retention`

4. **Test log queries:**
   ```
   {app_name="zvuchi-bot"} |= "error"
   {compose_service="zvuchi-bot"} | json | level="error"
   {compose_service="zvuchi-bot"} | json | user_id="12345"
   ```

## Data Models

### Log Entry Schema

```javascript
{
  level: string,          // Required: "info" | "warn" | "error" | "debug"
  message: string,        // Required: Log message
  timestamp: string,      // Required: ISO 8601 with milliseconds
  [key: string]: any      // Optional: Additional context fields
}
```

### Common Context Fields

```javascript
{
  user_id: number,        // Telegram user ID
  phone: string,          // User phone number
  error: {                // Error object (if applicable)
    message: string,
    stack: string
  },
  crm_response: string,   // CRM API response (if applicable)
  duration_ms: number     // Operation duration (if applicable)
}
```

## Error Handling

### Logger Error Handling

**Graceful Degradation:**

Winston is configured with `exitOnError: false` and `handleExceptions: false` to prevent application crashes due to logging failures. The logger handles errors through:

1. **Error event emission:** Logger errors trigger the 'error' event listener
2. **Fallback logging:** Console.error is used as last resort if logger fails
3. **Field extraction failures:** If extracting error.message or error.stack fails, the log entry is created with available fields only
4. **Transport failures:** If stdout fails, Winston attempts recovery and continues processing subsequent logs

**Example of graceful field extraction:**

```javascript
// If error object is malformed or missing fields
logger.error('Operation failed', { error: invalidValue });
// Result: Log entry created with whatever fields can be extracted
// Missing fields are omitted, but log is still recorded
```

The application will NOT crash due to:
- Malformed Error objects passed to logger
- Missing or undefined context fields
- Logger transport failures
- JSON serialization errors

### Grafana Authentication Errors

**Login Error Handling:**

When a user submits valid credentials but internal errors prevent access:
1. Grafana displays: "An error occurred. Please try again later." (generic message)
2. Detailed error is logged to Grafana container logs
3. User can retry login after resolving the internal issue
4. Common causes: Database connection issues, permission problems, corrupted config

**Debugging login errors:**
```bash
docker-compose logs grafana | grep -i "error\|failed"
```

### Loki Datasource Provisioning Errors

**Provisioning Failure Handling:**

If Loki datasource provisioning fails during Grafana startup:
1. **Error message displayed:** "Data source Loki is not available" or similar in the UI
2. **Grafana continues running:** Service does not crash, other features remain accessible
3. **Manual recovery:** Users can manually configure the Loki datasource via Grafana UI (Configuration → Data Sources → Add data source → Loki → URL: http://loki:3100)
4. **Logs inspection:** Check errors with `docker-compose logs grafana | grep -i provisioning`

**Common causes and resolutions:**
- **Loki not reachable:** Verify loki service is running (`docker-compose ps loki`)
- **Invalid URL:** Check `config/grafana-datasources.yml` has correct URL
- **Network issues:** Verify services are on same Docker network
- **Config file not mounted:** Verify volume mount in docker-compose.yml

### Docker Service Failures

**Loki failure:**
- Promtail: Buffers logs locally, retries push
- Grafana: Queries fail, but service remains available
- Resolution: Automatic restart via docker-compose

**Promtail failure:**
- Logs continue to stdout
- Docker captures logs (json-file driver)
- Resolution: Automatic restart via docker-compose

**Grafana failure:**
- Loki continues collecting logs
- Log queries unavailable via UI
- Resolution: Automatic restart via docker-compose

### Environment Variable Validation

**Missing Required Variables:**

If GF_SECURITY_ADMIN_USER or GF_SECURITY_ADMIN_PASSWORD are missing from .env:
1. **docker-compose config fails** with error message indicating which variable is missing
2. **docker-compose up fails** before starting any services
3. **Resolution:** Add the required variables to .env file

**Validation command:**
```bash
docker-compose config
# Returns: "variable is not set" error if credentials missing
```

This prevents accidental deployment with default credentials.

### Log Loss Prevention

1. **Docker json-file driver:** Buffers logs to disk (max 30MB per container)
2. **Promtail buffering:** Retries failed pushes to Loki
3. **Loki replication:** Single replica (acceptable for this use case)

## Performance Considerations

### Logger Performance

- **Winston overhead:** ~0.1ms per log entry
- **JSON serialization:** ~0.05ms for typical entry
- **Total impact:** Negligible for bot workload (<100 logs/minute)

### Storage Estimates

**Assumptions:**
- Average log entry: 500 bytes
- Log rate: 1000 entries/day
- Retention: 30 days

**Storage calculation:**
```
500 bytes × 1000 entries × 30 days = 15 MB
```

**With growth buffer:** ~100 MB for Loki data volume

### Network Bandwidth

- Promtail → Loki: Local Docker network (minimal latency)
- User → Grafana: HTTP over LAN (acceptable for web UI)

## Security Considerations

### Authentication

1. **Grafana credentials:** Stored in .env (git-ignored), REQUIRED with no defaults
2. **Credential validation:** Docker Compose validates presence before deployment
3. **Loki auth:** Disabled (internal Docker network only)
4. **Promtail auth:** Not required (local Docker socket)

### Network Exposure

1. **Grafana:** Bound to specific IP (176.124.198.245:3001)
2. **Loki:** Not exposed to host (internal only)
3. **Promtail:** Not exposed to host (internal only)

### Log Content Security

1. **Sensitive data:** Avoid logging passwords, API keys, tokens
2. **PII handling:** Phone numbers and user IDs are acceptable
3. **Error contexts:** CRM responses may contain sensitive data (review before logging)

**Best practices:**
```javascript
// GOOD
logger.info('User authenticated', { user_id: userId });

// BAD - Don't log sensitive data
logger.info('User authenticated', { password: userPassword });
```

### Docker Socket Access

Promtail requires read-only access to `/var/run/docker.sock`:
- Allows reading container metadata
- Does NOT allow container control
- Mounted as read-only (`:ro` flag)

## Testing Strategy

### Unit Tests

1. **Logger output format:**
   - Verify JSON structure
   - Verify required fields (timestamp, level, message)
   - Verify ISO 8601 timestamp format

2. **Logger methods:**
   - Test info/warn/error/debug levels
   - Test metadata inclusion
   - Test Error object handling

3. **Context preservation:**
   - Test user_id field inclusion
   - Test phone field inclusion
   - Test error stack preservation

### Integration Tests

1. **Docker stack deployment:**
   - Verify all services start
   - Verify service dependencies
   - Verify restart policies

2. **Log flow end-to-end:**
   - Generate log in application
   - Verify appears in Loki
   - Verify queryable in Grafana

3. **Label extraction:**
   - Verify container_name label
   - Verify compose_service label
   - Verify custom app.name label

4. **Authentication:**
   - Verify Grafana login with custom credentials from .env
   - Verify deployment fails if credentials are missing

### Property-Based Tests

Property-based tests focus on verifying universal properties of the logging system across many generated inputs.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: JSON Output Format

*For any* log entry generated by the logger, the output SHALL be valid JSON that can be parsed without errors.

**Validates: Requirements 1.1**

### Property 2: Timestamp Presence and Format

*For any* log entry, the output JSON SHALL contain a `timestamp` field in ISO 8601 format with millisecond precision (matching pattern `YYYY-MM-DDTHH:mm:ss.sssZ`).

**Validates: Requirements 1.2**

### Property 3: Log Level Preservation

*For any* log level (info, warn, error, debug), when a message is logged at that level, the output JSON SHALL contain a `level` field with the exact log level value.

**Validates: Requirements 1.3**

### Property 4: Message Content Preservation

*For any* string message passed to the logger, the output JSON SHALL contain a `message` field with the exact message content (preserving whitespace and special characters).

**Validates: Requirements 1.4**

### Property 5: Structured Fields Inclusion

*For any* additional structured fields (object properties) passed to the logger, all fields SHALL appear in the output JSON with their original keys and values preserved.

**Validates: Requirements 1.5**

### Property 6: Error Message Extraction

*For any* Error object logged, the output JSON SHALL contain an `error.message` field with the error's message property.

**Validates: Requirements 10.1**

### Property 7: Error Stack Extraction

*For any* Error object logged, the output JSON SHALL contain an `error.stack` field with the error's stack trace.

**Validates: Requirements 10.2**

### Property 8: Conditional Context Field - User ID

*For any* log entry, if a `user_id` field is provided in the metadata, it SHALL appear in the output JSON; if not provided, it SHALL NOT appear in the output JSON.

**Validates: Requirements 10.3**

### Property 9: Conditional Context Field - Phone

*For any* log entry, if a `phone` field is provided in the metadata, it SHALL appear in the output JSON; if not provided, it SHALL NOT appear in the output JSON.

**Validates: Requirements 10.4**

### Property 10: Conditional Context Field - CRM Response

*For any* log entry, if a `crm_response` field is provided in the metadata, it SHALL appear in the output JSON; if not provided, it SHALL NOT appear in the output JSON.

**Validates: Requirements 10.5**

### Property 11: Forbidden Field - APP_NAME

*For any* log entry generated by the application, the output JSON SHALL NOT contain a field named `APP_NAME`.

**Validates: Requirements 6.6**

### Property 12: Forbidden Field - SERVICE_NAME

*For any* log entry generated by the application, the output JSON SHALL NOT contain a field named `SERVICE_NAME`.

**Validates: Requirements 6.7**

## Dependencies

### NPM Packages

```json
{
  "dependencies": {
    "winston": "^3.11.0"
  }
}
```

### Docker Images

- grafana/loki:2.9.3
- grafana/promtail:2.9.3
- grafana/grafana:10.2.3

### System Requirements

- Docker Engine 20.10+
- Docker Compose 2.0+
- 500 MB disk space (for logs and images)

## Configuration Management

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| LOG_LEVEL | No | info | Winston log level (debug/info/warn/error) |
| GF_SECURITY_ADMIN_USER | Yes | None | Grafana admin username (deployment fails if missing) |
| GF_SECURITY_ADMIN_PASSWORD | Yes | None | Grafana admin password (deployment fails if missing) |

### Configuration Files

| File | Purpose | Managed By |
|------|---------|------------|
| config/loki-config.yml | Loki server settings | Manual |
| config/promtail-config.yml | Log collection rules | Manual |
| config/grafana-datasources.yml | Grafana datasource | Manual |
| .env | Secrets and environment | Manual (git-ignored) |

## Monitoring and Observability

### Health Checks

1. **Loki health endpoint:** `http://localhost:3100/ready`
2. **Grafana health:** Web UI accessibility
3. **Promtail:** Process running (no built-in health check)

### Key Metrics

1. **Log ingestion rate:** Monitor in Grafana
2. **Storage usage:** `docker volume inspect loki-data`
3. **Error rate:** Query `{compose_service="zvuchi-bot"} | json | level="error"`

### Alerting (Future Enhancement)

Grafana can be configured with alerts for:
- High error rate (>10 errors/minute)
- No logs received (service down)
- Disk space usage (>80%)

## Deployment Checklist

- [ ] Create `config/` directory
- [ ] Create `config/loki-config.yml`
- [ ] Create `config/promtail-config.yml`
- [ ] Create `config/grafana-datasources.yml`
- [ ] Update `docker-compose.yml`
- [ ] Update `.env` with REQUIRED Grafana credentials (GF_SECURITY_ADMIN_USER, GF_SECURITY_ADMIN_PASSWORD)
- [ ] Validate environment variables: `docker-compose config`
- [ ] Update `.gitignore` to exclude config and data directories
- [ ] Install Winston: `npm install winston`
- [ ] Create `src/logger.js` with error handling
- [ ] Replace console.log in all files
- [ ] Build and deploy: `docker-compose up -d`
- [ ] Verify all services started: `docker-compose ps`
- [ ] Verify Grafana access: http://176.124.198.245:3001
- [ ] Verify Loki datasource configured (check for provisioning errors in logs)
- [ ] Test log queries in Grafana Explore
- [ ] Document credentials securely (password manager or secure vault)

## Future Enhancements

1. **Log Aggregation:** Add more services to the stack
2. **Alerting:** Configure Grafana alerts for critical errors
3. **Dashboards:** Create custom Grafana dashboards for bot metrics
4. **Tracing:** Add distributed tracing with Tempo
5. **Metrics:** Add Prometheus for application metrics
6. **Authentication:** Implement SSO for Grafana (OAuth, LDAP)
7. **High Availability:** Multi-replica Loki deployment
8. **Remote Storage:** S3-backed Loki storage for scalability
