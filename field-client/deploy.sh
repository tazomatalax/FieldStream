#!/bin/bash
# Load environment variables from .env file
export $(grep -v '^#' ../.env | xargs)

echo "Deploying field client with DEVICE_ID=${DEVICE_ID} to SERVER_URL=wss://${DOMAIN_NAME}/ws"

docker-compose up --build -d