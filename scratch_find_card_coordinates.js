const fs = require('fs');
const PNG = require('pngjs').PNG;

const imgPath = 'C:/Users/singl/.gemini/antigravity-ide/brain/177a20a3-368d-4cc3-bcad-e8036ea6cc2a/screenshot_app.png';

fs.createReadStream(imgPath)
    .pipe(new PNG())
    .on('parsed', function() {
        console.log(`Image size: ${this.width}x${this.height}`);
        
        console.log("y | x=280 RGB | x=800 RGB");
        console.log("------------------------");
        for (let y = 800; y < 1400; y += 20) {
            const idx1 = (this.width * y + 280) << 2;
            const r1 = this.data[idx1];
            const g1 = this.data[idx1 + 1];
            const b1 = this.data[idx1 + 2];
            
            const idx2 = (this.width * y + 800) << 2;
            const r2 = this.data[idx2];
            const g2 = this.data[idx2 + 1];
            const b2 = this.data[idx2 + 2];
            
            console.log(`${y} | ${r1},${g1},${b1} | ${r2},${g2},${b2}`);
        }
    });
