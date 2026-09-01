# Implementation Plan: Docker Containerization

## Overview

This plan implements Docker containerization for the Zvuchi Bot application using a multi-stage build strategy, Docker Compose orchestration, and volume-based database persistence. The implementation adds Docker configuration files without modifying existing application code.

## Tasks

- [ ] 1. Create .dockerignore file
  - Add patterns to exclude node_modules, .env, .git, bot.db, logs, and other development files
  - Optimize build context by excluding unnecessary files
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

- [ ] 2. Implement multi-stage Dockerfile
  - [ ] 2.1 Create build stage with Node.js 22.22.2 base image
    - Set working directory to /app
    - Copy package.json and package-lock.json
    - Run npm ci to install all dependencies
    - Copy application source code
    - _Requirements: 1.1, 1.2, 1.3, 1.6, 1.7_
  
  - [ ] 2.2 Create production stage with Alpine base image
    - Use node:22.22.2-alpine as base image
    - Set working directory to /app
    - Copy package files and run npm ci --only=production
    - Copy runtime files from build stage (src/, index.js)
    - Expose port 3000
    - Define CMD to execute "node index.js"
    - _Requirements: 1.1, 1.4, 1.5, 1.8, 1.9, 9.1, 9.2, 9.3, 9.4, 9.5_

- [ ] 3. Create Docker Compose configuration
  - [ ] 3.1 Write docker-compose.yml file
    - Use Docker Compose format version 3.8
    - Define "zvuchi-bot" service with build context
    - Configure port mapping (3000:3000)
    - Set up bind mount volume (./bot.db:/app/bot.db)
    - Load environment variables from .env file
    - Set restart policy to "unless-stopped"
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.4, 6.1, 7.1, 7.2, 7.3, 7.4_

- [ ] 4. Verify database persistence
  - [ ] 4.1 Test database volume mounting
    - Build and start container with docker-compose
    - Verify /app/bot.db is accessible inside container
    - Stop container and verify ./bot.db persists on host
    - Restart container and verify existing database is loaded
    - _Requirements: 3.1, 3.2, 3.3, 10.1, 10.2, 10.3_

- [ ] 5. Validate environment variable configuration
  - [ ] 5.1 Test required environment variables
    - Verify API_KEY_BOT is read from .env and used by application
    - Verify CRM_EMAIL is read from .env and used by application
    - Verify CRM_API_KEY is read from .env and used by application
    - _Requirements: 5.1, 5.2, 5.3_
  
  - [ ] 5.2 Test optional environment variables
    - Verify HEALTHCHECK_PORT defaults to 3000 when not provided
    - Verify HEALTHCHECK_PORT is respected when provided
    - Verify ALERT_BOT_TOKEN is read when provided
    - Verify ALERT_CHAT_ID is read when provided
    - _Requirements: 5.4, 5.5, 5.6, 5.7_

- [ ] 6. Verify health monitoring access
  - [ ] 6.1 Test healthcheck endpoint accessibility
    - Start container with docker-compose
    - Send GET request to http://localhost:3000/healthcheck from host
    - Verify response contains status, timestamp, and uptime
    - _Requirements: 6.1, 6.2, 6.3_

- [ ] 7. Validate container restart behavior
  - [ ] 7.1 Test automatic restart on failure
    - Simulate application crash inside container
    - Verify container automatically restarts
    - _Requirements: 7.1_
  
  - [ ] 7.2 Test manual stop behavior
    - Stop container with docker-compose stop
    - Verify container does not auto-restart
    - _Requirements: 7.3, 7.4_

- [ ] 8. Verify logging output
  - [ ] 8.1 Test Docker logging integration
    - Start container and generate log output
    - Run docker-compose logs command
    - Verify console.log appears in stdout
    - Verify console.error appears in stderr
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [ ] 9. Validate image optimization
  - [ ] 9.1 Verify multi-stage build efficiency
    - Build Docker image
    - Inspect final image size
    - Verify devDependencies are excluded from production stage
    - Verify only production dependencies are installed
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [ ] 10. Update project documentation
  - [ ] 10.1 Add Docker setup instructions to README.md
    - Document prerequisites (Docker, Docker Compose)
    - Add build and run commands
    - Document environment variable setup
    - Add troubleshooting section
    - _Requirements: All requirements (user-facing documentation)_

- [ ] 11. Checkpoint - Ensure all containers run successfully
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- All Docker configuration files are new additions - no application code changes needed
- The .dockerignore file should be created first to optimize build context
- Testing tasks validate that requirements are met without breaking existing functionality
- Property tests are not applicable for this infrastructure task (no correctness properties defined)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "2.1"] },
    { "id": 1, "tasks": ["2.2", "3.1"] },
    { "id": 2, "tasks": ["4.1", "5.1", "6.1", "8.1", "9.1"] },
    { "id": 3, "tasks": ["5.2", "7.1"] },
    { "id": 4, "tasks": ["7.2", "10.1"] }
  ]
}
```
