# Design Document: Docker Containerization

## Introduction

This design document specifies the architecture and implementation strategy for containerizing the Zvuchi Bot application using Docker. The containerization approach uses multi-stage builds for image optimization, Docker Compose for orchestration, and volume mounting for database persistence. The design ensures the bot can be deployed consistently across environments while maintaining health monitoring capabilities.

## Architecture Overview

### Container Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Host System                          │
│                                                          │
│  ┌────────────────────────────────────────────────┐    │
│  │           Docker Container                      │    │
│  │                                                 │    │
│  │  ┌──────────────────────────────────────┐     │    │
│  │  │     Node.js Application              │     │    │
│  │  │                                       │     │    │
│  │  │  • index.js (Bot Entry Point)        │     │    │
│  │  │  • handlers.js (Message Handlers)    │     │    │
│  │  │  • database.js (SQLite Operations)   │     │    │
│  │  │  • api.js (AlfaCRM Client)           │     │    │
│  │  │  • healthcheck.js (HTTP Server)      │     │    │
│  │  │  • notifications.js (Cron Scheduler) │     │    │
│  │  └──────────────────────────────────────┘     │    │
│  │                                                 │    │
│  │  ┌──────────────────────────────────────┐     │    │
│  │  │     Runtime Environment              │     │    │
│  │  │                                       │     │    │
│  │  │  • Node.js 22.22.2 (Alpine)          │     │    │
│  │  │  • Production dependencies only       │     │    │
│  │  │  • Environment variables from .env   │     │    │
│  │  └──────────────────────────────────────┘     │    │
│  │                                                 │    │
│  │  Port 3000 ←→ Host Port 3000                  │    │
│  │  /app/bot.db ←→ ./bot.db (Volume)             │    │
│  └────────────────────────────────────────────────┘    │
│                                                          │
│  ┌────────────────────────────────────────────────┐    │
│  │         Persistent Storage                      │    │
│  │                                                 │    │
│  │  ./bot.db (SQLite Database)                    │    │
│  └────────────────────────────────────────────────┘    │
│                                                          │
│  ┌────────────────────────────────────────────────┐    │
│  │         Configuration Files                     │    │
│  │                                                 │    │
│  │  .env (Environment Variables)                  │    │
│  │  docker-compose.yml (Orchestration)            │    │
│  │  Dockerfile (Build Instructions)               │    │
│  │  .dockerignore (Build Context Filter)          │    │
│  └────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### Component Interaction

```
External Systems                Container                 Host System
     │                              │                          │
     │  Telegram API                │                          │
     ├─────────────────────────────>│                          │
     │                              │                          │
     │  AlfaCRM API                 │                          │
     ├─────────────────────────────>│                          │
     │                              │                          │
     │                              │  Volume Mount            │
     │                              │  /app/bot.db            │
     │                              ├─────────────────────────>│
     │                              │                      ./bot.db
     │                              │                          │
     │  Health Monitor              │  Port Mapping            │
     ├─────────────────────────────>│  :3000 -> :3000         │
     │  GET /healthcheck            ├─────────────────────────>│
     │                              │                          │
```

## Dockerfile Design

### Multi-Stage Build Strategy

The Dockerfile uses a two-stage build pattern to optimize the final image size:

1. **Build Stage**: Installs all dependencies (including devDependencies) needed for compilation
2. **Production Stage**: Copies only runtime files and production dependencies

### Build Stage

```dockerfile
FROM node:22.22.2 AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
```

**Purpose**: 
- Install all dependencies from package-lock.json using `npm ci` for reproducible builds
- Copy application source code
- Prepare files for production stage

**Key decisions**:
- Use `npm ci` instead of `npm install` for faster, deterministic installs
- Copy package files first to leverage Docker layer caching
- Include all dependencies for potential build steps

### Production Stage

```dockerfile
FROM node:22.22.2-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/src ./src
COPY --from=builder /app/index.js ./
EXPOSE 3000
CMD ["node", "index.js"]
```

**Purpose**:
- Create minimal production image using Alpine Linux base
- Install only production dependencies
- Copy only necessary runtime files
- Configure container startup

**Key decisions**:
- Use Alpine variant for smaller image size (~40MB savings)
- Exclude devDependencies with `--only=production` flag
- Copy specific files rather than entire build stage
- Expose port 3000 for healthcheck endpoint
- Use CMD with array syntax for proper signal handling

