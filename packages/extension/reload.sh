#!/bin/bash
# Quick reload script for development

echo "🔨 Building extension..."
npm run build -w packages/extension

if [ $? -eq 0 ]; then
    echo "✅ Build successful!"
    echo ""
    echo "📌 To reload the extension:"
    echo "1. Go to chrome://extensions"
    echo "2. Click the 'Update' button (or press Ctrl+R on the extensions page)"
    echo ""
    echo "Or use the reload button on your specific extension card"
else
    echo "❌ Build failed!"
    exit 1
fi