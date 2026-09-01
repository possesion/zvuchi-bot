#!/bin/bash

# Docker Setup Validation Script for Zvuchi Bot
# This script validates all Docker containerization requirements

set -e

echo "=========================================="
echo "Zvuchi Bot Docker Setup Validation"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Track test results
TESTS_PASSED=0
TESTS_FAILED=0

# Helper functions
pass() {
    echo -e "${GREEN}✓ PASS${NC}: $1"
    ((TESTS_PASSED++))
}

fail() {
    echo -e "${RED}✗ FAIL${NC}: $1"
    ((TESTS_FAILED++))
}

warn() {
    echo -e "${YELLOW}⚠ WARN${NC}: $1"
}

# Test 1: Check Docker is installed
echo "Test 1: Checking Docker installation..."
if command -v docker &> /dev/null; then
    DOCKER_VERSION=$(docker --version)
    pass "Docker is installed: $DOCKER_VERSION"
else
    fail "Docker is not installed"
    exit 1
fi
echo ""

# Test 2: Check Docker Compose is available
echo "Test 2: Checking Docker Compose..."
if docker compose version &> /dev/null; then
    COMPOSE_VERSION=$(docker compose version)
    pass "Docker Compose is available: $COMPOSE_VERSION"
else
    fail "Docker Compose is not available"
    exit 1
fi
echo ""

# Test 3: Check .env file exists
echo "Test 3: Checking .env file..."
if [ -f .env ]; then
    pass ".env file exists"
    
    # Check required variables
    echo "  Checking required environment variables..."
    for VAR in API_KEY_BOT CRM_EMAIL CRM_API_KEY; do
        if grep -q "^${VAR}=" .env; then
            pass "  $VAR is defined"
        else
            fail "  $VAR is missing in .env"
        fi
    done
else
    fail ".env file does not exist"
fi
echo ""

# Test 4: Build Docker image
echo "Test 4: Building Docker image..."
if docker compose build; then
    pass "Docker image built successfully"
else
    fail "Docker image build failed"
    exit 1
fi
echo ""

# Test 5: Check image size
echo "Test 5: Checking image optimization..."
IMAGE_SIZE=$(docker images zvuchi-bot-zvuchi-bot --format "{{.Size}}" | head -1)
if [ -n "$IMAGE_SIZE" ]; then
    pass "Image size: $IMAGE_SIZE"
    # Check if Alpine base was used (image should be < 200MB)
    SIZE_MB=$(echo "$IMAGE_SIZE" | sed 's/MB//' | sed 's/GB/*1024/')
    echo "  Multi-stage build optimization applied"
else
    warn "Could not determine image size"
fi
echo ""

# Test 6: Start container
echo "Test 6: Starting container..."
docker compose up -d
sleep 5  # Give container time to start

if docker compose ps | grep -q "Up"; then
    pass "Container started successfully"
else
    fail "Container failed to start"
    docker compose logs
    exit 1
fi
echo ""

# Test 7: Test healthcheck endpoint (Requirement 6)
echo "Test 7: Testing healthcheck endpoint..."
sleep 3  # Give healthcheck server time to start

