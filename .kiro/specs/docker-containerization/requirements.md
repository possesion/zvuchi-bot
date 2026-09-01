# Requirements Document

## Introduction

This document specifies requirements for containerizing the Zvuchi Bot application using Docker. The containerization enables consistent deployment across different environments, ensures data persistence, and provides health monitoring capabilities through a dedicated HTTP endpoint.

## Glossary

- **Dockerfile**: A text file containing instructions for building a Docker image
- **Docker_Image**: An executable package that includes application code, runtime, libraries, and dependencies
- **Docker_Container**: A running instance of a Docker image
- **Docker_Compose**: A tool for defining and running multi-container Docker applications using YAML configuration
- **Multi_Stage_Build**: A Docker build pattern using multiple FROM statements to optimize final image size
- **Volume**: A Docker mechanism for persisting data generated and used by containers
- **Bind_Mount**: A Docker volume type that mounts a host directory into a container
- **Container_Registry**: A repository for storing and distributing Docker images
- **Healthcheck_Endpoint**: An HTTP endpoint that reports application health status
- **Environment_Variables**: Configuration parameters passed to the container at runtime
- **Restart_Policy**: A Docker configuration that controls container restart behavior after failures or system reboots
- **Dockerignore_File**: A file specifying which files and directories should be excluded from the Docker build context
- **Base_Image**: The starting Docker image upon which the application image is built
- **Build_Context**: The set of files and directories available to the Docker build process

## Requirements

### Requirement 1: Dockerfile Creation

**User Story:** As a DevOps engineer, I want a Dockerfile that defines the container build process, so that I can create consistent and reproducible Docker images.

#### Acceptance Criteria

1. THE Dockerfile SHALL use Node.js version 22.22.2 as the Base_Image
2. THE Dockerfile SHALL implement a Multi_Stage_Build pattern with at least two stages
3. THE Dockerfile SHALL include a build stage that installs all dependencies from package.json
4. THE Dockerfile SHALL include a production stage that copies only necessary runtime files
5. THE Dockerfile SHALL set the working directory to /app within the Docker_Container
6. THE Dockerfile SHALL copy package.json and package-lock.json before installing dependencies
7. THE Dockerfile SHALL run npm ci for dependency installation
8. THE Dockerfile SHALL expose port 3000 for the Healthcheck_Endpoint
9. THE Dockerfile SHALL define CMD instruction to execute "node index.js"

### Requirement 2: Docker Compose Configuration

**User Story:** As a DevOps engineer, I want a Docker Compose file to orchestrate the bot service, so that I can manage the application lifecycle with simple commands.

#### Acceptance Criteria

1. THE Docker_Compose SHALL define a service named "zvuchi-bot"
2. THE Docker_Compose SHALL specify the build context pointing to the current directory
3. THE Docker_Compose SHALL map host port 3000 to container port 3000
4. THE Docker_Compose SHALL configure a Bind_Mount volume mapping ./bot.db to /app/bot.db
5. THE Docker_Compose SHALL set the Restart_Policy to "unless-stopped"
6. THE Docker_Compose SHALL load Environment_Variables from a .env file
7. THE Docker_Compose SHALL use Docker Compose file format version 3.8 or higher

### Requirement 3: Database Persistence

**User Story:** As a system administrator, I want the SQLite database to persist across container restarts, so that user data is not lost during deployments or failures.

#### Acceptance Criteria

1. THE Docker_Container SHALL mount bot.db from a host directory to /app/bot.db
2. WHEN the Docker_Container stops, THE Volume SHALL retain all database content
3. WHEN the Docker_Container starts, THE Application SHALL access the existing bot.db file from the Volume
4. THE Volume mount point SHALL be ./bot.db on the host filesystem

### Requirement 4: Build Context Optimization

**User Story:** As a DevOps engineer, I want to exclude unnecessary files from the Docker build context, so that image builds are faster and more secure.

#### Acceptance Criteria

