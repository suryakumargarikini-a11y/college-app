const fs = require('fs');
const PNG = require('pngjs').PNG;

const imgPath = 'C:/Users/singl/.gemini/antigravity-ide/brain/177a20a3-368d-4cc3-bcad-e8036ea6cc2a/screenshot_app.png';

fs.createReadStream(imgPath)
    .pipe(new PNG())
    .on('parsed', function() {
        console.log(`Image size: ${this.width}x${this.height}`);
        
        let minX = this.width;
        let maxX = 0;
        let minY = this.height;
        let maxY = 0;
        
        // The dock is in the bottom area: y from 2100 to 2300
        for (let y = 2100; y < 2300; y++) {
            for (let x = 0; x < this.width; x++) {
                const idx = (this.width * y + x) << 2;
                const r = this.data[idx];
                const g = this.data[idx + 1];
                const b = this.data[idx + 2];
                
                // Dock is a high-contrast white pill.
                // Let's check for white pixels: r > 245, g > 245, b > 245
                if (r > 245 && g > 245 && b > 245) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }
        
        console.log(`White dock limits: x=[${minX}, ${maxX}] (width=${maxX - minX}), y=[${minY}, ${maxY}] (height=${maxY - minY})`);
        
        // Let's divide this horizontal range into 5 equal columns to find the centers of the 5 dock items!
        const dockWidth = maxX - minX;
        const itemWidth = dockWidth / 5;
        console.log("Centers of the 5 items:");
        for (let i = 0; i < 5; i++) {
            const centerX = Math.round(minX + itemWidth * (i + 0.5));
            const centerY = Math.round(minY + (maxY - minY) / 2);
            console.log(`Item ${i + 1}: x = ${centerX}, y = ${centerY}`);
        }
    });