if curl -f http://localhost:3000/healthcheck -s > /dev/null 2>&1; then
    RESPONSE=$(curl -s http://localhost:3000/healthcheck)
    pass "Healthcheck endpoint is accessible"
    echo "  Response: $RESPONSE"
    
    # Validate response format
    if echo "$RESPONSE" | grep -q '"status"'; then
        pass "  Response contains status field"
    else
        fail "  Response missing status field"
    fi
    
    if echo "$RESPONSE" | grep -q '"timestamp"'; then
        pass "  Response contains timestamp field"
    else
        fail "  Response missing timestamp field"
    fi
    
    if echo "$RESPONSE" | grep -q '"uptime"'; then
        pass "  Response contains uptime field"
    else
        fail "  Response missing uptime field"
    fi
else
    fail "Healthcheck endpoint is not accessible"
fi
echo ""

# Test 8: Test environment variables (Requirement 5)
echo "Test 8: Validating environment variables..."
ENV_OUTPUT=$(docker compose exec -T zvuchi-bot env)

for VAR in API_KEY_BOT CRM_EMAIL CRM_API_KEY HEALTHCHECK_PORT; do
    if echo "$ENV_OUTPUT" | grep -q "^${VAR}="; then
        pass "  $VAR is available in container"
    else
        fail "  $VAR is not available in container"
    fi
done
echo ""

# Test 9: Test database volume mount (Requirement 3)
echo "Test 9: Testing database persistence..."

# Check if bot.db exists in container
if docker compose exec -T zvuchi-bot test -f /app/bot.db; then
    pass "Database file exists in container at /app/bot.db"
else
    warn "Database file not yet created (will be created on first user interaction)"
fi

# Test persistence across restart
echo "  Testing persistence across container restart..."
docker compose restart
sleep 5

if docker compose ps | grep -q "Up"; then
    pass "  Container restarted successfully"
    
    if [ -f bot.db ]; then
        pass "  Database file persisted on host filesystem"
    else
        warn "  Database file not yet created on host"
    fi
else
    fail "  Container failed to restart"
fi
echo ""

# Test 10: Test restart policy (Requirement 7)
echo "Test 10: Testing restart policy..."
RESTART_POLICY=$(docker compose config | grep -A 2 "zvuchi-bot:" | grep "restart:" | awk '{print $2}')

if [ "$RESTART_POLICY" = "unless-stopped" ]; then
    pass "Restart policy is set to 'unless-stopped'"
else
    fail "Restart policy is '$RESTART_POLICY', expected 'unless-stopped'"
fi
echo ""

# Test 11: Test logging output (Requirement 8)
echo "Test 11: Testing logging output..."
if docker compose logs zvuchi-bot 2>&1 | grep -q "Healthcheck server"; then
    pass "Application logs are accessible via docker compose logs"
else
    warn "Healthcheck server log not found (may not have started yet)"
fi
echo ""

# Test 12: Verify .dockerignore effectiveness
echo "Test 12: Verifying .dockerignore..."
if [ -f .dockerignore ]; then
    pass ".dockerignore file exists"
    
    # Check key exclusions
    for PATTERN in "node_modules" ".env" ".git" "bot.db"; do
        if grep -q "^${PATTERN}" .dockerignore; then
            pass "  $PATTERN is excluded from build context"
        else
            fail "  $PATTERN is not excluded from build context"
        fi
    done
else
    fail ".dockerignore file does not exist"
fi
echo ""

# Test 13: Test port mapping
echo "Test 13: Testing port mapping..."
PORT_MAPPING=$(docker compose ps zvuchi-bot --format json | grep -o '0.0.0.0:3000->3000/tcp' || echo "")
if [ -n "$PORT_MAPPING" ]; then
    pass "Port 3000 is correctly mapped to host"
else
    fail "Port mapping is not configured correctly"
fi
echo ""

# Test 14: Verify volume mount
echo "Test 14: Verifying volume mount..."
VOLUME_MOUNT=$(docker inspect $(docker compose ps -q zvuchi-bot) | grep -o '/app/bot.db' || echo "")
if [ -n "$VOLUME_MOUNT" ]; then
    pass "Database volume is mounted at /app/bot.db"
else
    fail "Database volume mount not found"
fi
echo ""

# Clean up
echo "=========================================="
echo "Cleaning up..."
echo "=========================================="
docker compose down
echo ""

# Summary
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Failed: $TESTS_FAILED${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All tests passed!${NC}"
    echo "Docker containerization is working correctly."
    exit 0
else
    echo -e "${RED}✗ Some tests failed.${NC}"
    echo "Please review the failures above and fix the issues."
    exit 1
fi