### File Selection Strategy

**Included in production image**:
- `package.json`, `package-lock.json` (dependency manifests)
- `index.js` (application entry point)
- `src/` directory (handlers, database, api, utils, healthcheck, notifications modules)
- Production npm dependencies only

**Excluded from production image**:
- Development dependencies (jest, fast-check)
- Build artifacts
- Git history
- Documentation files
- Local database file (mounted via volume)
- Environment configuration (passed at runtime)

## Docker Compose Configuration

### Service Definition

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
```

### Configuration Components

#### Build Context
- **Context**: Current directory (`.`)
- **Dockerfile**: Default `Dockerfile` in root
- Allows `docker-compose build` to rebuild image locally

#### Port Mapping
- **Host Port**: 3000
- **Container Port**: 3000
- Enables external access to healthcheck endpoint at `http://localhost:3000/healthcheck`

#### Volume Strategy
- **Type**: Bind mount
- **Host Path**: `./bot.db`
- **Container Path**: `/app/bot.db`
- **Purpose**: Persist SQLite database across container restarts

#### Environment Configuration
- **Source**: `.env` file in project root
- **Variables**: API_KEY_BOT, CRM_EMAIL, CRM_API_KEY, HEALTHCHECK_PORT, ALERT_BOT_TOKEN, ALERT_CHAT_ID
- Loaded automatically by Docker Compose

#### Restart Policy
- **Policy**: `unless-stopped`
- **Behavior**: 
  - Restart on failure (non-zero exit code)
  - Restart on system reboot
  - Do not restart if manually stopped via `docker-compose stop`

## Volume Strategy

### Database Persistence

```
Host Filesystem          Container Filesystem
./bot.db    <--->   /app/bot.db
```

### Persistence Guarantees

1. **Container Restart**: Database content survives container stop/start cycles
2. **Image Rebuild**: Database preserved when Docker image is rebuilt
3. **Container Removal**: Database persists even if container is removed (but not volume)
4. **System Reboot**: Database available after host system restart

### Database File Management

The `bot.db` file on the host:
- Will be created automatically by the application if it doesn't exist on first run
- Located in the project root directory
- Owned by host user with appropriate permissions
- Should be included in backup strategies
- Already excluded from git via `.gitignore`

### SQLite Considerations

**Why bind mount works for SQLite**:
- SQLite uses file-based storage (single `bot.db` file)
- No network protocol required
- Direct file I/O through mount
- Atomic write operations supported

**Limitations to be aware of**:
- Performance may be slightly lower than native filesystem
- File locking works but depends on filesystem support
- Not suitable for high-concurrency scenarios (but adequate for this bot)

## Build Context Optimization

### .dockerignore Configuration

```
node_modules
.env
.git
bot.db
data/
npm-debug.log
.DS_Store
README.md
.dockerignore
Dockerfile
docker-compose.yml
.kiro/
.gitignore
```

### Exclusion Rationale

| Pattern | Reason |
|---------|--------|
| `node_modules` | Rebuilt during image build, would duplicate and slow build |
| `.env` | Contains secrets, should never be in image |
| `.git` | Version control not needed in container |
| `bot.db` | Database mounted via volume, not baked into image |
| `data/` | All persistent data excluded from image |
| `npm-debug.log` | Debug logs not relevant to production |
| `.DS_Store` | macOS metadata files |
| `README.md` | Documentation not needed at runtime |
| `.dockerignore`, `Dockerfile`, `docker-compose.yml` | Docker config not needed in image |
| `.kiro/` | Development specs and tasks |
| `.gitignore` | Git config not needed in container |

### Build Performance Impact

Excluding these files:
- Reduces build context size from ~50MB to ~200KB
- Speeds up Docker build by avoiding unnecessary file transfers
- Reduces attack surface by excluding development files
- Prevents accidental secret leakage

## Environment Variable Design

### Required Variables

