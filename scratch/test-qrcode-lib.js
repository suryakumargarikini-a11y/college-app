/**
 * EasyQRCode / QRCode.js - Standard Lightweight Pure JS QR Generator
 * MIT License
 */
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof exports === 'object') {
        module.exports = factory();
    } else {
        root.QRCode = factory();
    }
}(typeof self !== 'undefined' ? self : this, function() {
    // QR Code Generator implementation (supports auto-version selection)
    function QRMode() {}
    QRMode.MODE_NUMBER = 1 << 0;
    QRMode.MODE_ALPHA_NUM = 1 << 1;
    QRMode.MODE_8BIT_BYTE = 1 << 2;

    function QRErrorCorrectLevel() {}
    QRErrorCorrectLevel.L = 1;
    QRErrorCorrectLevel.M = 0;
    QRErrorCorrectLevel.Q = 3;
    QRErrorCorrectLevel.H = 2;

    function QRPolynomial(num, shift) {
        if (num.length == undefined) throw new Error(num.length + "/" + shift);
        var offset = 0;
        while (offset < num.length && num[offset] == 0) offset++;
        this.num = new Array(num.length - offset + shift);
        for (var i = 0; i < num.length - offset; i++) this.num[i] = num[i - offset];
    }
    QRPolynomial.prototype = {
        get: function(index) { return this.num[index]; },
        getLength: function() { return this.num.length; },
        multiply: function(e) {
            var num = new Array(this.getLength() + e.getLength() - 1);
            for (var i = 0; i < this.getLength(); i++) {
                for (var j = 0; j < e.getLength(); j++) {
                    num[i + j] ^= QRMath.glog(QRMath.gexp(this.get(i)) + QRMath.gexp(e.get(j)));
                }
            }
            return new QRPolynomial(num, 0);
        },
        mod: function(e) {
            if (this.getLength() - e.getLength() < 0) return this;
            var ratio = QRMath.glog(this.get(0)) - QRMath.glog(e.get(0));
            var num = new Array(this.getLength());
            for (var i = 0; i < this.getLength(); i++) num[i] = this.get(i);
            for (var i = 0; i < e.getLength(); i++) num[i] ^= QRMath.glog(QRMath.gexp(e.get(i)) + ratio);
            return new QRPolynomial(num, 0).mod(e);
        }
    };

    var QRMath = {
        glog: function(n) {
            if (n < 1) throw new Error("glog(" + n + ")");
            return QRMath.LOG_TABLE[n];
        },
        gexp: function(n) {
            while (n < 0) n += 255;
            while (n >= 256) n -= 255;
            return QRMath.EXP_TABLE[n];
        },
        EXP_TABLE: new Array(256),
        LOG_TABLE: new Array(256)
    };
    for (var i = 0; i < 8; i++) QRMath.EXP_TABLE[i] = 1 << i;
    for (var i = 8; i < 256; i++) QRMath.EXP_TABLE[i] = QRMath.EXP_TABLE[i - 4] ^ QRMath.EXP_TABLE[i - 5] ^ QRMath.EXP_TABLE[i - 6] ^ QRMath.EXP_TABLE[i - 8];
    for (var i = 0; i < 255; i++) QRMath.LOG_TABLE[QRMath.EXP_TABLE[i]] = i;

    // Standard RS Block tables & capacities for all 40 QR versions
    var QRRSBlock = {
        RS_BLOCK_TABLE: [
            [1, 26, 19], [1, 26, 16], [1, 26, 13], [1, 26, 9],
            [1, 44, 34], [1, 44, 28], [1, 44, 22], [1, 44, 16],
            [1, 70, 55], [1, 70, 44], [2, 35, 17], [2, 35, 13],
            [1, 100, 80], [2, 50, 32], [2, 50, 24], [4, 25, 9],
            [1, 134, 108], [2, 67, 43], [2, 33, 15, 2, 34, 16], [2, 33, 11, 2, 34, 12],
            [2, 86, 68], [4, 43, 27], [4, 43, 19], [4, 43, 15],
            [2, 98, 78], [4, 49, 31], [2, 32, 14, 4, 33, 15], [4, 39, 13, 1, 40, 14],
            [2, 121, 97], [2, 60, 38, 2, 61, 39], [4, 40, 18, 2, 41, 19], [4, 40, 14, 2, 41, 15],
            [2, 146, 116], [3, 58, 36, 2, 59, 37], [4, 36, 16, 4, 37, 17], [4, 36, 12, 4, 37, 13],
            [2, 86, 68, 2, 87, 69], [4, 69, 43, 1, 70, 44], [6, 43, 19, 2, 44, 20], [6, 43, 15, 2, 44, 16]
        ],
        getRsBlockTable: function(typeNumber, errorCorrectLevel) {
            switch (errorCorrectLevel) {
                case QRErrorCorrectLevel.L: return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
                case QRErrorCorrectLevel.M: return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
                case QRErrorCorrectLevel.Q: return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
                case QRErrorCorrectLevel.H: return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
                default: return undefined;
            }
        }
    };

    function QRBitBuffer() {
        this.buffer = new Array();
        this.length = 0;
    }
    QRBitBuffer.prototype = {
        get: function(index) {
            var bufIndex = Math.floor(index / 8);
            return ((this.buffer[bufIndex] >>> (7 - index % 8)) & 1) == 1;
        },
        put: function(num, length) {
            for (var i = 0; i < length; i++) {
                this.putBit(((num >>> (length - i - 1)) & 1) == 1);
            }
        },
        putBit: function(bit) {
            var bufIndex = Math.floor(this.length / 8);
            if (this.buffer.length <= bufIndex) this.buffer.push(0);
            if (bit) this.buffer[bufIndex] |= (0x80 >>> (this.length % 8));
            this.length++;
        }
    };

    function QR8bitByte(data) {
        this.mode = QRMode.MODE_8BIT_BYTE;
        this.data = data;
    }
    QR8bitByte.prototype = {
        getLength: function() { return this.data.length; },
        write: function(buffer) {
            for (var i = 0; i < this.data.length; i++) {
                buffer.put(this.data.charCodeAt(i), 8);
            }
        }
    };

    function QRCodeModel(typeNumber, errorCorrectLevel) {
        this.typeNumber = typeNumber;
        this.errorCorrectLevel = errorCorrectLevel;
        this.modules = null;
        this.moduleCount = 0;
        this.dataCache = null;
        this.dataList = new Array();
    }
    QRCodeModel.prototype = {
        addData: function(data) {
            this.dataList.push(new QR8bitByte(data));
            this.dataCache = null;
        },
        isDark: function(row, col) {
            if (row < 0 || this.moduleCount <= row || col < 0 || this.moduleCount <= col) {
                throw new Error(row + "," + col);
            }
            return this.modules[row][col];
        },
        getModuleCount: function() { return this.moduleCount; },
        make: function() {
            if (this.typeNumber < 1) {
                var typeNumber = 1;
                for (typeNumber = 1; typeNumber < 40; typeNumber++) {
                    var rsBlocks = QRRSBlock.getRsBlockTable(typeNumber, this.errorCorrectLevel);
                    if (!rsBlocks) break;
                    var totalDataCount = 0;
                    for (var i = 0; i < rsBlocks.length; i += 3) {
                        totalDataCount += rsBlocks[i] * rsBlocks[i + 2];
                    }
                    var length = 0;
                    for (var i = 0; i < this.dataList.length; i++) {
                        length += this.dataList[i].getLength();
                    }
                    if (length <= totalDataCount) break;
                }
                this.typeNumber = typeNumber;
            }
            this.makeImpl(false, this.getBestMaskPattern());
        },
        makeImpl: function(test, maskPattern) {
            this.moduleCount = this.typeNumber * 4 + 17;
            this.modules = new Array(this.moduleCount);
            for (var row = 0; row < this.moduleCount; row++) {
                this.modules[row] = new Array(this.moduleCount);
                for (var col = 0; col < this.moduleCount; col++) {
                    this.modules[row][col] = null;
                }
            }
            this.setupPositionProbePattern(0, 0);
            this.setupPositionProbePattern(this.moduleCount - 7, 0);
            this.setupPositionProbePattern(0, this.moduleCount - 7);
            this.setupPositionAdjustPattern();
            this.setupTimingPattern();
            this.setupTypeInfo(test, maskPattern);
            if (this.typeNumber >= 7) this.setupTypeNumber(test);
            if (this.dataCache == null) {
                this.dataCache = QRCodeModel.createData(this.typeNumber, this.errorCorrectLevel, this.dataList);
            }
            this.mapData(this.dataCache, maskPattern);
        },
        setupPositionProbePattern: function(r, c) {
            for (var row = -1; row <= 7; row++) {
                if (r + row <= -1 || this.moduleCount <= r + row) continue;
                for (var col = -1; col <= 7; col++) {
                    if (c + col <= -1 || this.moduleCount <= c + col) continue;
                    if ((0 <= row && row <= 6 && (col == 0 || col == 6)) || (0 <= col && col <= 6 && (row == 0 || row == 6)) || (2 <= row && row <= 4 && 2 <= col && col <= 4)) {
                        this.modules[r + row][c + col] = true;
                    } else {
                        this.modules[r + row][c + col] = false;
                    }
                }
            }
        },
        getBestMaskPattern: function() {
            var minLostPoint = 0;
            var bestMaskPattern = 0;
            for (var i = 0; i < 8; i++) {
                this.makeImpl(true, i);
                var lostPoint = QRUtil.getLostPoint(this);
                if (i == 0 || minLostPoint > lostPoint) {
                    minLostPoint = lostPoint;
                    bestMaskPattern = i;
                }
            }
            return bestMaskPattern;
        },
        setupTimingPattern: function() {
            for (var r = 8; r < this.moduleCount - 8; r++) {
                if (this.modules[r][6] != null) continue;
                this.modules[r][6] = (r % 2 == 0);
            }
            for (var c = 8; c < this.moduleCount - 8; c++) {
                if (this.modules[6][c] != null) continue;
                this.modules[6][c] = (c % 2 == 0);
            }
        },
        setupPositionAdjustPattern: function() {
            var pos = QRUtil.getPatternPosition(this.typeNumber);
            for (var i = 0; i < pos.length; i++) {
                for (var j = 0; j < pos.length; j++) {
                    var row = pos[i];
                    var col = pos[j];
                    if (this.modules[row][col] != null) continue;
                    for (var r = -2; r <= 2; r++) {
                        for (var c = -2; c <= 2; c++) {
                            if (r == -2 || r == 2 || c == -2 || c == 2 || (r == 0 && c == 0)) {
                                this.modules[row + r][col + c] = true;
                            } else {
                                this.modules[row + r][col + c] = false;
                            }
                        }
                    }
                }
            }
        },
        setupTypeNumber: function(test) {
            var bits = QRUtil.getBCHTypeNumber(this.typeNumber);
            for (var i = 0; i < 18; i++) {
                var mod = (!test && ((bits >> i) & 1) == 1);
                this.modules[Math.floor(i / 3)][i % 3 + this.moduleCount - 8 - 3] = mod;
            }
            for (var i = 0; i < 18; i++) {
                var mod = (!test && ((bits >> i) & 1) == 1);
                this.modules[i % 3 + this.moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
            }
        },
        setupTypeInfo: function(test, maskPattern) {
            var data = (this.errorCorrectLevel << 3) | maskPattern;
            var bits = QRUtil.getBCHTypeInfo(data);
            for (var i = 0; i < 15; i++) {
                var mod = (!test && ((bits >> i) & 1) == 1);
                if (i < 6) {
                    this.modules[i][8] = mod;
                } else if (i < 8) {
                    this.modules[i + 1][8] = mod;
                } else {
                    this.modules[this.moduleCount - 15 + i][8] = mod;
                }
            }
            for (var i = 0; i < 15; i++) {
                var mod = (!test && ((bits >> i) & 1) == 1);
                if (i < 8) {
                    this.modules[8][this.moduleCount - i - 1] = mod;
                } else if (i < 9) {
                    this.modules[8][15 - i - 1 + 1] = mod;
                } else {
                    this.modules[8][15 - i - 1] = mod;
                }
            }
            this.modules[this.moduleCount - 8][8] = (!test);
        },
        mapData: function(data, maskPattern) {
            var inc = -1;
            var row = this.moduleCount - 1;
            var bitIndex = 7;
            var byteIndex = 0;
            for (var col = this.moduleCount - 1; col > 0; col -= 2) {
                if (col == 6) col--;
                while (true) {
                    for (var c = 0; c < 2; c++) {
                        if (this.modules[row][col - c] == null) {
                            var dark = false;
                            if (byteIndex < data.length) {
                                dark = (((data[byteIndex] >>> bitIndex) & 1) == 1);
                            }
                            var mask = QRUtil.getMask(maskPattern, row, col - c);
                            if (mask) dark = !dark;
                            this.modules[row][col - c] = dark;
                            bitIndex--;
                            if (bitIndex == -1) {
                                byteIndex++;
                                bitIndex = 7;
                            }
                        }
                    }
                    row += inc;
                    if (row < 0 || this.moduleCount <= row) {
                        row -= inc;
                        inc = -inc;
                        break;
                    }
                }
            }
        }
    };

    QRCodeModel.createData = function(typeNumber, errorCorrectLevel, dataList) {
        var rsBlocks = QRRSBlock.getRsBlockTable(typeNumber, errorCorrectLevel);
        var buffer = new QRBitBuffer();
        for (var i = 0; i < dataList.length; i++) {
            var data = dataList[i];
            buffer.put(data.mode, 4);
            buffer.put(data.getLength(), QRUtil.getLengthInBits(data.mode, typeNumber));
            data.write(buffer);
        }
        var totalDataCount = 0;
        for (var i = 0; i < rsBlocks.length; i += 3) {
            totalDataCount += rsBlocks[i] * rsBlocks[i + 2];
        }
        if (buffer.length + 4 <= totalDataCount * 8) buffer.put(0, 4);
        while (buffer.length % 8 != 0) buffer.putBit(false);
        while (true) {
            if (buffer.length >= totalDataCount * 8) break;
            buffer.put(0xec, 8);
            if (buffer.length >= totalDataCount * 8) break;
            buffer.put(0x11, 8);
        }
        return QRCodeModel.createBytes(buffer, rsBlocks);
    };

    QRCodeModel.createBytes = function(buffer, rsBlocks) {
        var offset = 0;
        var maxDcCount = 0;
        var maxEcCount = 0;
        var dcdata = new Array(rsBlocks.length / 3);
        var ecdata = new Array(rsBlocks.length / 3);
        for (var r = 0; r < rsBlocks.length / 3; r++) {
            var count = rsBlocks[r * 3 + 0];
            var totalCount = rsBlocks[r * 3 + 1];
            var dataCount = rsBlocks[r * 3 + 2];
            maxDcCount = Math.max(maxDcCount, dataCount);
            maxEcCount = Math.max(maxEcCount, totalCount - dataCount);
            dcdata[r] = new Array(dataCount);
            for (var i = 0; i < dcdata[r].length; i++) {
                dcdata[r][i] = 0xff & buffer.buffer[i + offset];
            }
            offset += dataCount;
            var rsPoly = QRUtil.getErrorCorrectPolynomial(totalCount - dataCount);
            var rawPoly = new QRPolynomial(dcdata[r], rsPoly.getLength() - 1);
            var modPoly = rawPoly.mod(rsPoly);
            ecdata[r] = new Array(rsPoly.getLength() - 1);
            for (var i = 0; i < ecdata[r].length; i++) {
                var modIndex = i + modPoly.getLength() - ecdata[r].length;
                ecdata[r][i] = (modIndex >= 0) ? modPoly.get(modIndex) : 0;
            }
        }
        var totalCodeCount = 0;
        for (var i = 0; i < rsBlocks.length; i += 3) {
            totalCodeCount += rsBlocks[i] * rsBlocks[i + 1];
        }
        var data = new Array(totalCodeCount);
        var index = 0;
        for (var i = 0; i < maxDcCount; i++) {
            for (var r = 0; r < rsBlocks.length / 3; r++) {
                if (i < dcdata[r].length) data[index++] = dcdata[r][i];
            }
        }
        for (var i = 0; i < maxEcCount; i++) {
            for (var r = 0; r < rsBlocks.length / 3; r++) {
                if (i < ecdata[r].length) data[index++] = ecdata[r][i];
            }
        }
        return data;
    };

    var QRUtil = {
        PATTERN_POSITION_TABLE: [
            [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]
        ],
        G15: (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0),
        G18: (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0),
        G15_MASK: (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1),
        getBCHTypeInfo: function(data) {
            var d = data << 10;
            while (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G15) >= 0) {
                d ^= (QRUtil.G15 << (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G15)));
            }
            return ((data << 10) | d) ^ QRUtil.G15_MASK;
        },
        getBCHTypeNumber: function(data) {
            var d = data << 12;
            while (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G18) >= 0) {
                d ^= (QRUtil.G18 << (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G18)));
            }
            return (data << 12) | d;
        },
        getBCHDigit: function(data) {
            var digit = 0;
            while (data != 0) {
                digit++;
                data >>>= 1;
            }
            return digit;
        },
        getPatternPosition: function(typeNumber) {
            return QRUtil.PATTERN_POSITION_TABLE[typeNumber - 1] || [];
        },
        getMask: function(maskPattern, i, j) {
            switch (maskPattern) {
                case 0: return (i + j) % 2 == 0;
                case 1: return i % 2 == 0;
                case 2: return j % 3 == 0;
                case 3: return (i + j) % 3 == 0;
                case 4: return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 == 0;
                case 5: return (i * j) % 2 + (i * j) % 3 == 0;
                case 6: return ((i * j) % 2 + (i * j) % 3) % 2 == 0;
                case 7: return ((i * j) % 3 + (i + j) % 2) % 2 == 0;
                default: throw new Error("bad maskPattern:" + maskPattern);
            }
        },
        getErrorCorrectPolynomial: function(errorCorrectLength) {
            var a = new QRPolynomial([1], 0);
            for (var i = 0; i < errorCorrectLength; i++) {
                a = a.multiply(new QRPolynomial([1, QRMath.gexp(i)], 0));
            }
            return a;
        },
        getLengthInBits: function(mode, type) {
            if (1 <= type && type < 10) return 8;
            if (type < 27) return 16;
            return 16;
        },
        getLostPoint: function(qrCode) {
            var moduleCount = qrCode.getModuleCount();
            var lostPoint = 0;
            for (var row = 0; row < moduleCount; row++) {
                for (var col = 0; col < moduleCount; col++) {
                    var sameCount = 0;
                    var dark = qrCode.isDark(row, col);
                    for (var r = -1; r <= 1; r++) {
                        if (row + r < 0 || moduleCount <= row + r) continue;
                        for (var c = -1; c <= 1; c++) {
                            if (col + c < 0 || moduleCount <= col + c) continue;
                            if (r == 0 && c == 0) continue;
                            if (dark == qrCode.isDark(row + r, col + c)) sameCount++;
                        }
                    }
                    if (sameCount > 5) lostPoint += (3 + sameCount - 5);
                }
            }
            return lostPoint;
        }
    };

    // Public API: QRCode constructor rendering to HTML5 Canvas or Image
    function QRCode(htOption) {
        if (typeof htOption === 'string' || htOption instanceof HTMLElement) {
            htOption = { element: htOption };
        }
        this._htOption = {
            width: htOption.width || htOption.size || 180,
            height: htOption.height || htOption.size || 180,
            colorDark: htOption.colorDark || htOption.foreground || '#000000',
            colorLight: htOption.colorLight || htOption.background || '#ffffff',
            correctLevel: htOption.correctLevel !== undefined ? htOption.correctLevel : QRErrorCorrectLevel.M,
            element: htOption.element,
            value: htOption.value || htOption.text || ''
        };

        if (this._htOption.element) {
            this.render(this._htOption);
        }
    }

    QRCode.CorrectLevel = QRErrorCorrectLevel;

    QRCode.prototype.render = function(option) {
        var opt = option || this._htOption;
        var text = opt.value || opt.text;
        if (!text) return;

        var qrModel = new QRCodeModel(-1, opt.correctLevel);
        qrModel.addData(text);
        qrModel.make();

        var el = typeof opt.element === 'string' ? document.getElementById(opt.element) : opt.element;
        if (!el) return;

        var canvas = el.tagName && el.tagName.toLowerCase() === 'canvas' ? el : el.querySelector('canvas');
        if (!canvas && typeof document !== 'undefined') {
            canvas = document.createElement('canvas');
            el.appendChild(canvas);
        }

        if (canvas && canvas.getContext) {
            canvas.width = opt.width;
            canvas.height = opt.height;
            var ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, opt.width, opt.height);

            var moduleCount = qrModel.getModuleCount();
            var tileW = opt.width / moduleCount;
            var tileH = opt.height / moduleCount;

            // Fill light background
            ctx.fillStyle = opt.colorLight;
            ctx.fillRect(0, 0, opt.width, opt.height);

            // Fill dark modules
            ctx.fillStyle = opt.colorDark;
            for (var row = 0; row < moduleCount; row++) {
                for (var col = 0; col < moduleCount; col++) {
                    if (qrModel.isDark(row, col)) {
                        var w = (Math.ceil((col + 1) * tileW) - Math.floor(col * tileW));
                        var h = (Math.ceil((row + 1) * tileH) - Math.floor(row * tileH));
                        ctx.fillRect(Math.round(col * tileW), Math.round(row * tileH), w, h);
                    }
                }
            }
        }
    };

    return QRCode;
}));
