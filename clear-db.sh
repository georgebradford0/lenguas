#!/bin/bash
set -e

# Configuration
SSH_KEY="$HOME/Documents/lenovo-ideapad.pem"
EC2_HOST="ubuntu@35.88.113.219"

# Parse language argument
LANGUAGE_NAME="${1:-}"

case "${LANGUAGE_NAME,,}" in
  dutch)    LANG_CODE="nl" ;;
  german)   LANG_CODE="de" ;;
  french)   LANG_CODE="fr" ;;
  spanish)  LANG_CODE="es" ;;
  "")
    echo "Usage: $0 <language>"
    echo "  Languages: Dutch, German, French, Spanish"
    echo ""
    echo "  To clear ALL languages, run without argument is not supported."
    echo "  Specify a language to clear only that language's progress."
    exit 1
    ;;
  *)
    echo "❌ Unknown language: $1"
    echo "   Valid options: Dutch, German, French, Spanish"
    exit 1
    ;;
esac

echo "🗑️  Clearing $LANGUAGE_NAME (${LANG_CODE}) progress on EC2..."

ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$EC2_HOST" \
  "docker exec language-app-mongo mongosh --quiet --eval \"db.getSiblingDB('language-app').progress.deleteMany({ language: '${LANG_CODE}' })\""

echo "✅ ${LANGUAGE_NAME} (${LANG_CODE}) progress cleared successfully!"
echo ""
echo "🔄 Fresh start for ${LANGUAGE_NAME}! All learning progress has been reset."