1. THE Dockerignore_File SHALL exclude node_modules directory from the Build_Context
2. THE Dockerignore_File SHALL exclude .env file from the Build_Context
3. THE Dockerignore_File SHALL exclude .git directory from the Build_Context
4. THE Dockerignore_File SHALL exclude bot.db file from the Build_Context
5. THE Dockerignore_File SHALL exclude npm-debug.log files from the Build_Context
6. THE Dockerignore_File SHALL exclude .DS_Store files from the Build_Context
7. THE Dockerignore_File SHALL exclude README.md from the Build_Context

### Requirement 5: Environment Configuration

**User Story:** As a DevOps engineer, I want to pass environment variables to the container, so that I can configure the bot without rebuilding the image.

#### Acceptance Criteria

1. THE Docker_Container SHALL support API_KEY_BOT environment variable for Telegram bot token
2. THE Docker_Container SHALL support CRM_EMAIL environment variable for AlfaCRM authentication
3. THE Docker_Container SHALL support CRM_API_KEY environment variable for AlfaCRM authentication
4. THE Docker_Container SHALL support HEALTHCHECK_PORT environment variable with default value 3000
5. THE Docker_Container SHALL support ALERT_BOT_TOKEN environment variable for health monitoring alerts
6. THE Docker_Container SHALL support ALERT_CHAT_ID environment variable for health monitoring alerts
7. WHEN Environment_Variables are not provided, THE Application SHALL use default values where applicable

### Requirement 6: Health Monitoring Access

**User Story:** As a system administrator, I want to access the health check endpoint from outside the container, so that I can monitor bot availability.

#### Acceptance Criteria

1. THE Docker_Container SHALL expose port 3000 to the host system
2. WHEN a GET request is sent to http://localhost:3000/healthcheck, THE Healthcheck_Endpoint SHALL respond
3. THE port mapping SHALL allow external monitoring systems to access the Healthcheck_Endpoint

### Requirement 7: Container Restart Behavior

**User Story:** As a system administrator, I want the container to restart automatically after failures, so that the bot maintains high availability.

#### Acceptance Criteria

1. WHEN the Docker_Container exits with a non-zero status code, THE Docker_Compose SHALL restart the Docker_Container automatically
2. WHEN the host system reboots, THE Docker_Compose SHALL start the Docker_Container automatically
3. WHEN the container is manually stopped using docker-compose stop, THE Docker_Compose SHALL NOT restart the Docker_Container
4. THE Restart_Policy SHALL be configured as "unless-stopped"

### Requirement 8: Logging Output

**User Story:** As a DevOps engineer, I want container logs to be accessible through Docker commands, so that I can troubleshoot issues.

#### Acceptance Criteria

1. THE Docker_Container SHALL write all console.log output to standard output
2. THE Docker_Container SHALL write all console.error output to standard error
3. WHEN docker-compose logs command is executed, THE Docker_Compose SHALL display Application logs
4. THE Application SHALL maintain existing logging behavior from index.js and healthcheck.js

### Requirement 9: Image Size Optimization

**User Story:** As a DevOps engineer, I want the final Docker image to be as small as possible, so that deployments are faster and storage costs are reduced.

#### Acceptance Criteria

1. THE Dockerfile SHALL use a Multi_Stage_Build to separate build dependencies from runtime dependencies
2. THE production stage SHALL copy only package.json, package-lock.json, and application source files
3. THE production stage SHALL run npm ci --only=production to install only production dependencies
4. THE Dockerfile SHALL NOT include development dependencies in the final Docker_Image
5. THE Dockerfile SHALL use node:22.22.2-alpine as the Base_Image for the production stage

### Requirement 10: Database File Creation

**User Story:** As a system administrator, I want the database file to be created automatically if it doesn't exist, so that the container can start without manual setup.

#### Acceptance Criteria

1. WHEN the Docker_Container starts and bot.db does not exist, THE Application SHALL create bot.db on first run
2. THE bot.db file SHALL have appropriate permissions for the Docker_Container to read and write
3. THE Application SHALL initialize the database schema when creating bot.db for the first time
