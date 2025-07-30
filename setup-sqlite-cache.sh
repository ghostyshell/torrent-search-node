#!/bin/bash

# SQLite Cache Migration Setup Script
# This script sets up the new SQLite-based caching system

echo "🚀 Setting up SQLite Cache System for Torrent Search..."

# Backend Setup
echo "📦 Installing backend dependencies..."
cd Torrent-Search-API
npm install
cd ..

# Frontend Setup
echo "🎨 Installing frontend dependencies..."
cd torrent-browse-ui
npm install
cd ..

# Create cache directory
echo "📁 Creating cache directory..."
mkdir -p Torrent-Search-API/cache

# Set permissions
echo "🔐 Setting permissions..."
chmod 755 Torrent-Search-API/cache

echo "✅ Setup complete!"
echo ""
echo "🔧 Next steps:"
echo "1. Start the backend: cd Torrent-Search-API && npm start"
echo "2. Start the frontend: cd torrent-browse-ui && npm start"
echo "3. The SQLite database will be created automatically on first use"
echo ""
echo "🗄️ Features:"
echo "- Persistent cover image caching with SQLite backend"
echo "- Hybrid localStorage + SQLite for better performance"
echo "- Automatic cache cleanup and management"
echo "- Enhanced development tools for debugging"
echo ""
echo "📊 Development tools:"
echo "- Backend: Check http://localhost:3001/api/cache/stats"
echo "- Frontend: Use cacheManager.getStats() in browser console"
