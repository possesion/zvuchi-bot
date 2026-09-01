# Docker Containerization Validation

This document describes the validation tests for the Docker containerization implementation.

## Automated Test Script

Run the automated test script to validate all requirements:

```bash
./test-docker.sh
```

This script validates:
- Docker and Docker Compose installation
- Environment variable configuration
- Image build process
- Container startup
- Healthcheck endpoint accessibility
- Database volume persistence
- Restart policy configuration
- Logging output
- Port mapping
- .dockerignore effectiveness

## Manual Validation Steps

### Task 4: Database Persistence Across Container Lifecycle

**Objective**: Verify that the SQLite database persists across container restarts (Requirements 3.1, 3.2, 3.3, 10.1, 10.2, 10.3)

**Steps**:
1. Start the container:
   ```bash
   docker compose up -d
   ```

2. Send a message to the bot via Telegram to trigger database creation

3. Verify database exists in container:
   ```bash
   docker compose exec zvuchi-bot ls -la /app/bot.db
   ```

4. Verify database exists on host:
   ```bash
   ls -la bot.db
   ```

5. Stop the container:
   ```bash
   docker compose stop
   ```

6. Verify database still exists on host:
   ```bash
   ls -la bot.db
   ```

7. Restart container:
   ```bash
   docker compose start
   ```

8. Verify database is still accessible:
   ```bash
   docker compose exec zvuchi-bot ls -la /app/bot.db
   ```

9. Check that previous data is preserved by querying the bot

**Expected Results**:
- ✓ Database file created on first user interaction
- ✓ Database persists on host filesystem after container stop
- ✓ Database reloaded when container restarts
- ✓ Previous user data (phone numbers) is preserved

**Status**: ✅ Configuration verified (requires live testing with actual bot token)

---

### Task 5: Environment Variable Configuration

**Objective**: Validate all environment variables are correctly passed to the container (Requirements 5.1-5.7)

#### Test 5.1: Required Environment Variables

**Steps**:
1. Ensure `.env` file contains:
   ```env
   API_KEY_BOT=test_token
   CRM_EMAIL=test@example.com
   CRM_API_KEY=test_key
   ```

2. Start container:
   ```bash
   docker compose up -d
   ```

3. Verify variables are available:
   ```bash
   docker compose exec zvuchi-bot env | grep -E "API_KEY_BOT|CRM_EMAIL|CRM_API_KEY"
   ```

**Expected Results**:
- ✓ API_KEY_BOT is set in container
- ✓ CRM_EMAIL is set in container
- ✓ CRM_API_KEY is set in container

#### Test 5.2: Optional Environment Variables

**Test 5.2a: HEALTHCHECK_PORT default value**

**Steps**:
1. Remove HEALTHCHECK_PORT from `.env` if present
2. Restart container:
   ```bash
   docker compose restart
   ```
3. Check healthcheck endpoint:
   ```bash
   curl http://localhost:3000/healthcheck
   ```

**Expected Result**:
- ✓ Healthcheck responds on port 3000 (default)

**Test 5.2b: HEALTHCHECK_PORT custom value**

**Steps**:
1. Add to `.env`:
   ```env
   HEALTHCHECK_PORT=3001
   ```
2. Update docker-compose.yml port mapping to "3001:3001"
3. Restart container:
   ```bash
   docker compose up -d
   ```
4. Check healthcheck endpoint:
   ```bash
   curl http://localhost:3001/healthcheck
   ```

**Expected Result**:
- ✓ Healthcheck responds on custom port 3001

**Test 5.2c: Alert variables**

**Steps**:
1. Add to `.env`:
   ```env
   ALERT_BOT_TOKEN=alert_token
   ALERT_CHAT_ID=-1001234567890
   ```
2. Restart container:
   ```bash
   docker compose restart
   ```
3. Verify variables:
   ```bash
   docker compose exec zvuchi-bot env | grep -E "ALERT_BOT_TOKEN|ALERT_CHAT_ID"
   ```

**Expected Results**:
- ✓ ALERT_BOT_TOKEN is set in container
- ✓ ALERT_CHAT_ID is set in container

**Status**: ✅ Configuration verified (requires live testing)

---

### Task 6: Healthcheck Endpoint Accessibility

**Objective**: Verify the healthcheck endpoint is accessible from the host system (Requirements 6.1, 6.2, 6.3)

**Steps**:
1. Start container:
   ```bash
   docker compose up -d
   ```

2. Wait for healthcheck server to start (3-5 seconds)

3. Send GET request from host:
   ```bash
   curl http://localhost:3000/healthcheck
   ```

4. Verify response format:
   ```bash
   curl -s http://localhost:3000/healthcheck | jq .
   ```

5. Test from inside container:
   ```bash
   docker compose exec zvuchi-bot curl localhost:3000/healthcheck
   ```

**Expected Results**:
- ✓ Port 3000 is exposed to host
- ✓ GET request returns HTTP 200
- ✓ Response contains:
  ```json
  {
    "status": "healthy",
    "timestamp": "2024-01-15T10:30:00.000Z",
    "uptime": 123.45
  }
  ```
- ✓ Accessible from both host and inside container

**Status**: ✅ Configuration verified (requires live testing)

---

### Task 7: Container Restart Behavior

**Objective**: Validate the restart policy works as expected (Requirements 7.1, 7.2, 7.3, 7.4)

#### Test 7.1: Automatic Restart on Failure

**Steps**:
1. Start container:
   ```bash
   docker compose up -d
   ```

2. Find the main Node.js process PID:
   ```bash
   docker compose exec zvuchi-bot ps aux
   ```

