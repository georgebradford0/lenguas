#!/bin/bash
docker exec language-app-mongo-1 mongosh --quiet --eval 'db.getSiblingDB("language-app").dropDatabase()'
echo "Database cleared."
