'use strict';
const fs = require('fs');
const path = require('path');

const srcLogo = 'C:\\Users\\singl\\.gemini\\antigravity-ide\\brain\\55062de5-21c4-404c-8990-26851c88e5dd\\media__1785342617855.png';
const srcCampus = 'C:\\Users\\singl\\.gemini\\antigravity-ide\\brain\\55062de5-21c4-404c-8990-26851c88e5dd\\media__1785342618033.jpg';

const targetLogoSrc = 'd:\\111\\admin-portal\\src\\sitam_logo.png';
const targetLogoPub = 'd:\\111\\admin-portal\\public\\sitam_logo.png';

const targetCampusSrc = 'd:\\111\\admin-portal\\src\\sitam_campus.jpg';
const targetCampusPub = 'd:\\111\\admin-portal\\public\\sitam_campus.jpg';

fs.copyFileSync(srcLogo, targetLogoSrc);
fs.copyFileSync(srcLogo, targetLogoPub);
fs.copyFileSync(srcCampus, targetCampusSrc);
fs.copyFileSync(srcCampus, targetCampusPub);

console.log('Successfully copied SITAM official logo and campus images into admin-portal assets!');