3. Kill the process to simulate crash:
   ```bash
   docker compose exec zvuchi-bot kill -9 1
   ```

4. Wait 5 seconds and check container status:
   ```bash
   docker compose ps
   ```

5. Verify container restarted:
   ```bash
   docker compose logs --tail=20 zvuchi-bot
   ```

**Expected Results**:
- ✓ Container automatically restarts after crash
- ✓ Status shows "Up" after restart
- ✓ Application initializes successfully
- ✓ Logs show restart event

#### Test 7.2: Manual Stop Behavior

**Steps**:
1. Stop container manually:
   ```bash
   docker compose stop
   ```

2. Check container status:
   ```bash
   docker compose ps
   ```

3. Wait 30 seconds and check again:
   ```bash
   docker compose ps
   ```

**Expected Results**:
- ✓ Container stops successfully
- ✓ Status shows "Exited"
- ✓ Container does NOT auto-restart
- ✓ Status remains "Exited" after waiting

#### Test 7.3: System Reboot Simulation

**Steps**:
1. Start container:
   ```bash
   docker compose up -d
   ```

2. Restart Docker daemon (simulates system reboot):
   ```bash
   # On macOS: Restart Docker Desktop from menu
   # On Linux: sudo systemctl restart docker
   ```

3. Check container status after Docker restarts:
   ```bash
   docker compose ps
   ```

**Expected Results**:
- ✓ Container automatically starts when Docker daemon restarts
- ✓ Status shows "Up"
- ✓ Application is running normally

**Status**: ✅ Configuration verified (requires live testing)

---

## Requirements Coverage

### Requirement 1: Dockerfile Creation ✅
- [x] 1.1 Uses Node.js 22.12.0 as base image
- [x] 1.2 Implements multi-stage build (builder + production)
- [x] 1.3 Build stage installs all dependencies
- [x] 1.4 Production stage copies only runtime files
- [x] 1.5 Working directory set to /app
- [x] 1.6 Package files copied before dependencies
- [x] 1.7 Uses npm ci for installation
- [x] 1.8 Exposes port 3000
- [x] 1.9 CMD executes "node index.js"

### Requirement 2: Docker Compose Configuration ✅
- [x] 2.1 Service named "zvuchi-bot"
- [x] 2.2 Build context points to current directory
- [x] 2.3 Port mapping 3000:3000
- [x] 2.4 Volume mount ./bot.db:/app/bot.db
- [x] 2.5 Restart policy "unless-stopped"
- [x] 2.6 Loads environment from .env file
- [x] 2.7 Uses Docker Compose format (v2, version field removed per deprecation)

### Requirement 3: Database Persistence ✅
- [x] 3.1 Database mounted from host to /app/bot.db
- [x] 3.2 Volume retains data when container stops
- [x] 3.3 Application accesses existing database on start
- [x] 3.4 Volume mount point is ./bot.db on host

### Requirement 4: Build Context Optimization ✅
- [x] 4.1 node_modules excluded
- [x] 4.2 .env excluded
- [x] 4.3 .git excluded
- [x] 4.4 bot.db excluded
- [x] 4.5 npm-debug.log excluded
- [x] 4.6 .DS_Store excluded
- [x] 4.7 README.md excluded

### Requirement 5: Environment Configuration ✅
- [x] 5.1 API_KEY_BOT supported
- [x] 5.2 CRM_EMAIL supported
- [x] 5.3 CRM_API_KEY supported
- [x] 5.4 HEALTHCHECK_PORT supported with default 3000
- [x] 5.5 ALERT_BOT_TOKEN supported
- [x] 5.6 ALERT_CHAT_ID supported
- [x] 5.7 Default values used when variables not provided

### Requirement 6: Health Monitoring Access ✅
- [x] 6.1 Port 3000 exposed to host
- [x] 6.2 Healthcheck responds to GET requests
- [x] 6.3 Port mapping allows external monitoring

### Requirement 7: Container Restart Behavior ✅
- [x] 7.1 Auto-restart on non-zero exit
- [x] 7.2 Auto-start on system reboot
- [x] 7.3 No restart when manually stopped
- [x] 7.4 Restart policy set to "unless-stopped"

### Requirement 8: Logging Output ✅
- [x] 8.1 console.log to stdout
- [x] 8.2 console.error to stderr
- [x] 8.3 Logs accessible via docker compose logs
- [x] 8.4 Maintains existing logging behavior

### Requirement 9: Image Size Optimization ✅
- [x] 9.1 Multi-stage build separates build/runtime deps
- [x] 9.2 Production stage copies only necessary files
- [x] 9.3 npm ci --only=production in production stage
- [x] 9.4 Development dependencies excluded
- [x] 9.5 Alpine base image used for production

### Requirement 10: Database File Creation ✅
- [x] 10.1 Database created automatically if missing
- [x] 10.2 Appropriate permissions for read/write
- [x] 10.3 Schema initialized on first run

## Summary

**Configuration Status**: ✅ **COMPLETE**

All Docker configuration files have been created and validated:
- ✅ Dockerfile with multi-stage build
- ✅ docker-compose.yml with proper orchestration
- ✅ .dockerignore for build optimization
- ✅ README.md with comprehensive documentation
- ✅ test-docker.sh automated validation script

**Testing Status**: ⏳ **Requires Live Environment**

The configuration meets all requirements. However, full end-to-end testing requires:
1. Working Docker environment (currently has networking issues)
2. Valid Telegram bot token
3. Valid AlfaCRM credentials

**Next Steps**:
1. Fix Docker networking issues on the host machine
2. Run `./test-docker.sh` to validate the setup
3. Test with actual bot credentials
4. Verify all manual test cases listed above
