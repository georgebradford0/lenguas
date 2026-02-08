#!/bin/bash
set -e

# Configuration
SSH_KEY="$HOME/Documents/lenovo-ideapad.pem"
EC2_HOST="ubuntu@35.88.113.219"
REMOTE_DIR="/home/ubuntu/language-app"
LOCAL_DIR="/Users/georgebalch/language-app"
SSH_CMD="ssh -i $SSH_KEY -o StrictHostKeyChecking=no"
SCP_CMD="scp -i $SSH_KEY -o StrictHostKeyChecking=no"
RSYNC_CMD="rsync -avz -e \"ssh -i $SSH_KEY -o StrictHostKeyChecking=no\""

echo "🚀 Deploying Language App to AWS EC2..."

# Check if OPENAI_API_KEY is set
if [ -z "$OPENAI_API_KEY" ]; then
    echo "❌ Error: OPENAI_API_KEY environment variable is not set"
    echo "Please set it with: export OPENAI_API_KEY='your-key-here'"
    exit 1
fi

echo "📦 Step 1: Creating remote directory..."
$SSH_CMD $EC2_HOST "mkdir -p $REMOTE_DIR"

echo "📤 Step 2: Copying files to EC2..."
# Copy API directory
rsync -avz --exclude='node_modules' --exclude='.git' \
    -e "ssh -i $SSH_KEY -o StrictHostKeyChecking=no" \
    $LOCAL_DIR/api $EC2_HOST:$REMOTE_DIR/

# Copy docker-compose file
$SCP_CMD $LOCAL_DIR/docker-compose.prod.yml $EC2_HOST:$REMOTE_DIR/docker-compose.yml

echo "🔧 Step 3: Creating .env file on remote server..."
$SSH_CMD $EC2_HOST "cat > $REMOTE_DIR/.env << EOF
OPENAI_API_KEY=$OPENAI_API_KEY
AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID:-}
AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY:-}
AWS_REGION=${AWS_REGION:-us-east-1}
EOF"

echo "🐳 Step 4: Building and starting Docker containers..."
$SSH_CMD $EC2_HOST "cd $REMOTE_DIR && docker compose down && docker compose up -d --build"

echo "⏳ Step 5: Waiting for services to start..."
sleep 10

echo "✅ Step 6: Checking service status..."
$SSH_CMD $EC2_HOST "cd $REMOTE_DIR && docker compose ps"

echo ""
echo "✨ Deployment complete!"
echo ""
echo "🌐 API URL: http://35.88.113.219:3000"
echo "📊 Health check: http://35.88.113.219:3000/health"
echo "📈 Tier stats: http://35.88.113.219:3000/tier-stats"
echo ""
echo "📝 Useful commands:"
echo "  View logs:    ssh -i $SSH_KEY $EC2_HOST 'cd $REMOTE_DIR && docker compose logs -f'"
echo "  Restart:      ssh -i $SSH_KEY $EC2_HOST 'cd $REMOTE_DIR && docker compose restart'"
echo "  Stop:         ssh -i $SSH_KEY $EC2_HOST 'cd $REMOTE_DIR && docker compose down'"
echo "  Shell (API):  ssh -i $SSH_KEY $EC2_HOST 'docker exec -it language-app-api sh'"
echo "  Shell (DB):   ssh -i $SSH_KEY $EC2_HOST 'docker exec -it language-app-mongo mongosh language-app'"