| Variable | Purpose | Example | Default |
|----------|---------|---------|---------|
| `API_KEY_BOT` | Telegram bot authentication token | `1234567890:ABCdef...` | None (required) |
| `CRM_EMAIL` | AlfaCRM login email | `admin@zvuchi.com` | None (required) |
| `CRM_API_KEY` | AlfaCRM API authentication key | `abc123def456...` | None (required) |
| `HEALTHCHECK_PORT` | HTTP server port for healthcheck | `3000` | `3000` |
| `ALERT_BOT_TOKEN` | Telegram bot token for health alerts | `9876543210:ZYXwvu...` | None (optional) |
| `ALERT_CHAT_ID` | Telegram chat ID for health alerts | `-1001234567890` | None (optional) |

### Configuration Loading

The application uses the `dotenv` package to load environment variables:

```javascript
require('dotenv').config();

const bot = new TelegramBot(process.env.API_KEY_BOT, {
    polling: true
});
```

**Container-specific handling**:
1. Docker Compose reads `.env` file from host
2. Variables passed to container as environment variables
3. Application reads via `process.env`
4. No code changes needed for containerization

### Security Considerations

**Protected secrets**:
- `.env` file excluded from Docker image via `.dockerignore`
- `.env` file excluded from git via `.gitignore`
- Environment variables not logged or displayed

**Deployment recommendations**:
- Use Docker secrets for production (e.g., Docker Swarm secrets)
- Use cloud provider secret management (e.g., AWS Secrets Manager, Azure Key Vault)
- Rotate API keys regularly
- Use least-privilege access for CRM_API_KEY

## Health Monitoring Design

### Healthcheck Endpoint

The application includes an HTTP server that provides a health monitoring endpoint:

```javascript
// src/healthcheck.js
const http = require('http');

const port = process.env.HEALTHCHECK_PORT || 3000;

function startHealthcheckServer() {
    const server = http.createServer((req, res) => {
        if (req.url === '/healthcheck' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                uptime: process.uptime()
            }));
        } else {
            res.writeHead(404);
            res.end();
        }
    });

    server.listen(port, () => {
        console.log(`Healthcheck server listening on port ${port}`);
    });
}
```

### Container Integration

**Port exposure**:
- Dockerfile `EXPOSE 3000` documents the port
- Docker Compose maps `3000:3000` for host access
- External monitoring tools can access `http://localhost:3000/healthcheck`

**Health check response format**:
```json
{
    "status": "healthy",
    "timestamp": "2024-01-15T10:30:00.000Z",
    "uptime": 3600.5
}
```

**Monitoring integration**:
- Docker health check: `HEALTHCHECK CMD curl -f http://localhost:3000/healthcheck || exit 1`
- External monitors: Poll endpoint every 30-60 seconds
- Alerting: Integrate with existing monitoring infrastructure

## Deployment Workflow

### Initial Setup

```bash
# 1. Clone repository
git clone <repository-url>
cd zvuchi-bot

# 2. Create .env file with required variables
cat > .env << EOF
API_KEY_BOT=your_telegram_bot_token
CRM_EMAIL=your_crm_email
CRM_API_KEY=your_crm_api_key
HEALTHCHECK_PORT=3000
ALERT_BOT_TOKEN=your_alert_bot_token
ALERT_CHAT_ID=your_alert_chat_id
EOF

# 3. Build and start container
docker-compose up -d --build
```

### Operational Commands

```bash
# Build image without starting
docker-compose build

# Start container in foreground (see logs)
docker-compose up

# Start container in background
docker-compose up -d

# View logs
docker-compose logs -f zvuchi-bot

# Stop container
docker-compose stop

# Stop and remove container
docker-compose down

# Restart container
docker-compose restart

# Rebuild and restart
docker-compose up -d --build
```

### Update Workflow

```bash
# 1. Pull latest code
git pull origin main

# 2. Rebuild image with new code
docker-compose build

# 3. Restart with new image
docker-compose up -d

# 4. Verify logs
docker-compose logs -f zvuchi-bot
```

### Backup Strategy

```bash
# Backup database
cp bot.db bot.db.backup.$(date +%Y%m%d-%H%M%S)

# Automated backup (cron job)
0 2 * * * cd /path/to/zvuchi-bot && cp bot.db backups/bot.db.$(date +\%Y\%m\%d)
```

### Rollback Procedure

```bash
# 1. Stop current container
docker-compose down

# 2. Restore database backup if needed
cp bot.db.backup.YYYYMMDD bot.db

# 3. Checkout previous version
git checkout <previous-commit-hash>

# 4. Rebuild and start
docker-compose up -d --build
```

