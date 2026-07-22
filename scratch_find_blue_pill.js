const fs = require('fs');
const PNG = require('pngjs').PNG;

const imgPath = 'C:/Users/singl/.gemini/antigravity-ide/brain/177a20a3-368d-4cc3-bcad-e8036ea6cc2a/screenshot_app.png';

fs.createReadStream(imgPath)
    .pipe(new PNG())
    .on('parsed', function() {
        console.log(`Image parsed. Dimensions: ${this.width}x${this.height}`);
        
        const blueRows = new Map();
        
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const idx = (this.width * y + x) << 2;
                const r = this.data[idx];
                const g = this.data[idx + 1];
                const b = this.data[idx + 2];
                
                // Look for blue pill color (e.g., standard Tailwind bg-blue-600 is rgb(37, 99, 235))
                if (b > 200 && r < 100 && g > 50 && g < 150) {
                    blueRows.set(y, (blueRows.get(y) || 0) + 1);
                }
            }
        }
        
        console.log("Blue pixel rows found (Row -> Count):");
        const sortedRows = Array.from(blueRows.entries()).sort((a, b) => b[1] - a[1]);
        sortedRows.slice(0, 20).forEach(([y, count]) => {
            console.log(`Row y = ${y}: ${count} blue pixels`);
        });
    });
