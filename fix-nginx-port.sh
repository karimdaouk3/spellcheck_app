#!/bin/bash
# Fix Nginx Configuration - Update proxy_pass from port 8055 to 5000
# This script updates nginx config files to point to the correct Docker container port

set -e

echo "🔧 Fixing Nginx Configuration"
echo "============================"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Detect if we need sudo
if [ ! -w "/etc/nginx" ]; then
    SUDO_CMD="sudo"
    echo "Using sudo for nginx configuration files"
else
    SUDO_CMD=""
fi

# Find nginx config files that might have port 8055
CONFIG_FILES=(
    "/etc/nginx/conf.d/fsrcoach-dev.conf"
    "/etc/nginx/sites-available/fsrcoach-dev"
    "/etc/nginx/sites-enabled/fsrcoach-dev"
    "/etc/nginx/nginx.conf"
)

FILES_UPDATED=0
BACKUP_DIR="/tmp/nginx-backup-$(date +%Y%m%d-%H%M%S)"

echo "Creating backup directory: $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"

for config_file in "${CONFIG_FILES[@]}"; do
    if [ -f "$config_file" ]; then
        echo ""
        echo "Checking: $config_file"
        
        # Check if file contains port 8055
        if grep -q "8055\|:8055" "$config_file" 2>/dev/null; then
            echo -e "${YELLOW}⚠️  Found port 8055 in $config_file${NC}"
            
            # Create backup
            $SUDO_CMD cp "$config_file" "$BACKUP_DIR/$(basename $config_file).backup"
            echo "   Backup created: $BACKUP_DIR/$(basename $config_file).backup"
            
            # Show what will be changed
            echo "   Current proxy_pass lines:"
            grep -n "proxy_pass.*8055\|:8055" "$config_file" 2>/dev/null | sed 's/^/     /' || true
            
            # Update the file
            if $SUDO_CMD sed -i 's/127\.0\.0\.1:8055/localhost:5000/g; s/:8055/:5000/g' "$config_file" 2>/dev/null; then
                echo -e "${GREEN}✅ Updated $config_file${NC}"
                FILES_UPDATED=$((FILES_UPDATED + 1))
                
                # Show what changed
                echo "   Updated proxy_pass lines:"
                grep -n "proxy_pass.*5000\|:5000" "$config_file" 2>/dev/null | sed 's/^/     /' || true
            else
                echo -e "${RED}❌ Failed to update $config_file${NC}"
                echo "   You may need to edit it manually"
            fi
        else
            echo -e "${GREEN}✅ No port 8055 found in $config_file${NC}"
        fi
    else
        echo "   File not found: $config_file (skipping)"
    fi
done

echo ""
echo "====================================="
echo "Summary"
echo "====================================="

if [ $FILES_UPDATED -gt 0 ]; then
    echo -e "${GREEN}✅ Updated $FILES_UPDATED file(s)${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Test nginx configuration:"
    echo "     $SUDO_CMD nginx -t"
    echo ""
    echo "  2. If test passes, reload nginx:"
    echo "     $SUDO_CMD systemctl reload nginx"
    echo ""
    echo "  3. Verify the changes:"
    echo "     ./check-nginx-config.sh"
    echo ""
    echo "Backups saved in: $BACKUP_DIR"
    echo "   (You can restore with: $SUDO_CMD cp $BACKUP_DIR/*.backup /etc/nginx/...)"
else
    echo -e "${YELLOW}⚠️  No files were updated${NC}"
    echo "   Either port 8055 was not found, or files don't exist"
    echo ""
    echo "You may need to manually edit your nginx config files."
    echo "Look for lines like:"
    echo "   proxy_pass http://127.0.0.1:8055;"
    echo "And change to:"
    echo "   proxy_pass http://localhost:5000;"
fi

echo ""