## Logging Strategy

### Container Logging

All application logs are written to stdout/stderr and captured by Docker:

```javascript
console.log('Бот запущен...');           // → stdout → docker logs
console.error('Ошибка поллинга: ', e);   // → stderr → docker logs
```

**Log access**:
```bash
# View all logs
docker-compose logs zvuchi-bot

# Follow logs in real-time
docker-compose logs -f zvuchi-bot

# View last 100 lines
docker-compose logs --tail=100 zvuchi-bot

# View logs with timestamps
docker-compose logs -t zvuchi-bot
```

### Log Persistence

Docker logs are stored in:
- **Default location**: `/var/lib/docker/containers/<container-id>/<container-id>-json.log`
- **Log driver**: json-file (default)
- **Rotation**: Not configured by default

**Recommended log rotation** (add to docker-compose.yml):
```yaml
services:
  zvuchi-bot:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

### Structured Logging Recommendations

For production deployments, consider:
- JSON-formatted logs for easier parsing
- Log aggregation service (e.g., ELK stack, Grafana Loki)
- Correlation IDs for tracking requests across components
- Log levels (DEBUG, INFO, WARN, ERROR)

## Error Handling and Recovery

### Restart Policy Behavior

The `unless-stopped` restart policy provides automatic recovery:

| Scenario | Container Behavior |
|----------|-------------------|
| Application crash (exit code > 0) | Automatically restarts |
| System reboot | Automatically starts |
| Manual stop (`docker-compose stop`) | Stays stopped |
| Docker daemon restart | Automatically starts |
| Out of memory error | Restarts after OOM kill |

### Restart Backoff

Docker automatically implements exponential backoff:
- First restart: immediate
- Subsequent restarts: increasing delay (up to 1 minute)
- Prevents rapid restart loops

### Failure Scenarios

**Application crash**:
```
1. Node.js process exits with error
2. Docker detects container exit
3. Docker waits (backoff period)
4. Docker restarts container
5. Application reinitializes
6. Telegram polling resumes
```

**Database corruption**:
```
1. Application fails to open bot.db
2. Container crashes and restarts
3. Issue persists across restarts
4. Manual intervention required:
   - Stop container
   - Restore database from backup
   - Restart container
```

**Network connectivity loss**:
```
1. Telegram API or AlfaCRM unreachable
2. Application logs errors but continues running
3. Automatic retry logic in api.js handles transient failures
4. Bot resumes when connectivity restored
```

## Security Considerations

### Image Security

**Base image selection**:
- Use official Node.js images from Docker Hub
- Alpine variant reduces attack surface (smaller size, fewer packages)
- Pin specific version (22.22.2) to avoid unexpected updates

**Dependency management**:
- `npm ci` ensures reproducible builds
- Lock file (`package-lock.json`) pins dependency versions
- Regular updates via `npm audit fix`

**Least privilege**:
- Container runs as non-root user (Node.js default)
- No unnecessary capabilities required
- Read-only filesystem possible (except /app/bot.db)

### Runtime Security

**Network isolation**:
- Container only exposes port 3000
- No unnecessary network ports open
- Can use Docker networks for service isolation

**Secret management**:
- Environment variables loaded at runtime
- Never baked into image layers
- `.env` file excluded from build context

**File system**:
- Database directory has appropriate permissions
- No world-writable files
- Volume mount restricted to necessary path

### Recommendations for Production

1. **Use Docker secrets** instead of environment variables for sensitive data
2. **Enable Docker Content Trust** to verify image signatures
3. **Scan images** regularly with tools like Trivy or Snyk
4. **Implement network policies** to restrict container communication
5. **Enable audit logging** to track container access and changes
6. **Use read-only root filesystem** where possible
7. **Set resource limits** (CPU, memory) to prevent resource exhaustion

## Performance Considerations

### Image Size Optimization

**Build strategy results**:
- Full image (without multi-stage): ~200MB
- Multi-stage build: ~140MB
- Alpine variant: ~100MB
- Production dependencies only: ~80MB final size

**Optimization techniques applied**:
1. Multi-stage build eliminates build tools
2. Alpine base reduces OS footprint
3. `--only=production` excludes devDependencies
4. `.dockerignore` reduces build context

### Runtime Performance

**Container overhead**:
- Minimal CPU overhead (<1%)
- Memory overhead ~5-10MB for Docker runtime
- Network performance equivalent to host

**SQLite via volume mount**:
- Slight I/O overhead vs native filesystem
- Acceptable for bot workload (low transaction rate)
- Not recommended for high-concurrency scenarios

**Startup time**:
- Cold start: ~2-3 seconds
- Database initialization: ~50ms
- Telegram polling connection: ~1-2 seconds

### Resource Limits (Optional)

Add to docker-compose.yml for resource management:

```yaml
services:
  zvuchi-bot:
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 256M
        reservations:
          cpus: '0.25'
          memory: 128M
