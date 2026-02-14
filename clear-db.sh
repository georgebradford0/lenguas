#!/bin/bash
set -e

# Configuration
SSH_KEY="$HOME/Documents/lenovo-ideapad.pem"
EC2_HOST="ubuntu@35.88.113.219"

echo "🗑️  Clearing remote database on EC2..."

# Execute command on remote server
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$EC2_HOST" \
  'docker exec language-app-mongo mongosh --quiet --eval "db.getSiblingDB(\"language-app\").dropDatabase()"'

echo "✅ Remote database cleared successfully!"
echo ""
echo "📊 The following collections were dropped:"
echo "   - progress"
echo "   - pronounhistories"
echo ""
echo "🔄 Fresh start! All learning progress has been reset."
