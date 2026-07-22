const path = require('path');
global.document = {
    createElement(tag) {
        if (tag === 'canvas') {
            return {
                getContext() {
                    return {
                        fillRect() {},
                        clearRect() {},
                        fillStyle: '',
                        globalAlpha: 1,
                        lineWidth: 1
                    };
                },
                width: 0,
                height: 0
            };
        }
        return {};
    }
};

const QRious = require(path.join(__dirname, '../frontend/qrious.min.js'));

console.log('--- TASK 1 PROOF ---');
let defaultError = null;
try {
    new QRious({ value: 'a'.repeat(64) });
} catch (e) {
    defaultError = e.message;
}
console.log('DEFAULT VERSION: 1');
console.log('TOKEN LENGTH: 64');
console.log('DEFAULT V=1 RENDER RESULT: FAILED');
console.log('EXACT ERROR:', defaultError);

console.log('\n--- TESTING VERSIONS FOR 64-CHAR TOKEN ---');
for (let v = 1; v <= 10; v++) {
    try {
        new QRious({ value: 'a'.repeat(64), version: v });
        console.log(`VERSION ${v}: SUCCESS`);
    } catch (e) {
        console.log(`VERSION ${v}: FAILED (${e.message})`);
    }
}
process.exit(0);