```

## Testing Strategy

### Build Verification

```bash
# Test image builds successfully
docker-compose build

# Verify image size
docker images zvuchi-bot

# Inspect image layers
docker history zvuchi-bot

# Check for vulnerabilities
docker scan zvuchi-bot
```

### Runtime Testing

```bash
# Test container starts
docker-compose up -d
docker-compose ps

# Test healthcheck endpoint
curl http://localhost:3000/healthcheck

# Test database persistence
docker-compose exec zvuchi-bot ls -la /app/bot.db

# Test environment variables
docker-compose exec zvuchi-bot env | grep API_KEY_BOT

# Test logs
docker-compose logs zvuchi-bot
```

### Integration Testing

```bash
# Test bot responds to Telegram messages
# (Manual: Send /start to bot via Telegram)

# Test database persists across restart
docker-compose restart
docker-compose exec zvuchi-bot ls -la /app/bot.db

# Test restart on failure
docker-compose exec zvuchi-bot kill 1
docker-compose ps  # Should show restarting/up
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Required Environment Variable Handling

*For any* required environment variable (API_KEY_BOT, CRM_EMAIL, CRM_API_KEY, ALERT_BOT_TOKEN, ALERT_CHAT_ID), when provided to the container, the application SHALL read and use that variable's value.

**Validates: Requirements 5.1, 5.2, 5.3, 5.5, 5.6**

### Property 2: Healthcheck Port Configuration

*For any* valid port number provided via HEALTHCHECK_PORT environment variable, the healthcheck server SHALL listen on that port, and when HEALTHCHECK_PORT is not provided, the server SHALL default to port 3000.

**Validates: Requirements 5.4**

## Implementation Notes

### Development vs Production

**Development setup** (without Docker):
```bash
npm install
npm start
```

**Production setup** (with Docker):
```bash
docker-compose up -d
```

Both use the same codebase with no code changes needed.

### Migration Path

For existing deployments:
1. Ensure `.env` file exists with all required variables
2. Stop existing Node.js process
3. Build Docker image: `docker-compose build`
4. Start container: `docker-compose up -d`
5. Verify bot is running: `docker-compose logs -f`
6. Test healthcheck: `curl http://localhost:3000/healthcheck`

### Troubleshooting Guide

**Container won't start**:
- Check logs: `docker-compose logs zvuchi-bot`
- Verify .env file exists and has correct values
- Check port 3000 is not already in use: `lsof -i :3000`

**Database errors**:
- Verify bot.db file permissions
- Check bot.db is not locked by another process
- Restore from backup if corrupted

**Healthcheck failing**:
- Verify port mapping in docker-compose.yml
- Check HEALTHCHECK_PORT environment variable
- Test from inside container: `docker-compose exec zvuchi-bot curl localhost:3000/healthcheck`

**Bot not responding**:
- Verify API_KEY_BOT is correct
- Check Telegram API connectivity
- Review logs for polling errors
- Verify network connectivity from container

## Conclusion

This design provides a robust containerization strategy for the Zvuchi Bot that:
- ✅ Optimizes image size through multi-stage builds
- ✅ Ensures database persistence across container lifecycle
- ✅ Provides health monitoring for operational visibility
- ✅ Implements automatic restart for high availability
- ✅ Follows Docker best practices for security and performance
- ✅ Maintains compatibility with existing codebase
- ✅ Supports easy deployment and operational management

The implementation requires no application code changes, only the addition of Docker configuration files (Dockerfile, docker-compose.yml, .dockerignore).
