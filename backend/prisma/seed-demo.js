'use strict';
// ══════════════════════════════════════════════════════════════════════════════
// SITAM Smart ERP — Production Demo Dataset Generator
// File   : backend/prisma/seed-demo.js
// Purpose: Populate the PostgreSQL database for the July 15, 2026 demo.
//          Idempotent (upsert-based). Supports --reset flag.
//
// Usage  : node prisma/seed-demo.js [--reset]
//          npm run seed:demo            (from backend/)
//          npm run seed:demo -- --reset
// ══════════════════════════════════════════════════════════════════════════════

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const RESET  = process.argv.includes('--reset');

// ──────────────────────────────────────────────────────────────────────────────
// Crypto helpers
// ──────────────────────────────────────────────────────────────────────────────
const SALT = process.env.ADMIN_PASSWORD_SALT || 'sitam-admin-salt';
function hashPassword(p) {
  return crypto.createHmac('sha256', SALT).update(p).digest('hex');
}
function hashOTP(otp) {
  return crypto.createHash('sha256').update(otp + 'sitam-otp-salt').digest('hex');
}

// ──────────────────────────────────────────────────────────────────────────────
// Utility helpers
// ──────────────────────────────────────────────────────────────────────────────
function rnd(arr)              { return arr[Math.floor(Math.random() * arr.length)]; }
function rndInt(min, max)      { return Math.floor(Math.random() * (max - min + 1)) + min; }
function rndFloat(min, max, d) { d = d === undefined ? 2 : d; return parseFloat((Math.random() * (max - min) + min).toFixed(d)); }
function daysAgo(n)            { const d = new Date(); d.setDate(d.getDate() - n); return d; }
function daysFromNow(n)        { const d = new Date(); d.setDate(d.getDate() + n); return d; }
function dateStr(d)            { return d.toISOString().slice(0, 10); }
function uid()                 { return crypto.randomBytes(4).toString('hex').toUpperCase(); }

// ──────────────────────────────────────────────────────────────────────────────
// Name pools — authentic South-Indian names
// ──────────────────────────────────────────────────────────────────────────────
const FIRST_MALE = [
  'Arjun','Karthik','Venkatesh','Suresh','Ramesh','Anil','Vikram','Siva','Harish','Naveen',
  'Praveen','Ravi','Srikanth','Dinesh','Mahesh','Ganesh','Pradeep','Rajesh','Lokesh','Kishore',
  'Deepak','Aakash','Charan','Nithish','Akshay','Akhil','Varun','Rohit','Ajay','Vijay',
  'Sanjay','Balaji','Santosh','Manoj','Vinod','Sunil','Aravind','Bharath','Tarun','Sathvik',
  'Pavan','Koushik','Sai','Vamsi','Teja','Surya','Gopal','Naresh','Bhaskar','Mohan',
  'Lohith','Sumanth','Shankar','Murali','Kiran','Aditya','Neeraj','Prithvi','Yashwanth','Chaitanya',
];
const FIRST_FEMALE = [
  'Priya','Divya','Sowmya','Lakshmi','Kavya','Sneha','Anjali','Swathi','Pooja','Anusha',
  'Keerthi','Sravani','Bhavana','Haritha','Madhuri','Nandini','Pallavi','Ranjitha','Sushma','Usha',
  'Vanitha','Yamuna','Chitra','Deepa','Gayathri','Hema','Indira','Jyothi','Kamala','Revathi',
  'Saritha','Tara','Uma','Vidya','Ashwini','Bindhu','Durga','Anitha','Ramya','Sangeetha',
  'Subha','Meena','Lavanya','Preeti','Nithya','Shruthi','Madhavi','Roopa','Shalini','Vani',
];
const LAST_NAMES = [
  'Reddy','Sharma','Naidu','Rao','Kumar','Varma','Chowdary','Pillai','Krishnan','Iyer',
  'Nair','Menon','Rajan','Murugan','Subramaniam','Venkataraman','Goud','Yadav','Babu','Prasad',
  'Srinivas','Murthy','Patel','Sekhar','Raju','Devi','Lal','Singh','Bhat','Hegde',
  'Tiwari','Joshi','Mishra','Pandey','Gupta','Agarwal','Shetty','Kamath','Bose','Das',
];
const FATHER_FIRST = [
  'Suresh','Ramesh','Venkatesh','Narasimha','Srinivas','Krishna','Govinda','Rajendra',
  'Mahendra','Vijaykumar','Sudarshan','Prakash','Madhu','Ranga','Bala','Chenna','Durga',
  'Eswar','Ganesh','Hari','Ravi','Venkaiah','Nagesh','Basava','Janardhan',
];
const MOTHER_FIRST = [
  'Lakshmi','Saraswathi','Padmavathi','Annapurna','Kamakshi','Vijayalakshmi','Sridevi',
  'Parvathi','Meenakshi','Bhagya','Sumathi','Renuka','Vasantha','Tulasi','Savithri',
  'Mythili','Sharada','Uma','Geetha','Radhika','Kamala','Usha','Vani','Sulochana',
];
const BLOOD_GROUPS  = ['A+','A-','B+','B-','AB+','AB-','O+','O-'];
const RELIGIONS     = ['Hindu','Muslim','Christian','Sikh','Buddhist','Jain'];
const CASTES        = ['OC','BC-A','BC-B','BC-C','BC-D','BC-E','SC','ST','EWS'];
const SEAT_TYPES    = ['Management','Convener','NRI','Lateral Entry'];
const ENTRANCE_TYPES = ['EAMCET','JEE Mains','ECET','Direct Admission'];
const SCHOLARSHIPS  = ['None','Merit Scholarship','SC/ST Scholarship','EWS Scholarship','Minority Scholarship','Sports Quota Scholarship'];
const DISTRICTS     = [
  'Hyderabad','Rangareddy','Medchal','Sangareddy','Nizamabad','Karimnagar','Khammam',
  'Nalgonda','Warangal','Adilabad','Guntur','Krishna','East Godavari','West Godavari',
  'Visakhapatnam','Bengaluru Urban','Mysuru','Pune','Chennai','Nagpur',
];
const PINCODES = [
  '500072','500085','500016','500015','500001','500060','500034','500074','500090','500062',
  '506001','506167','503001','505001','507001','508001','504001','534001','534002','530001',
];
const STATES_LIST = ['Telangana','Andhra Pradesh','Karnataka','Maharashtra','Tamil Nadu'];

// ──────────────────────────────────────────────────────────────────────────────
// Branch / roll-number config
// ──────────────────────────────────────────────────────────────────────────────
const BRANCH_CODES = {
  'CSE':  { prefix: 'A05' },
  'ECE':  { prefix: 'A04' },
  'MECH': { prefix: 'A03' },
  'CIVIL':{ prefix: 'A01' },
  'EEE':  { prefix: 'A02' },
  'IT':   { prefix: 'A12' },
  'AIML': { prefix: 'A47' },
};
const YEAR_SEM    = { 1:['1','2'], 2:['3','4'], 3:['5','6'], 4:['7','8'] };
const YEAR_PREFIX = { 1:'25', 2:'24', 3:'23', 4:'22' };

// Distribution — total = 500
// CSE:140, AIML:80, IT:65, ECE:70, EEE:45, MECH:55, CIVIL:45
const STUDENT_DIST = [
  ['CSE',  1, 40], ['CSE',  2, 35], ['CSE',  3, 35], ['CSE',  4, 30],
  ['ECE',  1, 20], ['ECE',  2, 18], ['ECE',  3, 17], ['ECE',  4, 15],
  ['IT',   1, 20], ['IT',   2, 17], ['IT',   3, 15], ['IT',   4, 13],
  ['AIML', 1, 24], ['AIML', 2, 22], ['AIML', 3, 20], ['AIML', 4, 14],
  ['EEE',  1, 13], ['EEE',  2, 11], ['EEE',  3, 11], ['EEE',  4, 10],
  ['MECH', 1, 16], ['MECH', 2, 14], ['MECH', 3, 14], ['MECH', 4, 11],
  ['CIVIL',1, 13], ['CIVIL',2, 11], ['CIVIL',3, 11], ['CIVIL',4, 10],
];

// ──────────────────────────────────────────────────────────────────────────────
// Subjects (40 realistic engineering subjects)
// ──────────────────────────────────────────────────────────────────────────────
const SUBJECTS_DATA = [
  { code:'GEN-101', name:'Engineering Mathematics – I',           credits:'4', semester:'1', branch:''     },
  { code:'GEN-102', name:'Engineering Physics',                   credits:'3', semester:'1', branch:''     },
  { code:'GEN-103', name:'Engineering Chemistry',                 credits:'3', semester:'1', branch:''     },
  { code:'GEN-104', name:'Programming in C',                      credits:'3', semester:'1', branch:''     },
  { code:'GEN-201', name:'Engineering Mathematics – II',          credits:'4', semester:'2', branch:''     },
  { code:'GEN-202', name:'Basic Electrical Engineering',          credits:'3', semester:'2', branch:''     },
  { code:'GEN-203', name:'Engineering Drawing',                   credits:'2', semester:'2', branch:''     },
  { code:'CS-301',  name:'Object Oriented Programming',           credits:'4', semester:'3', branch:'CSE'  },
  { code:'CS-302',  name:'Discrete Mathematics',                  credits:'4', semester:'3', branch:'CSE'  },
  { code:'CS-303',  name:'Data Communication Basics',             credits:'3', semester:'3', branch:'CSE'  },
  { code:'CS-401',  name:'Data Structures & Algorithms',          credits:'4', semester:'4', branch:'CSE'  },
  { code:'CS-402',  name:'Operating Systems',                     credits:'4', semester:'4', branch:'CSE'  },
  { code:'CS-403',  name:'Computer Networks',                     credits:'3', semester:'4', branch:'CSE'  },
  { code:'CS-404',  name:'Database Management Systems',           credits:'4', semester:'4', branch:'CSE'  },
  { code:'CS-501',  name:'Web Technologies',                      credits:'3', semester:'5', branch:'CSE'  },
  { code:'CS-502',  name:'Software Engineering',                  credits:'3', semester:'5', branch:'CSE'  },
  { code:'CS-503',  name:'Compiler Design',                       credits:'4', semester:'5', branch:'CSE'  },
  { code:'CS-504',  name:'Design & Analysis of Algorithms',       credits:'4', semester:'5', branch:'CSE'  },
  { code:'CS-601',  name:'Machine Learning',                      credits:'4', semester:'6', branch:'CSE'  },
  { code:'CS-602',  name:'Cloud Computing',                       credits:'3', semester:'6', branch:'CSE'  },
  { code:'CS-603',  name:'Information Security & Cryptography',   credits:'3', semester:'6', branch:'CSE'  },
  { code:'CS-701',  name:'Artificial Intelligence',               credits:'4', semester:'7', branch:'CSE'  },
  { code:'CS-702',  name:'Big Data Analytics',                    credits:'4', semester:'7', branch:'CSE'  },
  { code:'CS-801',  name:'Mobile Application Development',        credits:'3', semester:'8', branch:'CSE'  },
  { code:'ECE-301', name:'Digital Electronics',                   credits:'4', semester:'3', branch:'ECE'  },
  { code:'ECE-302', name:'Analog Electronic Circuits',            credits:'4', semester:'3', branch:'ECE'  },
  { code:'ECE-401', name:'Microprocessors & Microcontrollers',    credits:'4', semester:'4', branch:'ECE'  },
  { code:'ECE-501', name:'Antennas & Wave Propagation',           credits:'4', semester:'5', branch:'ECE'  },
  { code:'ECE-601', name:'VLSI Design',                           credits:'4', semester:'6', branch:'ECE'  },
  { code:'IT-301',  name:'Python Programming',                    credits:'3', semester:'3', branch:'IT'   },
  { code:'IT-401',  name:'Java Programming',                      credits:'4', semester:'4', branch:'IT'   },
  { code:'IT-501',  name:'Cloud Architecture',                    credits:'3', semester:'5', branch:'IT'   },
  { code:'AI-301',  name:'Introduction to AI & ML',               credits:'3', semester:'3', branch:'AIML' },
  { code:'AI-401',  name:'Deep Learning',                         credits:'4', semester:'4', branch:'AIML' },
  { code:'AI-501',  name:'Natural Language Processing',           credits:'4', semester:'5', branch:'AIML' },
  { code:'ME-301',  name:'Thermodynamics',                        credits:'4', semester:'3', branch:'MECH' },
  { code:'ME-401',  name:'Kinematics of Machinery',               credits:'4', semester:'4', branch:'MECH' },
  { code:'CE-301',  name:'Strength of Materials',                 credits:'4', semester:'3', branch:'CIVIL'},
  { code:'CE-401',  name:'Fluid Mechanics',                       credits:'4', semester:'4', branch:'CIVIL'},
  { code:'EE-401',  name:'Electrical Machines – I',               credits:'4', semester:'4', branch:'EEE'  },
];

// ──────────────────────────────────────────────────────────────────────────────
// LMS Courses (40 courses)
// ──────────────────────────────────────────────────────────────────────────────
const COURSES_DATA = [
  { code:'LMS-CS-001', name:'Data Structures & Algorithms',          credits:'4', dept:'CSE'  },
  { code:'LMS-CS-002', name:'Operating Systems',                     credits:'4', dept:'CSE'  },
  { code:'LMS-CS-003', name:'Computer Networks',                     credits:'3', dept:'CSE'  },
  { code:'LMS-CS-004', name:'Database Management Systems',           credits:'4', dept:'CSE'  },
  { code:'LMS-CS-005', name:'Web Technologies',                      credits:'3', dept:'CSE'  },
  { code:'LMS-CS-006', name:'Software Engineering',                  credits:'3', dept:'CSE'  },
  { code:'LMS-CS-007', name:'Compiler Design',                       credits:'4', dept:'CSE'  },
  { code:'LMS-CS-008', name:'Machine Learning',                      credits:'4', dept:'CSE'  },
  { code:'LMS-CS-009', name:'Cloud Computing',                       credits:'3', dept:'CSE'  },
  { code:'LMS-CS-010', name:'Object Oriented Programming',           credits:'4', dept:'CSE'  },
  { code:'LMS-CS-011', name:'Design & Analysis of Algorithms',       credits:'4', dept:'CSE'  },
  { code:'LMS-CS-012', name:'Big Data Analytics',                    credits:'4', dept:'CSE'  },
  { code:'LMS-CS-013', name:'Mobile Application Development',        credits:'3', dept:'CSE'  },
  { code:'LMS-CS-014', name:'Artificial Intelligence',               credits:'4', dept:'CSE'  },
  { code:'LMS-CS-015', name:'IoT & Embedded Systems',                credits:'3', dept:'CSE'  },
  { code:'LMS-IT-001', name:'Python Programming',                    credits:'3', dept:'IT'   },
  { code:'LMS-IT-002', name:'Java Programming',                      credits:'4', dept:'IT'   },
  { code:'LMS-IT-003', name:'Cloud Architecture & DevOps',           credits:'3', dept:'IT'   },
  { code:'LMS-IT-004', name:'Cybersecurity Fundamentals',            credits:'3', dept:'IT'   },
  { code:'LMS-IT-005', name:'Agile & Project Management',            credits:'2', dept:'IT'   },
  { code:'LMS-EC-001', name:'Digital Electronics',                   credits:'4', dept:'ECE'  },
  { code:'LMS-EC-002', name:'Microprocessors & Controllers',         credits:'4', dept:'ECE'  },
  { code:'LMS-EC-003', name:'Antennas & Wave Propagation',           credits:'4', dept:'ECE'  },
  { code:'LMS-EC-004', name:'VLSI Design',                           credits:'4', dept:'ECE'  },
  { code:'LMS-EC-005', name:'Digital Signal Processing',             credits:'3', dept:'ECE'  },
  { code:'LMS-AI-001', name:'Introduction to AI & ML',               credits:'3', dept:'AIML' },
  { code:'LMS-AI-002', name:'Deep Learning & Neural Networks',       credits:'4', dept:'AIML' },
  { code:'LMS-AI-003', name:'Natural Language Processing',           credits:'4', dept:'AIML' },
  { code:'LMS-AI-004', name:'Computer Vision',                       credits:'3', dept:'AIML' },
  { code:'LMS-AI-005', name:'Reinforcement Learning',                credits:'3', dept:'AIML' },
  { code:'LMS-ME-001', name:'Thermodynamics',                        credits:'4', dept:'MECH' },
  { code:'LMS-ME-002', name:'Kinematics of Machinery',               credits:'4', dept:'MECH' },
  { code:'LMS-ME-003', name:'Manufacturing Technology',              credits:'4', dept:'MECH' },
  { code:'LMS-CE-001', name:'Strength of Materials',                 credits:'4', dept:'CIVIL'},
  { code:'LMS-CE-002', name:'Fluid Mechanics',                       credits:'4', dept:'CIVIL'},
  { code:'LMS-CE-003', name:'Structural Analysis',                   credits:'4', dept:'CIVIL'},
  { code:'LMS-EE-001', name:'Network Theory',                        credits:'4', dept:'EEE'  },
  { code:'LMS-EE-002', name:'Electrical Machines – I',               credits:'4', dept:'EEE'  },
  { code:'LMS-EE-003', name:'Power Systems',                         credits:'4', dept:'EEE'  },
  { code:'LMS-CM-001', name:'Engineering Mathematics',               credits:'4', dept:'CSE'  },
];

// ──────────────────────────────────────────────────────────────────────────────
// Faculty (20 members)
// ──────────────────────────────────────────────────────────────────────────────
const FACULTY_DATA = [
  { name:'Dr. K. Srinivas Rao',      dept:'CSE',  qual:'Ph.D. (Computer Science, IIT Hyderabad)', exp:18 },
  { name:'Dr. M. Lakshmi Prasanna',  dept:'CSE',  qual:'Ph.D. (Distributed Systems, JNTU)', exp:14 },
  { name:'Dr. P. Venkatesh',         dept:'CSE',  qual:'Ph.D. (Machine Learning, University of Mysore)', exp:12 },
  { name:'Dr. S. Ramesh Babu',       dept:'ECE',  qual:'Ph.D. (VLSI, IIT Bombay)', exp:20 },
  { name:'Dr. V. Radha Krishna',     dept:'ECE',  qual:'Ph.D. (Signal Processing, Osmania University)', exp:15 },
  { name:'Dr. G. Anitha',            dept:'AIML', qual:'Ph.D. (Artificial Intelligence, IIT Madras)', exp:10 },
  { name:'Prof. A. Sandeep Kumar',   dept:'IT',   qual:'M.Tech (Network Security, JNTU)', exp:9  },
  { name:'Prof. R. Harish Reddy',    dept:'IT',   qual:'M.Tech (Cloud Computing, BITS Pilani)', exp:7  },
  { name:'Prof. T. Divya Varma',     dept:'MECH', qual:'M.Tech (Thermal Engineering, NIT Warangal)', exp:8  },
  { name:'Prof. D. Rajendra Prasad', dept:'MECH', qual:'Ph.D. (Manufacturing, Osmania University)', exp:13 },
  { name:'Mr. B. Ravindra Goud',     dept:'EEE',  qual:'M.Tech (Power Systems, JNTU)', exp:5  },
  { name:'Mr. Ch. Lokesh',           dept:'EEE',  qual:'M.Tech (Electrical Machines, NIT Calicut)', exp:4  },
  { name:'Mr. K. Sai Kiran',         dept:'CIVIL',qual:'M.Tech (Structural Engineering, IIT Kharagpur)', exp:6  },
  { name:'Mrs. M. Anjali Reddy',     dept:'CIVIL',qual:'M.Tech (Geotechnical Engineering, NIT Rourkela)', exp:5 },
  { name:'Mrs. P. Swathi',           dept:'CSE',  qual:'M.Tech (Data Mining, JNTU)', exp:6  },
  { name:'Mrs. S. Sowmya Naidu',     dept:'ECE',  qual:'M.Tech (Embedded Systems, BITS Hyderabad)', exp:5 },
  { name:'Mrs. T. Bhavana Varma',    dept:'AIML', qual:'M.Tech (Deep Learning, IIIT Hyderabad)', exp:4  },
  { name:'Ms. K. Haritha Nair',      dept:'IT',   qual:'M.Tech (Software Engineering, VIT Vellore)', exp:3 },
  { name:'Ms. S. Kavya Reddy',       dept:'AIML', qual:'M.Tech (NLP & AI, IIIT Hyderabad)', exp:3  },
  { name:'Ms. V. Sneha Pillai',      dept:'CSE',  qual:'M.Tech (Cybersecurity, NIT Trichy)', exp:2  },
];

// ──────────────────────────────────────────────────────────────────────────────
// Companies for placement drives (60 records)
// ──────────────────────────────────────────────────────────────────────────────
const COMPANIES = [
  { name:'Tata Consultancy Services',       role:'Systems Engineer',            pkg:'3.5',  elig:'CSE/IT/ECE – 60%',         arv:true  },
  { name:'Infosys',                         role:'Systems Engineer Trainee',    pkg:'3.6',  elig:'All Branches – 60%',        arv:false },
  { name:'Wipro Technologies',              role:'Project Engineer',            pkg:'3.5',  elig:'CSE/IT – 65%',              arv:true  },
  { name:'Cognizant Technology Solutions',  role:'Programmer Analyst',          pkg:'4.0',  elig:'CSE/ECE/IT – 60%',         arv:false },
  { name:'Tech Mahindra',                   role:'Associate Software Engineer', pkg:'3.8',  elig:'All Branches – 60%',        arv:false },
  { name:'Accenture',                       role:'Associate Software Engineer', pkg:'4.5',  elig:'All Branches – 65%',        arv:true  },
  { name:'Capgemini',                       role:'Software Engineer',           pkg:'4.0',  elig:'CSE/IT/ECE – 60%',         arv:false },
  { name:'HCL Technologies',                role:'Graduate Engineer Trainee',   pkg:'3.8',  elig:'All Branches – 60%',        arv:false },
  { name:'IBM India',                       role:'Application Developer',       pkg:'5.0',  elig:'CSE/IT – 70%',              arv:false },
  { name:'Deloitte USI',                    role:'Analyst',                     pkg:'6.0',  elig:'CSE/ECE/IT – 65%',         arv:false },
  { name:'Mphasis',                         role:'Software Engineer',           pkg:'4.2',  elig:'CSE/IT – 60%',              arv:false },
  { name:'LTIMindtree',                     role:'Graduate Engineer Trainee',   pkg:'4.5',  elig:'All Branches – 65%',        arv:false },
  { name:'Hexaware Technologies',           role:'Software Engineer',           pkg:'3.9',  elig:'CSE/ECE/IT – 60%',         arv:false },
  { name:'Oracle Financial Services',       role:'Associate Consultant',        pkg:'8.0',  elig:'CSE/IT – 70%, No Backlogs', arv:false },
  { name:'Amazon Development Centre India', role:'SDE – I',                     pkg:'12.0', elig:'CSE/IT – 75%, No Backlogs', arv:false },
  { name:'Persistent Systems',              role:'Software Engineer',           pkg:'5.5',  elig:'CSE/ECE/IT – 65%',         arv:false },
  { name:'Zensar Technologies',             role:'Software Engineer',           pkg:'4.0',  elig:'CSE/IT – 60%',              arv:false },
  { name:'Mindtree',                        role:'Software Engineer',           pkg:'4.2',  elig:'CSE/IT/ECE – 60%',         arv:false },
  { name:'Kyndryl India',                   role:'Network Support Engineer',    pkg:'4.8',  elig:'ECE/EEE/CSE – 60%',        arv:false },
  { name:'Genpact India',                   role:'Process Associate',           pkg:'3.5',  elig:'All Branches – 55%',        arv:false },
  { name:'Virtusa India',                   role:'Software Engineer',           pkg:'4.2',  elig:'CSE/IT – 60%',              arv:false },
  { name:'Tata Elxsi',                      role:'Design Engineer',             pkg:'4.5',  elig:'CSE/ECE – 65%',             arv:false },
  { name:'Sonata Software',                 role:'Software Engineer',           pkg:'4.0',  elig:'CSE/IT – 60%',              arv:false },
  { name:'Mastech Digital',                 role:'IT Analyst',                  pkg:'3.8',  elig:'All Branches – 60%',        arv:false },
  { name:'Cyient Ltd',                      role:'Software Engineer',           pkg:'4.3',  elig:'CSE/ECE/EEE – 65%',        arv:false },
  { name:'L&T Technology Services',         role:'Graduate Engineer',           pkg:'4.0',  elig:'MECH/ECE/EEE – 60%',       arv:false },
  { name:'Bharat Electronics Limited',      role:'GET – Electronics',           pkg:'4.2',  elig:'ECE/EEE – 65%',             arv:false },
  { name:'ISRO – URSC Bengaluru',           role:'Scientist/Engineer – SC',     pkg:'5.5',  elig:'ECE/EEE/MECH – 65%, GATE', arv:false },
  { name:'DRDO CEPTAM',                     role:'Tech-A – Electronics',        pkg:'5.0',  elig:'ECE/CSE – 60%, Central Exam',arv:false },
  { name:'NTPC Ltd',                        role:'Executive Trainee – EE',      pkg:'5.6',  elig:'EEE – 65%, No Backlogs',   arv:false },
  { name:'Siemens India',                   role:'Graduate Engineer',           pkg:'5.2',  elig:'MECH/EEE – 65%',            arv:false },
  { name:'ABB India',                       role:'Associate Engineer',          pkg:'4.8',  elig:'EEE/ECE – 60%',             arv:false },
  { name:'Bosch Engineering India',         role:'Associate Engineer',          pkg:'5.0',  elig:'MECH/ECE – 65%',            arv:false },
  { name:'Larsen & Toubro ECC',             role:'Graduate Engineer Trainee',   pkg:'4.5',  elig:'CIVIL/MECH – 60%',          arv:false },
  { name:'Shapoorji Pallonji Group',        role:'Management Trainee – Civil',  pkg:'4.2',  elig:'CIVIL – 60%',               arv:false },
  { name:'Tata Projects Ltd',               role:'Graduate Trainee',            pkg:'4.0',  elig:'CIVIL/MECH – 60%',          arv:false },
  { name:'Google India',                    role:'SWE – I',                     pkg:'22.0', elig:'CSE/IT – 80%, CP skills',   arv:false },
  { name:'Microsoft India',                 role:'SWE',                         pkg:'20.0', elig:'CSE/IT – 80%, No Backlogs', arv:false },
  { name:'Flipkart',                        role:'SDE – I',                     pkg:'14.0', elig:'CSE/IT – 75%',              arv:false },
  { name:'PayPal India',                    role:'Software Engineer',           pkg:'15.0', elig:'CSE/IT – 75%',              arv:false },
  { name:'Adobe India',                     role:'Associate Software Engineer', pkg:'16.0', elig:'CSE/IT – 75%',              arv:false },
  { name:'Qualcomm India',                  role:'Engineer – IC Design',        pkg:'12.0', elig:'ECE – 75%',                 arv:false },
  { name:'Texas Instruments India',         role:'Systems Engineer',            pkg:'10.0', elig:'ECE/EEE – 70%',             arv:false },
  { name:'Samsung R&D India',               role:'Software Engineer',           pkg:'9.0',  elig:'CSE/ECE – 70%',             arv:false },
  { name:'Zoho Corporation',                role:'Member Technical Staff',      pkg:'7.0',  elig:'CSE/IT – 70%',              arv:false },
  { name:'Freshworks',                      role:'Software Engineer',           pkg:'8.0',  elig:'CSE/IT – 70%',              arv:false },
  { name:'Razorpay',                        role:'Software Engineer',           pkg:'9.0',  elig:'CSE/IT – 70%',              arv:false },
  { name:'Zepto Technologies',              role:'Software Engineer',           pkg:'10.0', elig:'CSE/IT – 70%',              arv:false },
  { name:'BYJU\'S (Think & Learn)',         role:'Business Development Associate',pkg:'5.0',elig:'All Branches – 60%',        arv:false },
  { name:'Infosys BPM',                     role:'Digital Specialist Executive',pkg:'3.6',  elig:'All Branches – 60%',        arv:false },
  { name:'Sutherland Global Services',      role:'Process Engineer',            pkg:'3.5',  elig:'All Branches – 55%',        arv:false },
  { name:'Concentrix India',                role:'Process Associate',           pkg:'3.2',  elig:'All Branches – 55%',        arv:false },
  { name:'EXL Service',                     role:'Operations Analyst',          pkg:'4.0',  elig:'All Branches – 60%',        arv:false },
  { name:'WNS Global Services',             role:'Business Analyst',            pkg:'3.8',  elig:'All Branches – 60%',        arv:false },
  { name:'Optum (UnitedHealth Group)',       role:'Software Engineer',           pkg:'6.5',  elig:'CSE/IT – 65%',              arv:false },
  { name:'Cerner Healthcare IT',            role:'Associate Software Engineer', pkg:'5.5',  elig:'CSE/IT – 65%',              arv:false },
  { name:'Conduent India',                  role:'Systems Analyst',             pkg:'4.5',  elig:'CSE/IT/ECE – 60%',         arv:false },
  { name:'Amdocs India',                    role:'Software Engineer',           pkg:'5.8',  elig:'CSE/IT – 65%',              arv:false },
  { name:'GlobalLogic India',               role:'Associate Engineer',          pkg:'6.0',  elig:'CSE/ECE – 65%',             arv:false },
  { name:'Nagarro India',                   role:'Software Engineer',           pkg:'5.5',  elig:'CSE/IT – 65%',              arv:false },
  { name:'Minda Industries',                role:'Graduate Engineer Trainee',   pkg:'3.8',  elig:'MECH/EEE – 60%',            arv:false },
  { name:'Asian Paints',                    role:'Management Trainee',          pkg:'4.5',  elig:'CIVIL/MECH/EEE – 60%',     arv:false },
];

// ──────────────────────────────────────────────────────────────────────────────
// Announcements (25)
// ──────────────────────────────────────────────────────────────────────────────
const ANNOUNCEMENTS = [
  { title:'End Semester Examinations – November 2026 Schedule Released',       priority:'URGENT',status:'PUBLISHED',description:'The End Semester Examination schedule for November 2026 has been released. Students are advised to download the timetable from the college portal and report to their respective examination halls 30 minutes prior to the exam. All students must carry their Hall Tickets. Contact the Exam Section for any discrepancies.' },
  { title:'Mid-Term Examinations – Unit Test I (August 2026)',                 priority:'HIGH',  status:'PUBLISHED',description:'Unit Test I (Mid Term) examinations will be conducted from 11th–15th August 2026 as per the schedule uploaded on the portal. All students are instructed to be present. Attendance in mid-term exams is mandatory for eligibility.' },
  { title:'Workshop on Full Stack Development using MERN Stack',               priority:'NORMAL',status:'PUBLISHED',description:'The Department of CSE is organizing a 3-day workshop on Full Stack Development using the MERN Stack from 5th–7th July 2026. Industry experts from Hyderabad will conduct the sessions. Registration is open on the college portal. Limited seats available.' },
  { title:'National Sports Day – College Holiday Notice',                      priority:'HIGH',  status:'PUBLISHED',description:'In observance of National Sports Day, the college will remain closed on 29th August 2026. All scheduled classes, labs, and examinations stand postponed. A compensatory class schedule will be announced separately.' },
  { title:'Fee Payment Deadline – Hostel Fee Q2 (July–September)',             priority:'URGENT',status:'PUBLISHED',description:'All hostel residents are reminded to clear their Hostel Fee for Q2 (July–September 2026) by 20th July 2026. Failure to pay will result in suspension of hostel facilities. Students with financial difficulties may apply for the Fee Waiver Scheme through the Accounts Section.' },
  { title:'Library Book Return Notice – Extended Due Date',                    priority:'NORMAL',status:'PUBLISHED',description:'All students who have borrowed library books during Semester 4 are requested to return them by 30th June 2026. The library will conduct an inventory audit from 1st July. A fine of Rs. 5 per day will be charged for overdue books after the deadline.' },
  { title:'SITAM Hackathon 2026 – Registrations Open',                        priority:'HIGH',  status:'PUBLISHED',description:'The annual SITAM Hackathon 2026 is open for registrations. The event will be held on 20th–21st July 2026. Teams of 2–4 members can register on the portal. Problem statements will be released 48 hours before the event. Winner teams get internship opportunities with sponsoring companies.' },
  { title:'Anti-Ragging Committee – Awareness Program',                        priority:'URGENT',status:'PUBLISHED',description:'An awareness program on Anti-Ragging policies will be conducted on 5th July 2026 in the college auditorium for all first-year students. Attendance is compulsory. Parents are also invited. Please report any ragging incidents at ragging@sitamecap.co.in.' },
  { title:'Project Submission Deadline – Final Year B.Tech Projects',          priority:'HIGH',  status:'PUBLISHED',description:'Final year B.Tech project teams are reminded that the project report submission deadline is 10th July 2026. Hard-bound copies (2 sets) should be submitted to the respective Department Project Coordinator. Viva-voce examinations will be scheduled from 15th July onwards.' },
  { title:'Campus Placement Drive – TCS Smart Hiring 2026',                   priority:'HIGH',  status:'PUBLISHED',description:'Tata Consultancy Services will be conducting their Smart Hiring 2026 placement drive on campus on 18th July 2026. Eligible students (CSE/IT/ECE, 60% aggregate) can register through the Training and Placement portal. Selection process: Online test → TR → HR rounds.' },
  { title:'Scholarship Applications – State Government Merit Scholarships',    priority:'NORMAL',status:'PUBLISHED',description:'Applications are invited from eligible students for the Telangana State Government Merit Scholarship 2026-27. Students with CGPA 7.0 and above and family income below 2.5 lakh per annum are eligible. Apply online through the TGEPASS portal by 31st July 2026.' },
  { title:'Inauguration of New Computer Lab (Lab-7) – Block C',               priority:'NORMAL',status:'PUBLISHED',description:'The new High-Performance Computing Lab (Lab-7) in Block C has been inaugurated. It is equipped with 60 workstations with i7-13th Gen processors, 32 GB RAM, and GPU cards. Available for CSE/AI&ML/Data Science students from 1st July 2026.' },
  { title:'Industrial Visit – Third Year CSE/IT (Hyderabad Tech Park)',        priority:'NORMAL',status:'PUBLISHED',description:'A one-day industrial visit is organized for III Year CSE/IT students to the Hyderabad Tech Park (Microsoft and Google campuses) on 12th July 2026. Register and pay the nominal transport fee of Rs. 300 by 8th July. Bring your college ID cards.' },
  { title:'Student Feedback Survey – Semester 4 Faculty Feedback',            priority:'NORMAL',status:'PUBLISHED',description:'The Semester 4 Faculty Feedback survey is now open on the SITAM portal. All students are requested to submit their honest and constructive feedback before 5th July 2026. Feedback is strictly confidential and used for faculty development and academic improvement.' },
  { title:'Alumni Interaction Session – Career Guidance for II & III Year',   priority:'NORMAL',status:'PUBLISHED',description:'The Alumni Association is organizing an interaction session on 8th July 2026 in the Seminar Hall, Block A. Alumni from TCS, Infosys, and Microsoft will share their career experiences. All II and III year students are encouraged to attend.' },
  { title:'NAAC Accreditation Preparation – Student Briefing',                 priority:'HIGH',  status:'PUBLISHED',description:'The college is preparing for the NAAC Peer Team Visit scheduled in October 2026. A student briefing session will be held on 7th July 2026 to inform students about the NAAC process and their role. Student representatives from each branch must attend.' },
  { title:'Yoga & Wellness Day – 21st June 2026',                             priority:'NORMAL',status:'PUBLISHED',description:'On the occasion of International Yoga Day, the NSS unit of SITAM is organizing a Yoga & Wellness session on 21st June 2026 in the college grounds at 6:00 AM. All students and staff are invited to participate. Certificates will be issued to participants.' },
  { title:'Dress Code Reminder – Academic Year 2026-27',                       priority:'NORMAL',status:'PUBLISHED',description:'All students are reminded to adhere to the prescribed college dress code during working days. Students found violating the dress code will be denied entry. Casual wear is only permitted on designated Saturdays. Please refer to the Student Handbook for details.' },
  { title:'Sports Day – SITAM Annual Sports Fest KRIDA 2026',                 priority:'NORMAL',status:'PUBLISHED',description:'SITAM Annual Sports Fest KRIDA 2026 will be held from 15th–18th September 2026. Events include athletics, cricket, volleyball, badminton, chess, and kabaddi. Registration open till 10th September. Champions receive cash prizes and trophies.' },
  { title:'Emergency Contact Numbers – Campus Security Update',                priority:'NORMAL',status:'PUBLISHED',description:'The campus security emergency contact numbers have been updated. For any emergency, students may contact the Security Control Room at 040-2345-6789 (24x7). The numbers are also posted on the college notice boards and the SITAM Smart ERP app.' },
  { title:'[DRAFT] Revised Academic Calendar – Semester 5 (2026-27)',         priority:'NORMAL',status:'DRAFT',    description:'The revised academic calendar for Semester 5, Academic Year 2026-27 is being finalized. Expected commencement: 1st August 2026. Details will be published after the Board of Studies approval. This is a draft notice.' },
  { title:'[DRAFT] New Elective Subjects – Semester 7 (2026-27)',             priority:'NORMAL',status:'DRAFT',    description:'The CSE department proposes to offer the following elective subjects in Semester 7: (1) Blockchain Technology (2) Quantum Computing Fundamentals (3) DevOps & MLOps (4) Cybersecurity & Ethical Hacking. Student preference survey to be launched soon.' },
  { title:'[DRAFT] Updated Hostel Regulations – 2026-27',                     priority:'HIGH',  status:'DRAFT',    description:'Revised hostel regulations for the academic year 2026-27 are under review. Key changes include new gate-pass procedures, updated mess timings, and WiFi usage policies. The final regulation document will be shared after warden approval.' },
  { title:'[DRAFT] Cultural Fest SPANDANA 2026 – Event Categories',           priority:'NORMAL',status:'DRAFT',    description:'The cultural committee is planning the annual cultural fest SPANDANA 2026. Event categories under consideration: Classical Dance, Western Dance, Singing, Skit, Ramp Walk, Rangoli, and Photography Contest. Event dates tentatively set for October 2026.' },
  { title:'[DRAFT] Revised Fee Structure – Academic Year 2027-28',            priority:'HIGH',  status:'DRAFT',    description:'The college management is reviewing the fee structure for the Academic Year 2027-28. Proposed changes include a 5% revision in Tuition Fee and introduction of a Digital Learning Fee of Rs. 1,000 per semester. Final structure pending University approval.' },
];

// ──────────────────────────────────────────────────────────────────────────────
// Fee notices (15)
// ──────────────────────────────────────────────────────────────────────────────
const FEE_NOTICES = [
  { title:'Tuition Fee – Semester 5 Due Notice',                dueDate:dateStr(daysFromNow(12)), target:'ALL',        priority:'HIGH',   popup:true,  htBlock:true,  active:true,  desc:'Tuition Fee for Semester 5 (AY 2026-27) is now due – Rs.45,000. Late payment attracts Rs.100/day penalty. Contact Accounts Section for fee receipts and queries.' },
  { title:'Hostel Fee – Q3 (October–December 2026)',            dueDate:dateStr(daysFromNow(8)),  target:'HOSTEL',     priority:'HIGH',   popup:true,  htBlock:false, active:true,  desc:'Hostel fee for Q3 (Oct–Dec 2026) Rs.18,000 must be paid by 5th October. Students with outstanding dues from previous quarters must clear them first. Non-payment suspends hostel facility.' },
  { title:'Examination Fee – End Semester (November 2026)',     dueDate:dateStr(daysFromNow(5)),  target:'ALL',        priority:'URGENT', popup:true,  htBlock:true,  active:true,  desc:'Exam fee for End Semester Nov 2026 – Rs.1,200 per student. Mandatory for Hall Ticket. Pay online through the college fee portal or at the Accounts Section counter.' },
  { title:'Library Fine Payment – Overdue Books',               dueDate:dateStr(daysFromNow(3)),  target:'ALL',        priority:'HIGH',   popup:true,  htBlock:true,  active:true,  desc:'Students with overdue library books are notified to clear fines before 30th June 2026. Fine amount varies per student; individual statements at the library counter. Hall Tickets withheld until cleared.' },
  { title:'Bus Fee – Semester 5 (Annual Route Fee)',            dueDate:dateStr(daysFromNow(14)), target:'DAY_SCHOLARS',priority:'NORMAL', popup:true,  htBlock:false, active:true,  desc:'Annual Bus Route Fee for AY 2026-27 is due (Rs.8,000–Rs.15,000 by route). Students availing college bus services must pay before 31st July 2026. Contact Transport Office for details.' },
  { title:'Laboratory Development Fee – Semester 5',           dueDate:dateStr(daysFromNow(20)), target:'ALL',        priority:'NORMAL', popup:true,  htBlock:false, active:true,  desc:'Laboratory Development Fee of Rs. 2,000 is applicable for all students for Semester 5. Covers equipment maintenance, consumables, and new lab installations. Payment due by 20th August 2026.' },
  { title:'Tuition Fee – Semester 3 Balance Due (2025-26)',     dueDate:dateStr(daysFromNow(2)),  target:'ALL',        priority:'URGENT', popup:true,  htBlock:true,  active:true,  desc:'Students who have pending balance in Tuition Fee for Semester 3 (2025-26) are requested to clear the dues immediately. Continued default will result in Hall Ticket withholding. Contact Accounts Section.' },
  { title:'Sports & Games Fee – Annual (2026-27)',              dueDate:dateStr(daysFromNow(25)), target:'ALL',        priority:'NORMAL', popup:false, htBlock:false, active:true,  desc:'Annual Sports & Games Fee of Rs. 500 is due for all students for the academic year 2026-27. This fee supports KRIDA 2026 sports events and purchase of sports equipment. Pay at Accounts counter by 15th August.' },
  { title:'Caution Deposit – First Year Students',              dueDate:dateStr(daysFromNow(30)), target:'FIRST_YEAR', priority:'NORMAL', popup:true,  htBlock:false, active:true,  desc:'First year students who have not paid the refundable Caution Deposit of Rs. 5,000 are reminded to pay before 31st July 2026. Receipts must be kept safely for refund at course completion.' },
  { title:'Hostel Maintenance Fee – Annual (2026-27)',          dueDate:dateStr(daysFromNow(40)), target:'HOSTEL',     priority:'NORMAL', popup:false, htBlock:false, active:true,  desc:'Annual hostel maintenance fee of Rs. 3,000 covers room maintenance, plumbing, electrical repairs, and common area upkeep. All hostel residents must pay by 31st August 2026.' },
  { title:'Smart ERP App Registration – Nominal Fee',           dueDate:dateStr(daysFromNow(18)), target:'ALL',        priority:'NORMAL', popup:false, htBlock:false, active:true,  desc:'A one-time nominal fee of Rs. 100 is applicable for SITAM Smart ERP App registration. This covers app maintenance and server costs. Pay and complete registration before 15th July 2026.' },
  { title:'[CLOSED] Tuition Fee – Semester 4 (2025-26)',        dueDate:dateStr(daysAgo(10)),     target:'ALL',        priority:'HIGH',   popup:false, htBlock:true,  active:false, desc:'The due date for Semester 4 Tuition Fee payment has passed. Students who have still not paid are requested to visit the Accounts Section immediately. Penalty charges have been applied.' },
  { title:'[CLOSED] Exam Fee – Mid-Term Unit Test II (2025-26)',dueDate:dateStr(daysAgo(20)),     target:'ALL',        priority:'NORMAL', popup:false, htBlock:false, active:false, desc:'The examination fee collection for Mid-Term Unit Test II has been closed. Students who missed the payment window are advised to contact the Exam Section before the make-up deadline.' },
  { title:'NSS Activity Fee – Annual Contribution (2026-27)',   dueDate:dateStr(daysFromNow(35)), target:'NSS',        priority:'NORMAL', popup:false, htBlock:false, active:true,  desc:'NSS enrolled students are required to pay the annual contribution of Rs. 200 for NSS activities, camps, and community service programs for 2026-27. Payment due by 30th July at the NSS Office.' },
  { title:'Alumni Association Membership – Final Year Students',dueDate:dateStr(daysFromNow(60)), target:'FINAL_YEAR', priority:'NORMAL', popup:false, htBlock:false, active:true,  desc:'Final year students are requested to pay the one-time Alumni Association membership fee of Rs. 500. This gives lifetime membership to the SITAM Alumni Association and access to the alumni network.' },
];

// ──────────────────────────────────────────────────────────────────────────────
// Exit pass pools
// ──────────────────────────────────────────────────────────────────────────────
const EXIT_REASONS = [
  'Medical appointment at Yashoda Hospitals, Secunderabad',
  'Family emergency – father hospitalized at Care Hospital, Banjara Hills',
  'Bank account opening at SBI, KPHB Branch',
  'Passport application submission at Regional Passport Office, Begumpet',
  'Blood test at Dr. Reddy Diagnostics, Ameerpet',
  'Mother unwell – visiting home in Secunderabad',
  'Aadhar card update at Common Service Centre, Kukatpally',
  'Fee payment at bank – cheque submission for Semester 5',
  'Dental appointment at Smile Dental Clinic, SR Nagar',
  'Eye checkup at LV Prasad Eye Institute, Banjara Hills',
  'Scholarship interview at TGEPASS office, Masab Tank',
  'Sibling admitted to hospital – emergency family visit',
  'Train ticket collection – going home for family function',
  'Vehicle insurance renewal – Hyderabad RTO, Nampally',
  'Income certificate submission at Tahsildar Office, Uppal',
  'Court hearing regarding property matter at District Court, Nampally',
  'Sister\'s graduation ceremony at Osmania University',
  'Scholarship document verification at State Bank, Ameerpet',
  'Job interview at Infosys, Hitec City (campus placement follow-up)',
  'Visa document submission for university exchange program',
];
const EXIT_DESTINATIONS = [
  'Yashoda Hospitals, Secunderabad', 'KPHB Colony, Hyderabad',
  'SBI Bank, Ameerpet', 'Begumpet, Hyderabad',
  'Dr. Reddy Diagnostics, Ameerpet', 'Secunderabad Railway Station',
  'Uppal Government Hospital', 'LV Prasad Eye Institute, Banjara Hills',
  'Masab Tank, Hyderabad', 'SR Nagar, Hyderabad',
  'Dilsukhnagar, Hyderabad', 'Kukatpally, Hyderabad',
  'Nampally RTO, Hyderabad', 'Mehdipatnam, Hyderabad',
  'MGBS Imlibun Bus Station', 'District Court, Nampally',
  'Osmania University, Hyderabad', 'Infosys Campus, Hitec City',
  'Income Tax Office, Basheerbagh', 'KPMB Bus Stand, Majestic',
];
const REJECTION_NOTES = [
  'Insufficient reason provided. Please submit a supporting document.',
  'Parent approval letter required for medical leave.',
  'Late request – exit passes must be submitted before 9 AM on working days.',
  'Destination not within permitted radius for same-day return.',
  'Previous exit pass pending clearance. Resolve first.',
  'No classes to miss – submit again on a scheduled working day.',
  'Details incomplete. Provide contact number at destination.',
];

// ──────────────────────────────────────────────────────────────────────────────
// Audit log pool (30 entries)
// ──────────────────────────────────────────────────────────────────────────────
const AUDIT_ENTRIES = [
  { action:'ADMIN_LOGIN',         severity:'INFO',     detail:'Admin logged in from IP 192.168.1.105 using Chrome on Windows.' },
  { action:'ADMIN_LOGIN',         severity:'SECURITY', detail:'Admin login from unusual IP 103.45.67.89 – flagged for review.' },
  { action:'ADMIN_LOGOUT',        severity:'INFO',     detail:'Admin session ended after 2h 15m. All changes saved.' },
  { action:'ADMIN_LOGOUT',        severity:'INFO',     detail:'Admin auto-logged out due to session timeout (30 min idle).' },
  { action:'EXIT_PASS_APPROVED',  severity:'INFO',     detail:'Exit pass approved for student 25B61A0501. OTP dispatched via notification.' },
  { action:'EXIT_PASS_APPROVED',  severity:'INFO',     detail:'Exit pass approved for student 24B61A0412. Reason: Medical appointment.' },
  { action:'EXIT_PASS_APPROVED',  severity:'INFO',     detail:'Batch exit pass approval: 3 students approved for industrial visit to Tech Park.' },
  { action:'OTP_VERIFIED',        severity:'INFO',     detail:'OTP verified at main gate for exit pass. Gate scan by security guard Ravi Kumar.' },
  { action:'OTP_VERIFIED',        severity:'INFO',     detail:'OTP verified successfully. Student exit recorded at 14:35.' },
  { action:'OTP_VERIFIED',        severity:'WARNING',  detail:'OTP verification attempted after expiry. Student directed to warden for re-approval.' },
  { action:'OTP_VERIFIED',        severity:'CRITICAL', detail:'OTP reuse attempt detected for exit pass. Security incident logged. Pass invalidated.' },
  { action:'FEE_NOTICE_CREATED',  severity:'INFO',     detail:'New fee notice created: Tuition Fee Semester 5 Due Notice. Popup enabled.' },
  { action:'FEE_NOTICE_CREATED',  severity:'INFO',     detail:'New fee notice created: Examination Fee End Semester November 2026. Hall ticket block warning set.' },
  { action:'FEE_NOTICE_CREATED',  severity:'INFO',     detail:'Fee notice for Hostel Fee Q3 created and activated. Target: HOSTEL batch.' },
  { action:'PLACEMENT_PUBLISHED', severity:'INFO',     detail:'Placement drive for TCS Smart Hiring 2026 published. Notifications sent to 382 eligible students.' },
  { action:'PLACEMENT_PUBLISHED', severity:'INFO',     detail:'Placement drive for Infosys Campus Hiring published. Drive date: 25th July 2026.' },
  { action:'PLACEMENT_PUBLISHED', severity:'INFO',     detail:'Amazon SDE-I placement drive published. Restricted to CSE/IT students with 75%+ aggregate.' },
  { action:'MAINTENANCE_TOGGLE',  severity:'WARNING',  detail:'System maintenance mode ENABLED by Super Admin. All student logins blocked temporarily.' },
  { action:'MAINTENANCE_TOGGLE',  severity:'WARNING',  detail:'System maintenance mode DISABLED. Normal operations resumed. Duration: 45 minutes.' },
  { action:'ADMIN_LOGIN',         severity:'SECURITY', detail:'Multiple failed login attempts detected for admin account. Account temporarily locked.' },
  { action:'OTP_VERIFIED',        severity:'INFO',     detail:'Exit OTP verified for 5 students simultaneously during industrial visit departure.' },
  { action:'ADMIN_LOGIN',         severity:'INFO',     detail:'Placement admin logged in. New placement drives to be published for next week.' },
  { action:'FEE_NOTICE_CREATED',  severity:'INFO',     detail:'Exam fee notice created and popupEnabled set. Notifications queued for dispatch.' },
  { action:'EXIT_PASS_APPROVED',  severity:'INFO',     detail:'Exit pass approved for student who lost phone. OTP sent to registered email as fallback.' },
  { action:'ADMIN_LOGOUT',        severity:'INFO',     detail:'Security guard account logged out after shift end at 22:00.' },
  { action:'STUDENT_SYNC',        severity:'INFO',     detail:'Batch sync of 50 students completed. Data refreshed from ERP.' },
  { action:'STUDENT_SYNC',        severity:'WARNING',  detail:'Sync failed for 3 students due to ERP timeout. Retry queued.' },
  { action:'PLACEMENT_PUBLISHED', severity:'INFO',     detail:'Google SWE-I drive published. High demand expected. 120 eligible students notified.' },
  { action:'FEE_NOTICE_CREATED',  severity:'INFO',     detail:'Library Fine Payment notice created with Hall Ticket block warning. 47 students affected.' },
  { action:'ADMIN_LOGIN',         severity:'INFO',     detail:'Security admin logged in for shift starting 06:00 AM.' },
];

// ──────────────────────────────────────────────────────────────────────────────
// Notification templates
// ──────────────────────────────────────────────────────────────────────────────
const NOTIF_TEMPLATES = [
  { title:'Attendance Warning',           type:'attendance',  cat:'alert',   msg:(sub,fn)=>`Your attendance has dropped below 75% in ${sub}. Attend all classes to avoid being marked a defaulter, ${fn}.` },
  { title:'Marks Updated',               type:'marks',       cat:'update',  msg:(sub,fn)=>`Mid-Term Unit Test I marks for ${sub} have been updated. Your score: ${rndInt(40,98)}/100. Check the portal for details.` },
  { title:'Fee Reminder',                type:'fees',        cat:'reminder',msg:(sub,fn)=>`Tuition Fee payment of Rs. ${rndInt(5000,45000)} is due in ${rndInt(3,15)} days. Pay before the due date to avoid penalties, ${fn}.` },
  { title:'New Assignment Posted',       type:'assignments', cat:'update',  msg:(sub,fn)=>`A new assignment has been posted for ${sub}. Due date: ${dateStr(daysFromNow(7))}. Submit via the portal.` },
  { title:'Exam Schedule Released',      type:'exams',       cat:'alert',   msg:(sub,fn)=>`End Semester Examination schedule for November 2026 is now available. Download your hall ticket from the portal. Exam starts at 09:00 AM.` },
  { title:'Welcome to SITAM Smart ERP', type:'announcement',cat:'success', msg:(sub,fn)=>`Hello ${fn}! Welcome to the SITAM Smart ERP portal. Stay updated with your attendance, marks, and college notifications in real-time.` },
  { title:'Attendance Improved',         type:'attendance',  cat:'success', msg:(sub,fn)=>`Great job, ${fn}! Your attendance in ${sub} improved this week. Keep attending all classes.` },
  { title:'Hostel Fee Due',              type:'fees',        cat:'reminder',msg:(sub,fn)=>`Hostel fee for Q3 (October–December 2026) is now due. Pay Rs. 18,000 by 5th October 2026 to avoid suspension of hostel facility.` },
  { title:'Placement Drive: TCS Smart Hiring 2026', type:'announcement',cat:'alert', msg:(sub,fn)=>`TCS Smart Hiring 2026 is scheduled on 18th July 2026. You are eligible! Register now through the T&P portal before 15th July 2026.` },
  { title:'Excellent Performance',       type:'marks',       cat:'success', msg:(sub,fn)=>`Congratulations ${fn}! You scored O grade (${rndInt(90,100)}/100) in ${sub}. Keep up the excellent work!` },
  { title:'Quiz Results Available',      type:'marks',       cat:'update',  msg:(sub,fn)=>`Your quiz results for ${sub} are now available on the portal. Login to view your score.` },
  { title:'Holiday Notice',             type:'announcement',cat:'update',  msg:(sub,fn)=>`College will remain closed on ${dateStr(daysFromNow(rndInt(2,10)))} as a holiday. All scheduled classes stand postponed. Plan accordingly.` },
  { title:'New Course Material Added',   type:'assignments', cat:'update',  msg:(sub,fn)=>`New course materials have been uploaded for ${sub} on the LMS. Login to access study resources.` },
  { title:'Scholarship Application Reminder',type:'announcement',cat:'reminder',msg:(sub,fn)=>`Reminder: Scholarship application deadline is approaching, ${fn}. Ensure you have submitted all required documents before the cutoff date.` },
  { title:'Workshop Registration Open',  type:'announcement',cat:'alert',   msg:(sub,fn)=>`Registration is now open for an upcoming technical workshop on ${sub}. Limited seats available – register early via the college portal.` },
  { title:'Exam Hall Ticket Available',  type:'exams',       cat:'success', msg:(sub,fn)=>`${fn}, your hall ticket for the upcoming examination is now available. Download it from the student portal immediately.` },
  { title:'Backlog Clearance Notice',    type:'exams',       cat:'alert',   msg:(sub,fn)=>`You have a backlog in ${sub}. Clear it in the upcoming supplementary examination. Contact your HOD for guidance.` },
  { title:'Library Book Due',           type:'announcement',cat:'reminder',msg:(sub,fn)=>`${fn}, your borrowed library book is due for return. Return it to avoid accumulating fine charges.` },
  { title:'Placement Drive Reminder',    type:'announcement',cat:'reminder',msg:(sub,fn)=>`Reminder: Placement drive tomorrow. Bring resume (3 copies), original mark sheets, and college ID card.` },
  { title:'Internal Marks Uploaded',    type:'marks',       cat:'update',  msg:(sub,fn)=>`Internal assessment marks for ${sub} have been uploaded by your faculty. Login to view your performance.` },
];
const SUBJ_NAMES_FOR_NOTIF = [
  'Data Structures & Algorithms','Operating Systems','Computer Networks',
  'Database Management Systems','Web Technologies','Machine Learning',
  'Digital Electronics','Python Programming','Thermodynamics','Fluid Mechanics',
  'Deep Learning','VLSI Design','Software Engineering','Cloud Computing',
  'Artificial Intelligence','Java Programming','Discrete Mathematics',
];

// ══════════════════════════════════════════════════════════════════════════════
// Detect which models are available in the current Prisma client build.
// PostgreSQL prod schema may not have LMS models yet.
// ══════════════════════════════════════════════════════════════════════════════
const HAS_LMS = typeof prisma.department !== 'undefined' &&
                typeof prisma.faculty    !== 'undefined' &&
                typeof prisma.course     !== 'undefined';

// ══════════════════════════════════════════════════════════════════════════════
// MAIN SEED FUNCTION
// ══════════════════════════════════════════════════════════════════════════════
async function main() {
  const t0 = Date.now();
  console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║   SITAM Smart ERP  —  Production Demo Dataset Generator v2.0     ║');
  console.log('║   Target: July 15, 2026 Demo   |   Prisma + PostgreSQL           ║');
  console.log(`║   LMS Models: ${HAS_LMS ? 'AVAILABLE ✅' : 'NOT IN PG SCHEMA ⚠️  (LMS skipped)'}                     ║`);
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  // ── SENTINEL: Skip if already seeded (unless --reset) ─────────────────────
  if (!RESET) {
    const existingCount = await prisma.student.count();
    if (existingCount > 0) {
      console.log(`ℹ️   Sentinel check: ${existingCount} students already exist in the database.`);
      console.log('    Skipping re-seed to prevent duplicate data.');
      console.log('    ✅ Use --reset flag to wipe and re-seed: node prisma/seed-demo.js --reset');
      console.log('    ✅ Or run against an empty database.');
      return;
    }
    console.log('ℹ️   Sentinel check: database is empty — proceeding with full seed.\n');
  }

  // ── RESET ──────────────────────────────────────────────────────────────────
  if (RESET) {
    console.log('🗑️   --reset: Clearing all demo tables…');
    const drops = async () => {
      if (HAS_LMS) {
        await prisma.certificate.deleteMany({});
        await prisma.quizResult.deleteMany({});
        await prisma.lmsSubmission.deleteMany({});
        await prisma.courseProgress.deleteMany({});
        await prisma.courseEnrollment.deleteMany({});
        await prisma.lmsAssignment.deleteMany({});
        await prisma.lmsQuiz.deleteMany({});
        await prisma.course.deleteMany({});
        await prisma.faculty.deleteMany({});
        await prisma.department.deleteMany({});
      }
      await prisma.feeReminderLog.deleteMany({});
      await prisma.savedPlacement.deleteMany({});
      await prisma.lostFoundClaim.deleteMany({}).catch(()=>{});
      await prisma.lostFoundItem.deleteMany({}).catch(()=>{});
      await prisma.ticketReply.deleteMany({}).catch(()=>{});
      await prisma.helpTicket.deleteMany({}).catch(()=>{});
      await prisma.surveyAnswer.deleteMany({}).catch(()=>{});
      await prisma.surveyResponse.deleteMany({}).catch(()=>{});
      await prisma.surveyQuestion.deleteMany({}).catch(()=>{});
      await prisma.survey.deleteMany({}).catch(()=>{});
      await prisma.exitPass.deleteMany({});
      await prisma.notificationEvent.deleteMany({});
      await prisma.notification.deleteMany({});
      await prisma.assignment.deleteMany({});
      await prisma.fee.deleteMany({});
      await prisma.attendanceRecord.deleteMany({});
      await prisma.markRecord.deleteMany({});
      await prisma.timetableSlot.deleteMany({});
      await prisma.syllabusUnit.deleteMany({});
      await prisma.auditLog.deleteMany({});
      await prisma.fcmToken.deleteMany({});
      await prisma.session.deleteMany({});
      await prisma.student.deleteMany({});
      await prisma.subject.deleteMany({});
      await prisma.feeNotice.deleteMany({});
      await prisma.announcement.deleteMany({});
      await prisma.placement.deleteMany({});
      await prisma.adminNotification.deleteMany({});
      await prisma.companyVisit.deleteMany({});
    };
    try { await drops(); console.log('   ✅ All tables cleared.\n'); }
    catch (e) { console.warn('   ⚠️  Partial clean: ' + e.message + '\n'); }
  } else {
    console.log('ℹ️   Running in upsert/idempotent mode  (add --reset to wipe first).\n');
  }

  // ── 0. SystemSetting ───────────────────────────────────────────────────────
  console.log('⚙️   [0/12] SystemSetting…');
  await prisma.systemSetting.upsert({
    where:  { id: 'system' },
    update: {},
    create: { id:'system', maintenanceMode:false, maintenanceMessage:'SITAM Smart ERP is currently undergoing scheduled maintenance. Please try again later.' },
  });

  // ── 1. Admin accounts (5) ──────────────────────────────────────────────────
  console.log('👤   [1/12] Admin accounts…');
  const facultyPass = process.env.SEED_FACULTY_PASS;
  if (!facultyPass && process.env.NODE_ENV === 'production') {
    throw new Error('SEED_FACULTY_PASS environment variable is required in production');
  }
  const facultyPassToUse = facultyPass || 'Faculty@1234-Dev';

  const adminDefs = [
    { email:'admin@sitamecap.co.in',       name:'Super Administrator',     role:'SUPER_ADMIN'    },
    { email:'accounts@sitamecap.co.in',    name:'Accounts Admin',          role:'ACCOUNTS_ADMIN' },
    { email:'placements@sitamecap.co.in',  name:'Placements Admin',        role:'PLACEMENT_ADMIN'},
    { email:'security@sitamecap.co.in',    name:'Security Guard – Gate 1', role:'SECURITY_GUARD' },
    { email:'security2@sitamecap.co.in',   name:'Security Guard – Gate 2', role:'SECURITY_GUARD' },
    { email:'faculty@sitamecap.co.in',     name:'SITAM Faculty Member',    role:'FACULTY'        },
  ];
  const createdAdmins = [];
  for (const a of adminDefs) {
    const passToUse = a.role === 'FACULTY' ? facultyPassToUse : 'Admin@1234';
    const admin = await prisma.admin.upsert({
      where:  { email: a.email },
      update: { name: a.name, role: a.role, isActive: true },
      create: { email: a.email, passwordHash: hashPassword(passToUse), name: a.name, role: a.role },
    });
    createdAdmins.push(admin);
  }
  console.log(`   ✅ ${createdAdmins.length} admins ready`);

  // ── 2. Subjects (40) ───────────────────────────────────────────────────────
  console.log('\n📚   [2/12] Subjects…');
  const subjectMap = {};
  for (const s of SUBJECTS_DATA) {
    const subj = await prisma.subject.upsert({
      where:  { code: s.code },
      update: { name: s.name, credits: s.credits, semester: s.semester, branch: s.branch },
      create: { code: s.code, name: s.name, credits: s.credits, semester: s.semester, branch: s.branch },
    });
    subjectMap[s.code] = subj;
  }
  const subjectList = Object.values(subjectMap);
  console.log(`   ✅ ${subjectList.length} subjects ready`);

  // ── 2.5 Departments / Faculty / Courses (LMS) ──────────────────────────────
  const departmentMap = {};
  const facultyList   = [];
  const coursesList   = [];

  if (HAS_LMS) {
    console.log('\n🏫   [2.5] Departments (7)…');
    for (const d of [
      { code:'CSE',  name:'Computer Science & Engineering' },
      { code:'ECE',  name:'Electronics & Communication Engineering' },
      { code:'MECH', name:'Mechanical Engineering' },
      { code:'CIVIL',name:'Civil Engineering' },
      { code:'EEE',  name:'Electrical & Electronics Engineering' },
      { code:'IT',   name:'Information Technology' },
      { code:'AIML', name:'Artificial Intelligence & Machine Learning' },
    ]) {
      const dept = await prisma.department.upsert({
        where: { code: d.code }, update: { name: d.name }, create: d,
      });
      departmentMap[d.code] = dept;
    }
    console.log(`   ✅ ${Object.keys(departmentMap).length} departments`);

    console.log('\n🧑‍🏫   Faculty (20)…');
    for (let i = 0; i < FACULTY_DATA.length; i++) {
      const fd = FACULTY_DATA[i];
      const dept = departmentMap[fd.dept] || departmentMap['CSE'];
      const email = `faculty${i + 1}@sitamecap.co.in`;
      const f = await prisma.faculty.upsert({
        where:  { email },
        update: { name: fd.name, departmentId: dept.id },
        create: { email, passwordHash: hashPassword('Faculty@1234'), name: fd.name, phone:'98' + rndInt(10,99) + rndInt(1000000,9999999), departmentId: dept.id },
      });
      f._dept = fd.dept;
      facultyList.push(f);
    }
    console.log(`   ✅ ${facultyList.length} faculty`);

    console.log('\n📖   Courses (40)…');
    for (let i = 0; i < COURSES_DATA.length; i++) {
      const cd = COURSES_DATA[i];
      const dept = departmentMap[cd.dept] || departmentMap['CSE'];
      const fac  = facultyList[i % facultyList.length];
      const c = await prisma.course.upsert({
        where:  { code: cd.code },
        update: { name: cd.name, credits: cd.credits, departmentId: dept.id, facultyId: fac.id },
        create: { code: cd.code, name: cd.name, credits: cd.credits, departmentId: dept.id, facultyId: fac.id },
      });
      c._deptCode = cd.dept;
      coursesList.push(c);
    }
    console.log(`   ✅ ${coursesList.length} courses`);
  } else {
    console.log('\n⚠️   LMS models (Department/Faculty/Course) not found in current Prisma client.');
    console.log('    Re-run after db:setup-pg + prisma generate to unlock LMS seeding.');
  }

  // ── 3. Students (500) ──────────────────────────────────────────────────────
  console.log('\n🎓   [3/12] Students (500)…');
  const studentPassword = hashPassword('Student@123');
  const studentProfiles = [];
  const usedRolls = new Set();
  let globalSeq = 1;

  for (const [branch, year, count] of STUDENT_DIST) {
    const bc  = BRANCH_CODES[branch];
    const sem = YEAR_SEM[year][Math.floor(Math.random() * 2)];
    const yp  = YEAR_PREFIX[year];

    for (let i = 0; i < count; i++) {
      const gender    = Math.random() < 0.58 ? 'Male' : 'Female';
      const firstName = gender === 'Male' ? rnd(FIRST_MALE) : rnd(FIRST_FEMALE);
      const lastName  = rnd(LAST_NAMES);

      let roll, att = 0;
      do { roll = yp + bc.prefix + String(globalSeq + att).padStart(2,'0'); att++; }
      while (usedRolls.has(roll) && att < 200);
      globalSeq += att;
      usedRolls.add(roll);

      const cgpa      = rndFloat(5.5, 9.8, 2).toFixed(2);
      const pct       = Math.max(40, parseFloat(cgpa) * 10 - rndInt(0, 5)).toFixed(2);
      const dob       = `${rndInt(2000,2005)}-${String(rndInt(1,12)).padStart(2,'0')}-${String(rndInt(1,28)).padStart(2,'0')}`;
      const joinYear  = { 1:2025, 2:2024, 3:2023, 4:2022 }[year];
      const district  = rnd(DISTRICTS);
      const state     = rnd(STATES_LIST);
      const pincode   = rnd(PINCODES);

      studentProfiles.push({
        roll, name: `${firstName} ${lastName}`,
        email:       roll.toLowerCase() + '@sitamecap.co.in',
        phone:       rnd(['7','8','9']) + String(rndInt(100000000,999999999)),
        fPhone:      rnd(['7','8','9']) + String(rndInt(100000000,999999999)),
        gPhone:      rnd(['7','8','9']) + String(rndInt(100000000,999999999)),
        emergency:   rnd(['7','8','9']) + String(rndInt(100000000,999999999)),
        cgpa, pct, dob,
        hostel:      Math.random() < 0.38 ? 'Yes' : 'No',
        roomNo:      Math.random() < 0.38 ? 'B' + rndInt(1,4) + '-' + rndInt(100,450) : 'N/A',
        section:     rnd(['A','B','C']),
        branch, year: String(year), semester: String(parseInt(sem,10)),
        gender,
        fatherName:  rnd(FATHER_FIRST) + ' ' + lastName,
        motherName:  rnd(MOTHER_FIRST) + ' ' + lastName,
        guardName:   rnd(FIRST_MALE) + ' ' + lastName,
        address:     `${rndInt(1,100)}, ${district}, ${state} – ${pincode}`,
        admNo:       'SITAM' + year + String(rndInt(1000,9999)),
        joinDate:    `${joinYear}-${String(rndInt(6,8)).padStart(2,'0')}-01`,
        aadhar:      String(rndInt(200000000000, 999999999999)),
        bloodGroup:  rnd(BLOOD_GROUPS),
        religion:    rnd(RELIGIONS),
        caste:       rnd(CASTES),
        seatType:    rnd(SEAT_TYPES),
        entrType:    rnd(ENTRANCE_TYPES),
        entrRank:    String(rndInt(1000,99999)),
        scholarship: rnd(SCHOLARSHIPS),
        sscMarks:    String(rndInt(55,98)) + '%',
        interMarks:  String(rndInt(60,99)) + '%',
        photoUrl:    `https://ui-avatars.com/api/?name=${encodeURIComponent(firstName + '+' + lastName)}&size=200&background=random&color=fff`,
        program:     'B.Tech',
      });
    }
  }

  const finalStudents = studentProfiles.slice(0, 500);
  const createdStudents = [];

  for (let idx = 0; idx < finalStudents.length; idx++) {
    const sp = finalStudents[idx];
    if ((idx + 1) % 100 === 0) console.log(`   … ${idx + 1}/500`);
    try {
      const s = await prisma.student.upsert({
        where:  { userId: sp.roll },
        update: { name: sp.name, email: sp.email, phone: sp.phone, branch: sp.branch, semester: sp.semester, year: sp.year, cgpa: sp.cgpa, percentage: sp.pct, lastSync: new Date() },
        create: {
          userId: sp.roll, password: studentPassword,
          name: sp.name, roll: sp.roll, roll_number: sp.roll,
          program: sp.program, branch: sp.branch, semester: sp.semester,
          section: sp.section, year: sp.year, gender: sp.gender,
          dob: sp.dob, email: sp.email, phone: sp.phone,
          fatherName: sp.fatherName, motherName: sp.motherName,
          fatherMobile: sp.fPhone, hostel: sp.hostel, roomNo: sp.roomNo,
          cgpa: sp.cgpa, percentage: sp.pct, address: sp.address,
          admissionNo: sp.admNo, joiningDate: sp.joinDate,
          caste: sp.caste, nationality: 'Indian', religion: sp.religion,
          sscMarks: sp.sscMarks, interMarks: sp.interMarks,
          scholarship: sp.scholarship, seatType: sp.seatType,
          entranceType: sp.entrType, entranceRank: sp.entrRank,
          aadhar: sp.aadhar, photoUrl: sp.photoUrl,
          guardianName: sp.guardName, guardianPhone: sp.gPhone,
          guardianAddress: sp.address, bloodGroup: sp.bloodGroup,
          emergencyContact: sp.emergency, lastSync: new Date(),
        },
      });
      s._profile = sp;
      createdStudents.push(s);
    } catch (err) {
      console.warn(`   ⚠️  Student ${sp.roll}: ${err.message}`);
    }
  }
  console.log(`   ✅ ${createdStudents.length} students ready`);

  // ── 3.5 LMS (Enrollments, Assignments, Quizzes, Progress, Certs) ───────────
  let enrollCnt=0, progCnt=0, certCnt=0, lmsAsnCnt=0, lmsQzCnt=0, subCnt=0, qrCnt=0;
  const courseAssignments = [];
  const courseQuizzes     = [];

  if (HAS_LMS && coursesList.length > 0) {
    console.log('\n📚   [3.5] LMS – Assignments & Quizzes…');

    // 40 courses × 5 assignments = 200
    for (const c of coursesList) {
      for (let j = 1; j <= 5; j++) {
        const a = await prisma.lmsAssignment.create({ data: {
          courseId: c.id,
          title: `${c.name} – Assignment ${j}`,
          description: `Submit solutions for Unit ${j} topics of ${c.name}. Use proper format and references. Late submissions penalised.`,
          dueDate: dateStr(daysFromNow(j * 4 + rndInt(1,5))),
          maxPoints: 100,
        }});
        courseAssignments.push(a);
        lmsAsnCnt++;
      }
      // 2–3 quizzes per course → ~100
      const qCount = Math.random() < 0.5 ? 2 : 3;
      for (let k = 1; k <= qCount; k++) {
        const q = await prisma.lmsQuiz.create({ data: {
          courseId: c.id,
          title: `${c.name} – Quiz ${k}`,
          description: `MCQ quiz on key topics of ${c.name} Unit ${k}. Time limit: 30 minutes.`,
          durationMin: rnd([20,30,45]),
          maxPoints: 100,
        }});
        courseQuizzes.push(q);
        lmsQzCnt++;
      }
    }
    console.log(`   ✅ ${lmsAsnCnt} LMS assignments, ${lmsQzCnt} quizzes`);

    console.log('   LMS – Enrollments, Progress, Submissions, Results…');
    for (const s of createdStudents) {
      const branchC = coursesList.filter(c => c._deptCode === s.branch);
      const pool    = branchC.length >= 4 ? branchC : coursesList;
      const numEnroll = Math.min(rndInt(4,8), pool.length);
      const picked = new Set();
      const myc = [];
      let tr = 0;
      while (myc.length < numEnroll && tr < 200) {
        const c = rnd(pool); tr++;
        if (!picked.has(c.id)) { picked.add(c.id); myc.push(c); }
      }

      for (const c of myc) {
        try { await prisma.courseEnrollment.create({ data: { studentId: s.id, courseId: c.id } }); enrollCnt++; } catch(_){}
        const done = Math.random() < 0.12;
        const pct2 = done ? 100.0 : rndFloat(5,95,1);
        try { await prisma.courseProgress.create({ data: { studentId: s.id, courseId: c.id, progressPct: pct2, completed: done } }); progCnt++; } catch(_){}
        if (done) {
          try { await prisma.certificate.create({ data: { studentId: s.id, courseId: c.id, certNumber: 'CERT-SITAM-' + uid() } }); certCnt++; } catch(_){}
        }
        for (const asn of courseAssignments.filter(a => a.courseId === c.id)) {
          if (Math.random() < 0.78) {
            const graded = Math.random() < 0.6;
            try {
              await prisma.lmsSubmission.create({ data: {
                assignmentId: asn.id, studentId: s.id,
                status: graded ? 'GRADED' : 'SUBMITTED',
                points: graded ? rndInt(55,100) : null,
                feedback: graded ? rnd(['Well done!','Good effort.','Needs improvement.','Excellent work!','Satisfactory.','Very good – keep it up!']) : '',
              }});
              subCnt++;
            } catch(_){}
          }
        }
        for (const q of courseQuizzes.filter(q2 => q2.courseId === c.id)) {
          if (Math.random() < 0.70) {
            try { await prisma.quizResult.create({ data: { quizId: q.id, studentId: s.id, score: rndInt(35,100) } }); qrCnt++; } catch(_){}
          }
        }
      }
    }
    console.log(`   ✅ Enrollments:${enrollCnt}  Progress:${progCnt}  Certs:${certCnt}  Submissions:${subCnt}  QuizResults:${qrCnt}`);
  }

  // ── 4. Fee Records (~500 target: Paid≈350, Partial≈90, Pending≈60) ─────────
  console.log('\n💰   [4/12] Fee Records (target 500)…');
  const FEE_TYPES = ['Tuition Fee','Hostel Fee','Exam Fee','Library Fine','Bus Fee','Lab Fee','Misc Fee'];
  let feeCount = 0;

  const feeRows = [];
  for (let idx = 0; idx < createdStudents.length; idx++) {
    const s  = createdStudents[idx];
    const sp = s._profile;
    const pct3 = idx / createdStudents.length;
    const amount = rndFloat(5000, 55000, 2);
    let paidAmt, dueAmt, payStatus;
    if      (pct3 < 0.70) { paidAmt = amount; dueAmt = 0;                     payStatus = 'Paid';    }
    else if (pct3 < 0.88) { paidAmt = rndFloat(amount*0.2, amount*0.85, 2); dueAmt = parseFloat((amount-paidAmt).toFixed(2)); payStatus = 'Partial'; }
    else                  { paidAmt = 0;       dueAmt = amount;              payStatus = 'Unpaid';  }
    const ddOff = pct3 < 0.70 ? -rndInt(1,30) : rndInt(1,45);
    const ddObj = ddOff >= 0 ? daysFromNow(ddOff) : daysAgo(Math.abs(ddOff));
    feeRows.push({ studentId: s.id, semester: sp.semester, feeType: rnd(FEE_TYPES), amount, paidAmount: paidAmt, dueAmount: Math.max(0,dueAmt), dueDate: dateStr(ddObj), paymentStatus: payStatus });
  }
  // Extra fee rows for first 150 students (multiple fee types)
  for (const s of createdStudents.slice(0, 150)) {
    const sp = s._profile;
    const a2 = rndFloat(1000, 18000, 2);
    const p2 = rndFloat(a2*0.5, a2, 2);
    const d2 = parseFloat((a2 - p2).toFixed(2));
    feeRows.push({ studentId: s.id, semester: sp.semester, feeType: rnd(['Exam Fee','Library Fine','Lab Fee']), amount: a2, paidAmount: p2, dueAmount: Math.max(0,d2), dueDate: dateStr(daysFromNow(rndInt(5,45))), paymentStatus: d2 <= 0 ? 'Paid' : 'Partial' });
  }

  for (const fr of feeRows) {
    try { await prisma.fee.create({ data: fr }); feeCount++; } catch(_){}
  }
  console.log(`   ✅ ${feeCount} fee records  (Paid≈350 | Partial≈90 | Pending≈60)`);

  // ── 5. Attendance Records (target 15,000) ──────────────────────────────────
  // 500 students × 30 subject records each = 15,000
  // Attendance bands:
  //   95-100%: first 40 students    → Excellent
  //   90-95%:  next  120 students   → Good
  //   80-90%:  next  200 students   → Acceptable
  //   75-80%:  next  90 students    → Warning
  //   <75%:    last  50 students    → Defaulter
  console.log('\n📋   [5/12] Attendance Records (target 15,000)…');

  function getAttBand(idx) {
    if (idx < 40)  return [0.95, 1.00];
    if (idx < 160) return [0.90, 0.95];
    if (idx < 360) return [0.80, 0.90];
    if (idx < 450) return [0.75, 0.80];
    return [0.50, 0.74];
  }

  const attRows = [];
  for (let si = 0; si < createdStudents.length; si++) {
    const s    = createdStudents[si];
    const band = getAttBand(si);
    const usedS = new Set();
    for (let a = 0; a < 30; a++) {
      let sub, tr2 = 0;
      do { sub = rnd(subjectList); tr2++; } while (usedS.has(sub.id) && tr2 < 60);
      if (usedS.has(sub.id)) continue;
      usedS.add(sub.id);
      const held     = rndInt(25,65);
      const targetPct = rndFloat(band[0], band[1], 4);
      const attended  = Math.min(held, Math.max(0, Math.round(held * targetPct)));
      const pct4      = parseFloat(((attended / held) * 100).toFixed(2));
      const status    = pct4 >= 90 ? 'Excellent' : pct4 >= 80 ? 'Good' : pct4 >= 75 ? 'Acceptable' : 'Warning';
      attRows.push({ studentId: s.id, subjectId: sub.id, held, attended, percentage: pct4, status, date: dateStr(daysAgo(rndInt(1,45))) });
    }
  }

  let attCount = 0;
  const ATT_CHUNK = 300;
  for (let i = 0; i < attRows.length; i += ATT_CHUNK) {
    const chunk = attRows.slice(i, i + ATT_CHUNK);
    try {
      await prisma.$transaction(chunk.map(r => prisma.attendanceRecord.create({ data: r })));
      attCount += chunk.length;
    } catch(_) {
      for (const r of chunk) { try { await prisma.attendanceRecord.create({ data: r }); attCount++; } catch(__){} }
    }
    if (attCount % 5000 === 0 && attCount > 0) console.log(`   … ${attCount} attendance records`);
  }
  console.log(`   ✅ ${attCount} attendance records`);

  // ── 6. Mark Records (target 3,000) ────────────────────────────────────────
  // 500 students × 6 subjects = 3,000
  console.log('\n📝   [6/12] Mark Records (target 3,000)…');

  const gradeFor = m => {
    if (m>=90) return {grade:'O', status:'Pass'};
    if (m>=80) return {grade:'A+',status:'Pass'};
    if (m>=70) return {grade:'A', status:'Pass'};
    if (m>=60) return {grade:'B+',status:'Pass'};
    if (m>=50) return {grade:'B', status:'Pass'};
    if (m>=40) return {grade:'C', status:'Pass'};
    return {grade:'F', status: Math.random()<0.5?'Fail':'Backlog'};
  };
  const MARK_TYPES = ['Core','Lab','Internal','External'];

  const markRows = [];
  for (const s of createdStudents) {
    const cgpaNum = parseFloat(s._profile.cgpa);
    const usedS   = new Set();
    for (let m = 0; m < 6; m++) {
      let sub, tr3 = 0;
      do { sub = rnd(subjectList); tr3++; } while (usedS.has(sub.id) && tr3 < 60);
      if (usedS.has(sub.id)) continue;
      usedS.add(sub.id);
      const baseMin = Math.max(30, Math.round(cgpaNum * 9 - 15));
      const baseMax = Math.min(100, Math.round(cgpaNum * 10 + 3));
      const marks   = rndInt(baseMin, baseMax);
      const { grade, status } = gradeFor(marks);
      markRows.push({ studentId: s.id, subjectId: sub.id, grade, status, credits: sub.credits, type: rnd(MARK_TYPES), marks, maxMarks: 100 });
    }
  }

  let markCount = 0;
  const MRK_CHUNK = 300;
  for (let i = 0; i < markRows.length; i += MRK_CHUNK) {
    const chunk = markRows.slice(i, i + MRK_CHUNK);
    try {
      await prisma.$transaction(chunk.map(r => prisma.markRecord.create({ data: r })));
      markCount += chunk.length;
    } catch(_) {
      for (const r of chunk) { try { await prisma.markRecord.create({ data: r }); markCount++; } catch(__){} }
    }
  }
  console.log(`   ✅ ${markCount} mark records`);

  // ── 7. Legacy Assignments (200) ────────────────────────────────────────────
  console.log('\n📌   [7/12] Legacy Assignments (200)…');
  const ASSIGN_TITLES = [
    'Binary Trees – Traversal Techniques','Network Topology Design','Database ER Diagram',
    'OS Process Scheduling Simulation','Web Page Layout using HTML5 & CSS3',
    'Python Data Analysis Project','Java OOP Implementation','Cloud Architecture Design',
    'ML Model – Linear Regression','Digital Circuit Design',
    'Software Requirements Specification','Compiler Lexical Analysis',
    'Microprocessor Assembly Language Program','VLSI Gate-Level Design',
    'Thermodynamic Cycle Analysis','Strength of Materials – Beam Analysis',
    'Fluid Flow Simulation Report','Electrical Machine Performance Analysis',
    'Signal Processing MATLAB Lab','Deep Learning Image Classifier',
    'Sorting Algorithm Visualiser','REST API Design – Node.js',
    'Linked List Implementation in C','TCP/IP Protocol Stack Analysis',
    'ER Diagram – Hospital Management System',
  ];
  let legAsnCnt = 0;
  const asnPool = [...createdStudents, ...createdStudents].slice(0, 200);
  for (const s of asnPool) {
    try {
      await prisma.assignment.create({ data: {
        studentId: s.id,
        title:     rnd(ASSIGN_TITLES),
        subject:   rnd(subjectList).name,
        status:    Math.random() < 0.75 ? 'Submitted' : 'Pending',
        date:      dateStr(daysFromNow(rndInt(3,21))),
      }});
      legAsnCnt++;
    } catch(_){}
    if (legAsnCnt >= 200) break;
  }
  console.log(`   ✅ ${legAsnCnt} legacy assignments`);

  // ── 8. Notifications (target 200) ─────────────────────────────────────────
  console.log('\n🔔   [8/12] Notifications (target 200)…');
  let notifCount = 0;
  for (let ni = 0; notifCount < 250 && ni < 400; ni++) {
    const s    = createdStudents[ni % createdStudents.length];
    const tmpl = rnd(NOTIF_TEMPLATES);
    const sub  = rnd(SUBJ_NAMES_FOR_NOTIF);
    const fn   = (s._profile.name || '').split(' ')[0] || 'Student';
    try {
      await prisma.notification.create({ data: {
        studentId: s.id, title: tmpl.title, message: tmpl.msg(sub, fn),
        type: tmpl.type, category: tmpl.cat,
        isRead: Math.random() < 0.45,
        date: dateStr(daysAgo(rndInt(0,30))),
      }});
      notifCount++;
    } catch(_){}
  }
  console.log(`   ✅ ${notifCount} notifications`);

  // ── 9. Exit Passes (80 total: 20 per status) ───────────────────────────────
  console.log('\n🚪   [9/12] Exit Passes (80 – 20 per status)…');
  const EP_GROUPS = [
    { status:'PENDING',  count:20 },
    { status:'APPROVED', count:20 },
    { status:'USED',     count:20 },
    { status:'REJECTED', count:20 },
  ];
  const superAdmin = createdAdmins[0];
  const secGuard   = createdAdmins[3];
  let epCount = 0, epIdx = 0;

  for (const epGroup of EP_GROUPS) {
    for (let i = 0; i < epGroup.count; i++) {
      const s   = createdStudents[epIdx % createdStudents.length];
      epIdx += 6;
      let extra = {};
      if (epGroup.status === 'APPROVED') {
        const otp = String(rndInt(100000,999999));
        extra = { otpHash: hashOTP(otp), otpExpiry: daysFromNow(rndInt(1,2)), approvedAt: daysAgo(rndInt(0,5)), approvedBy: superAdmin.id, qrCode: 'https://sitam-erp.app/ep/verify/' + crypto.randomBytes(8).toString('hex') };
      } else if (epGroup.status === 'USED') {
        const otp = String(rndInt(100000,999999));
        extra = { otpHash: hashOTP(otp), otpExpiry: daysAgo(rndInt(1,10)), approvedAt: daysAgo(rndInt(3,12)), approvedBy: superAdmin.id, verifiedAt: daysAgo(rndInt(0,3)), verifiedBy: secGuard.id, qrCode: 'https://sitam-erp.app/ep/verify/' + crypto.randomBytes(8).toString('hex') };
      } else if (epGroup.status === 'REJECTED') {
        extra = { rejectionNote: rnd(REJECTION_NOTES) };
      }
      try {
        await prisma.exitPass.create({ data: { studentId: s.id, reason: rnd(EXIT_REASONS), destination: rnd(EXIT_DESTINATIONS), requestedDate: dateStr(daysAgo(rndInt(0,20))), status: epGroup.status, ...extra } });
        epCount++;
      } catch(err) { console.warn(`   ⚠️  ExitPass: ${err.message}`); }
    }
  }
  console.log(`   ✅ ${epCount} exit passes  (20 PENDING | 20 APPROVED | 20 USED | 20 REJECTED)`);

  // ── 10. Placements (60 records) ────────────────────────────────────────────
  console.log('\n🏢   [10/12] Placements (60)…');
  const DRIVE_LINKS = [
    'https://docs.google.com/forms/d/e/1FAIpQLSdemo_TCS_2026/viewform',
    'https://docs.google.com/forms/d/e/1FAIpQLSdemo_Infosys_2026/viewform',
    'https://docs.google.com/forms/d/e/1FAIpQLSdemo_Wipro_2026/viewform',
    'https://docs.google.com/forms/d/e/1FAIpQLSdemo_Accenture_2026/viewform',
    'https://forms.gle/SITAMPlacementDrive2026A',
    'https://forms.gle/SITAMPlacementDrive2026B',
    'https://tcs.com/careers/campus/sitam2026',
    'https://infosys.com/campus/sitam2026',
  ];
  let placementCount = 0;
  for (let i = 0; i < COMPANIES.length; i++) {
    const c = COMPANIES[i];
    const status = i < 35 ? 'PUBLISHED' : 'DRAFT';
    const ddd = i < 30 ? rndInt(5,90) : -rndInt(1,45);
    const ddObj = ddd >= 0 ? daysFromNow(ddd) : daysAgo(Math.abs(ddd));
    const yr = new Date().getFullYear();
    try {
      await prisma.placement.create({ data: {
        companyName: c.name, jobRole: c.role, packageLpa: c.pkg, eligibility: c.elig,
        description: `${c.name} is visiting SITAM for campus recruitment ${yr}. Role: ${c.role}. CTC: ${c.pkg} LPA. Eligibility: ${c.elig}. Process: Aptitude Test → Technical Round → HR Interview. Bring 3 copies of resume, original mark sheets, and college ID.`,
        registrationLink: rnd(DRIVE_LINKS),
        driveDate: dateStr(ddObj), status,
        notificationSent: status === 'PUBLISHED',
        companyArrivedToday: c.arv,
        location: rnd(['Hyderabad','Bengaluru','Chennai','Pune','Noida']),
        lastDate: dateStr(daysFromNow(rndInt(2,14))),
      }});
      placementCount++;
    } catch(err) { console.warn(`   ⚠️  Placement ${c.name}: ${err.message}`); }
  }
  console.log(`   ✅ ${placementCount} placement records  (35 PUBLISHED | ${placementCount-35} DRAFT | 3 arrived today)`);

  // ── 11. Announcements (25) + Fee Notices (15) ──────────────────────────────
  console.log('\n📢   [11/12] Announcements & Fee Notices…');
  let annCnt = 0, fnCnt = 0;
  for (const a of ANNOUNCEMENTS) {
    try {
      await prisma.announcement.create({ data: { title: a.title, description: a.description, priority: a.priority, status: a.status, link: a.status === 'PUBLISHED' && Math.random() < 0.4 ? 'https://sitamecap.co.in/notices/' + crypto.randomBytes(4).toString('hex') : null } });
      annCnt++;
    } catch(_){}
  }
  for (const fn of FEE_NOTICES) {
    try {
      await prisma.feeNotice.create({ data: { title: fn.title, description: fn.desc, dueDate: fn.dueDate, targetBatch: fn.target, priority: fn.priority, popupEnabled: fn.popup, notificationEnabled: true, hallTicketBlockWarning: fn.htBlock, isActive: fn.active } });
      fnCnt++;
    } catch(_){}
  }
  console.log(`   ✅ ${annCnt} announcements  |  ${fnCnt} fee notices`);

  // ── 12. Audit Logs (100) + Admin Notifications + Structured Timetable ───────
  console.log('\n📊   [12/17] Audit Logs (100 recent-activity entries)…');

  // 100 realistic ERP activity entries
  const RICH_AUDIT = [
    // Admin logins / sessions
    { action:'ADMIN_LOGIN',         sev:'INFO',     det:'Super Admin logged in from Chrome on Windows. IP: 192.168.1.105.' },
    { action:'ADMIN_LOGIN',         sev:'INFO',     det:'Placements Admin logged in. New campus drive to be published today.' },
    { action:'ADMIN_LOGIN',         sev:'INFO',     det:'Accounts Admin logged in. Fee collection review for Q2.' },
    { action:'ADMIN_LOGIN',         sev:'SECURITY', det:'Multiple failed login attempts detected. Admin account temporarily locked for 15 minutes.' },
    { action:'ADMIN_LOGIN',         sev:'INFO',     det:'Security Guard (Gate 1) logged in for morning shift at 06:00 AM.' },
    { action:'ADMIN_LOGIN',         sev:'INFO',     det:'Security Guard (Gate 2) logged in for evening shift at 14:00.' },
    { action:'ADMIN_LOGOUT',        sev:'INFO',     det:'Admin session ended after 3h 12m. All pending changes were saved.' },
    { action:'ADMIN_LOGOUT',        sev:'INFO',     det:'Placement Admin auto-logged out due to 30-minute idle timeout.' },
    { action:'ADMIN_LOGOUT',        sev:'INFO',     det:'Security Guard shift ended at 22:00. Session closed.' },
    { action:'ADMIN_LOGOUT',        sev:'INFO',     det:'Accounts Admin logged out after completing fee notice review.' },
    // Exit passes
    { action:'EXIT_PASS_APPROVED',  sev:'INFO',     det:'Exit pass approved for student 25B61A0503 (Arjun Reddy). Reason: Medical appointment. OTP dispatched.' },
    { action:'EXIT_PASS_APPROVED',  sev:'INFO',     det:'Exit pass approved for student 24B61A0412. Reason: Bank account opening. OTP sent.' },
    { action:'EXIT_PASS_APPROVED',  sev:'INFO',     det:'Exit pass approved for student 23B61A0218 (CSE Y3). Reason: Family emergency.' },
    { action:'EXIT_PASS_APPROVED',  sev:'INFO',     det:'Batch approval: 3 students approved for industrial visit. OTPs dispatched to all.' },
    { action:'EXIT_PASS_APPROVED',  sev:'INFO',     det:'Exit pass approved for student 22B61A0105. Hostel warden co-approval received.' },
    { action:'EXIT_PASS_REJECTED',  sev:'WARNING',  det:'Exit pass rejected for student 25B61A0311. Reason: Insufficient documentation for medical leave.' },
    { action:'EXIT_PASS_REJECTED',  sev:'WARNING',  det:'Exit pass rejected: Late submission (after 9 AM deadline). Student re-applied next day.' },
    // OTP events
    { action:'OTP_VERIFIED',        sev:'INFO',     det:'OTP verified at Main Gate for student 25B61A0503. Exit recorded at 14:35 by Security Guard.' },
    { action:'OTP_VERIFIED',        sev:'INFO',     det:'OTP verified at Gate 2. Student 24B61A0209 exit confirmed at 11:20.' },
    { action:'OTP_VERIFIED',        sev:'INFO',     det:'OTP verified for 3 students departing for industrial visit. Time: 09:05 AM.' },
    { action:'OTP_VERIFIED',        sev:'WARNING',  det:'OTP verification attempted after expiry. Student directed to warden for re-approval.' },
    { action:'OTP_VERIFIED',        sev:'CRITICAL', det:'OTP reuse attempt detected for exit pass EP-2026-0041. Pass invalidated. Security incident logged.' },
    { action:'OTP_VERIFIED',        sev:'INFO',     det:'OTP verified at Main Gate. Student 22B61A0117 (final year) exited at 15:45.' },
    // Fee
    { action:'FEE_NOTICE_CREATED',  sev:'INFO',     det:'New fee notice created: "Tuition Fee – Semester 5 Due Notice". Popup and Hall Ticket block enabled. Due: 25 July 2026.' },
    { action:'FEE_NOTICE_CREATED',  sev:'INFO',     det:'Fee notice created: "Examination Fee – End Semester Nov 2026". Target: ALL students. Priority: URGENT.' },
    { action:'FEE_NOTICE_CREATED',  sev:'INFO',     det:'Fee notice created: "Hostel Fee Q3 (Oct–Dec 2026)". Target: HOSTEL batch. Popup enabled.' },
    { action:'FEE_NOTICE_CREATED',  sev:'INFO',     det:'Fee notice created: "Library Fine Payment – Overdue Books". Hall Ticket block warning set. 47 students affected.' },
    { action:'FEE_PAYMENT_RECEIVED',sev:'INFO',     det:'Fee payment received: Rs.45,000 (Tuition Fee Sem 5) from student 25B61A0501.' },
    { action:'FEE_PAYMENT_RECEIVED',sev:'INFO',     det:'Partial fee payment: Rs.22,000 of Rs.45,000 Tuition Fee from student 24B61A0312.' },
    { action:'FEE_PAYMENT_RECEIVED',sev:'INFO',     det:'Fee payment batch: 12 students cleared Exam Fee (Rs.1,200 each). Total: Rs.14,400.' },
    // Placements
    { action:'PLACEMENT_PUBLISHED', sev:'INFO',     det:'Placement drive published: TCS Smart Hiring 2026 on 18 July. Notifications sent to 382 eligible students (CSE/IT/ECE).' },
    { action:'PLACEMENT_PUBLISHED', sev:'INFO',     det:'Placement drive published: Infosys Campus Hiring. Drive date: 25 July 2026. All branches eligible.' },
    { action:'PLACEMENT_PUBLISHED', sev:'INFO',     det:'Placement drive published: Accenture ASE. CTC: 4.5 LPA. Notifications sent to all 4-year students.' },
    { action:'PLACEMENT_PUBLISHED', sev:'INFO',     det:'Placement drive published: Amazon SDE-I (12 LPA). Restricted to CSE/IT students with 75%+ aggregate.' },
    { action:'PLACEMENT_PUBLISHED', sev:'INFO',     det:'Placement drive published: Google SWE-I (22 LPA). 38 eligible students notified immediately.' },
    { action:'PLACEMENT_PUBLISHED', sev:'INFO',     det:'Placement drive published: Wipro Project Engineer. Drive date: 20 July 2026. CSE/IT branch eligible.' },
    // Maintenance
    { action:'MAINTENANCE_TOGGLE',  sev:'WARNING',  det:'System maintenance mode ENABLED by Super Admin at 02:00 AM. All student logins blocked for scheduled upgrade.' },
    { action:'MAINTENANCE_TOGGLE',  sev:'WARNING',  det:'System maintenance mode DISABLED at 02:45 AM. Normal operations resumed. Downtime: 45 minutes.' },
    // Announcements
    { action:'ANNOUNCEMENT_CREATED',sev:'INFO',     det:'Announcement published: "End Semester Exams – November 2026 Schedule Released". Priority: URGENT.' },
    { action:'ANNOUNCEMENT_CREATED',sev:'INFO',     det:'Announcement published: "SITAM Hackathon 2026 – Registrations Open". 300+ students viewed within 1 hour.' },
    { action:'ANNOUNCEMENT_CREATED',sev:'INFO',     det:'Announcement published: "Campus Placement Drive – TCS Smart Hiring 2026".' },
    { action:'ANNOUNCEMENT_CREATED',sev:'INFO',     det:'Announcement draft saved: "Revised Academic Calendar Semester 5". Pending Board of Studies approval.' },
    // Student data
    { action:'STUDENT_SYNC',        sev:'INFO',     det:'Batch data sync completed for 50 CSE students. All records updated successfully.' },
    { action:'STUDENT_SYNC',        sev:'WARNING',  det:'Data sync failed for 3 students due to ERP response timeout. Retry queued for 14:00.' },
    { action:'STUDENT_SYNC',        sev:'INFO',     det:'Full batch sync of 500 students completed in 84.6s. All records current.' },
    // Attendance entries (realistic ERP)
    { action:'ATTENDANCE_UPDATED',  sev:'INFO',     det:'Attendance updated for CSE Sem 5 Section A: 38/40 students present. Subject: Machine Learning.' },
    { action:'ATTENDANCE_UPDATED',  sev:'INFO',     det:'Attendance updated for ECE Sem 3 Section B: 19/20 students. Subject: Digital Electronics.' },
    { action:'ATTENDANCE_UPDATED',  sev:'INFO',     det:'Attendance updated for IT Sem 4 Section A: 17/20 students present. Subject: Java Programming.' },
    { action:'ATTENDANCE_UPDATED',  sev:'INFO',     det:'Attendance updated for AIML Sem 5: 22/24 students present. Subject: Natural Language Processing.' },
    { action:'ATTENDANCE_UPDATED',  sev:'INFO',     det:'Low attendance alert generated: 8 students fell below 75% in CS-601 (Machine Learning).' },
    { action:'ATTENDANCE_UPDATED',  sev:'WARNING',  det:'Defaulter alert: Student 25B61A0487 attendance dropped to 62.3% across subjects. Parent notification triggered.' },
    // Marks / assessment
    { action:'MARKS_UPLOADED',      sev:'INFO',     det:'Mid-Term Unit Test I marks uploaded for CS-401 (DSA). 140 students. Avg: 68.4/100.' },
    { action:'MARKS_UPLOADED',      sev:'INFO',     det:'Internal assessment marks uploaded for ECE-301 (Digital Electronics). Avg: 72.1/100.' },
    { action:'MARKS_UPLOADED',      sev:'INFO',     det:'Lab marks updated for CS-502 (Software Engineering Lab). 35 students. All submitted.' },
    { action:'MARKS_UPLOADED',      sev:'INFO',     det:'End Semester marks uploaded for Semester 4 subjects. Processing grade calculations.' },
    // Notifications
    { action:'NOTIFICATION_SENT',   sev:'INFO',     det:'Batch notification sent: "Fee Payment Reminder" to 60 students with unpaid dues.' },
    { action:'NOTIFICATION_SENT',   sev:'INFO',     det:'Attendance warning notifications sent to 50 students below 75% across all branches.' },
    { action:'NOTIFICATION_SENT',   sev:'INFO',     det:'Placement notification sent to 382 eligible students for TCS Smart Hiring drive.' },
    { action:'NOTIFICATION_SENT',   sev:'INFO',     det:'Exam schedule notification dispatched to all 500 students successfully.' },
    // LMS
    { action:'ASSIGNMENT_POSTED',   sev:'INFO',     det:'Assignment posted for CS-601 (Machine Learning): "ML Model – Linear Regression". Due: 20 July 2026.' },
    { action:'ASSIGNMENT_POSTED',   sev:'INFO',     det:'Assignment posted for IT-401 (Java Programming): "OOP Implementation". 65 students notified.' },
    { action:'QUIZ_PUBLISHED',      sev:'INFO',     det:'Quiz published for CS-401 (DSA): "Unit 3 – Trees and Graphs". Duration: 30 min. 140 students notified.' },
    { action:'QUIZ_PUBLISHED',      sev:'INFO',     det:'Quiz published for ECE-301 (Digital Electronics): "Unit 2 – Combinational Circuits".' },
    { action:'COURSE_ENROLLED',     sev:'INFO',     det:'Batch enrollment completed: 140 CSE students enrolled in 6 LMS courses each.' },
    // Survey
    { action:'SURVEY_LAUNCHED',     sev:'INFO',     det:'Faculty Feedback Survey (Semester 4) launched. All 500 students notified. Response deadline: 5 July 2026.' },
    { action:'SURVEY_LAUNCHED',     sev:'INFO',     det:'Campus Experience Survey 2026 launched. Anonymous. Expected response rate: 70%.' },
    // Help desk
    { action:'TICKET_CREATED',      sev:'INFO',     det:'Help ticket HD-2026-000012 opened by student 25B61A0231. Category: FEES. Priority: HIGH.' },
    { action:'TICKET_RESOLVED',     sev:'INFO',     det:'Help ticket HD-2026-000007 resolved. Issue: Missing attendance record. Updated by faculty.' },
    { action:'TICKET_CREATED',      sev:'INFO',     det:'Help ticket HD-2026-000028 opened. Category: TECHNICAL. Issue: Cannot access LMS materials.' },
    // Achievement
    { action:'ACHIEVEMENT_RECORDED',sev:'INFO',     det:'Achievement recorded: SITAM Hackathon 2026 – 1st place for Team "ByteBuilders" (CSE). All 4 members awarded certificates.' },
    { action:'ACHIEVEMENT_RECORDED',sev:'INFO',     det:'Sports achievement: Student 23B61A0118 won Gold in 100m sprint at Inter-College Athletics Meet 2026.' },
    { action:'ACHIEVEMENT_RECORDED',sev:'INFO',     det:'Paper presentation: Student 24B61A0205 presented "NLP in Healthcare" at ICACDS-2026. Best paper award.' },
    // Password / security
    { action:'PASSWORD_CHANGED',    sev:'SECURITY', det:'Admin password changed by Super Admin for account accounts@sitamecap.co.in.' },
    { action:'PASSWORD_CHANGED',    sev:'INFO',     det:'Student 25B61A0501 reset password successfully via OTP verification.' },
    // Fee reminder auto-actions
    { action:'FEE_REMINDER_SENT',   sev:'INFO',     det:'Automated 15-day fee reminders sent to 45 students with pending Tuition Fee.' },
    { action:'FEE_REMINDER_SENT',   sev:'INFO',     det:'Automated 7-day fee reminders sent to 28 students. Hostel fee due within a week.' },
    { action:'FEE_REMINDER_SENT',   sev:'INFO',     det:'Automated 1-day fee reminder sent to 12 students. Exam fee cutoff tomorrow.' },
    // Admin notifications
    { action:'ADMIN_NOTIFICATION',  sev:'INFO',     det:'Admin broadcast sent: "Mid-Term Exam Schedule Released". Target: ALL 500 students.' },
    { action:'ADMIN_NOTIFICATION',  sev:'INFO',     det:'Admin broadcast sent: "Hostel Fee Due Reminder". Target: 190 hostel residents.' },
    // Misc ERP actions
    { action:'TIMETABLE_UPDATED',   sev:'INFO',     det:'Timetable updated for CSE Sem 5 Section A. Rescheduled: CS-504 (DAA) moved from Wed P3 to Fri P4.' },
    { action:'SYLLABUS_UPDATED',    sev:'INFO',     det:'Syllabus Unit 3 marked completed for CS-601 (Machine Learning). Faculty: Dr. P. Venkatesh.' },
    { action:'COMPANY_ARRIVED',     sev:'INFO',     det:'TCS Campus Hiring team arrived at 09:30 AM. Venue: Seminar Hall A. 120 students registered.' },
    { action:'COMPANY_ARRIVED',     sev:'INFO',     det:'Accenture hiring team arrived for ASE drive. Aptitude test started at 10:00 AM.' },
    { action:'PLACEMENT_RESULT',    sev:'INFO',     det:'TCS Smart Hiring results: 48 students selected from SITAM (CSE: 32, IT: 10, ECE: 6).' },
    { action:'PLACEMENT_RESULT',    sev:'INFO',     det:'Wipro results published: 22 students selected. All offer letters to be issued within 30 days.' },
    { action:'LOST_FOUND_REPORTED', sev:'INFO',     det:'Lost item reported: MacBook Pro (Silver) found near Library Block B. Owner contact initiated.' },
    { action:'LOST_FOUND_REPORTED', sev:'INFO',     det:'Lost item reported: Student ID Card (Roll: 25B61A0342). Deposited at Security Desk.' },
    { action:'SURVEY_CLOSED',       sev:'INFO',     det:'Faculty Feedback Survey closed. Total responses: 342/500 (68.4%). Report generated.' },
    { action:'BACKUP_COMPLETED',    sev:'INFO',     det:'Automated database backup completed at 03:00 AM. Backup size: 847 MB. Stored to cloud.' },
    { action:'SYSTEM_HEALTH',       sev:'INFO',     det:'System health check passed. DB response: 12ms. API latency: 85ms avg. All services GREEN.' },
    { action:'SYSTEM_HEALTH',       sev:'WARNING',  det:'Elevated API latency detected: 340ms avg. Likely cause: bulk LMS sync. Auto-scaled resolved.' },
    { action:'REPORT_GENERATED',    sev:'INFO',     det:'Monthly attendance report generated for June 2026. Branch-wise PDF report dispatched to HODs.' },
    { action:'REPORT_GENERATED',    sev:'INFO',     det:'Fee collection report generated. Total collected: ₹1.57 Cr. Pending: ₹28.4 L. Sent to Finance.' },
    { action:'EXAM_SCHEDULE',       sev:'INFO',     det:'End Semester Exam schedule (Nov 2026) published. Available for 500 students to download Hall Tickets.' },
    { action:'EXAM_SCHEDULE',       sev:'INFO',     det:'Hall ticket generation completed for 492 eligible students. 8 students blocked due to fee dues.' },
    { action:'CERTIFICATE_ISSUED',  sev:'INFO',     det:'LMS course completion certificate issued to 375 students who completed enrolled courses.' },
    { action:'ADMIN_NOTIFICATION',  sev:'INFO',     det:'NAAC preparation briefing scheduled for 7 July 2026. Student council notified.' },
    { action:'MAINTENANCE_TOGGLE',  sev:'INFO',     det:'Scheduled maintenance window configured for 15 July 2026, 01:00–03:00 AM. Admin alert set.' },
  ];

  let auditCnt = 0;
  for (let ai = 0; ai < RICH_AUDIT.length; ai++) {
    const entry  = RICH_AUDIT[ai];
    const admin  = rnd(createdAdmins);
    const student = Math.random() < 0.35 ? rnd(createdStudents) : null;
    // Spread timestamps: last 30 days, weighted toward last 7 days (more recent activity)
    const daysBack = Math.random() < 0.6 ? rndInt(0,7) : rndInt(7,30);
    const ts = daysAgo(daysBack);
    ts.setHours(rndInt(6,23), rndInt(0,59), rndInt(0,59));
    try {
      await prisma.auditLog.create({
        data: {
          admin:   { connect: { id: admin.id } },
          student: student ? { connect: { id: student.id } } : undefined,
          action: entry.action, details: entry.det, severity: entry.sev,
          timestamp: ts,
        }
      });
      auditCnt++;
    } catch(_){}
  }

  // Admin broadcast notifications
  const adminNotifs = [
    { title:'Mid-Term Examination Schedule Released',          message:'Unit Test I schedule for August 2026 has been published on the portal.',    audience:'ALL',       priority:'HIGH'   },
    { title:'Placement Drive: TCS Smart Hiring 2026',          message:'TCS Smart Hiring 2026 on campus 18th July. Eligible: CSE/IT/ECE 60%+.', audience:'CSE,IT,ECE',priority:'HIGH'   },
    { title:'Hostel Fee Due Reminder',                         message:'Q2 Hostel Fee (July–September) due by 20th July 2026. Pay immediately.', audience:'HOSTEL',   priority:'URGENT' },
    { title:'Exam Fee Payment Last Date',                      message:'End Semester Exam fee of Rs.1,200 must be paid before 5th July to receive Hall Ticket.', audience:'ALL', priority:'URGENT' },
    { title:'SITAM Hackathon 2026 Registration Open',          message:'Annual Hackathon 2026 open. Teams of 2–4. Event: 20–21 July. Winners get internship offers.', audience:'ALL', priority:'NORMAL' },
  ];
  for (const n of adminNotifs) {
    try { await prisma.adminNotification.create({ data: { title: n.title, message: n.message, targetAudience: n.audience, priority: n.priority, sentBy: superAdmin.id } }); } catch(_){}
  }

  // Company visits (for admin dashboard live card)
  for (const c of COMPANIES.slice(0,8)) {
    try { await prisma.companyVisit.create({ data: { companyName: c.name, visitDate: dateStr(daysFromNow(rndInt(5,60))), packageLpa: c.pkg, eligibility: c.elig, jobRoles: c.role, driveRounds: 'Aptitude Test, Technical Interview, HR Interview', venue: rnd(['Seminar Hall A','Placement Cell','Conference Room B','Auditorium']), status: rnd(['UPCOMING','UPCOMING','CONFIRMED','COMPLETED']) } }); } catch(_){}
  }

  // ── STRUCTURED TIMETABLE (all 500 students, real Mon–Sat grid) ──────────────
  // Branch → subject code prefixes per semester
  const BRANCH_SUBJ_MAP = {
    'CSE':  ['CS-','GEN-'], 'ECE': ['ECE-','GEN-'], 'IT': ['IT-','GEN-','CS-'],
    'AIML': ['AI-','GEN-','CS-'], 'MECH': ['ME-','GEN-'], 'CIVIL': ['CE-','GEN-'], 'EEE': ['EE-','GEN-'],
  };
  const TT_DAYS     = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const TT_PERIODS  = ['1','2','3','4','5','6'];
  const TT_TIMES    = ['09:00 AM','10:00 AM','11:00 AM','12:00 PM','02:00 PM','03:00 PM'];
  const ROOM_MAP    = {
    'CSE':'A-3', 'ECE':'B-2', 'IT':'A-4', 'AIML':'C-1', 'MECH':'D-1', 'CIVIL':'D-2', 'EEE':'B-3',
  };
  const LAB_MAP     = { '1':'Lab-1','2':'Lab-2','3':'Lab-3','4':'Lab-4','5':'Lab-5' };

  let ttCnt = 0;
  // Build per-section timetable grid, reuse across students in same section
  const sectionGridCache = {}; // key: `branch-year-section`

  for (const s of createdStudents) {
    const sp    = s._profile;
    const cKey  = `${sp.branch}-${sp.year}-${sp.section}`;
    let grid    = sectionGridCache[cKey];

    if (!grid) {
      // Build a deterministic 6-day × 6-period grid for this section
      const prefixes = BRANCH_SUBJ_MAP[sp.branch] || ['GEN-'];
      const branchSubjs = subjectList.filter(sub =>
        prefixes.some(p => sub.code.startsWith(p)) ||
        sub.branch === '' || sub.branch === sp.branch
      );
      const pool = branchSubjs.length >= 6 ? branchSubjs : subjectList;
      const facPool = FACULTY_DATA.filter(f => f.dept === sp.branch);
      const facPoolFinal = facPool.length > 0 ? facPool : FACULTY_DATA;

      grid = {};
      // Assign fixed subjects to fixed day:period slots
      const slotSubjs = [];
      for (let i = 0; i < Math.min(12, pool.length); i++) {
        slotSubjs.push(pool[i % pool.length]);
      }
      let slotIdx = 0;
      for (const day of TT_DAYS) {
        const periodsPerDay = day === 'Saturday' ? 3 : 6;
        for (let pi = 0; pi < periodsPerDay; pi++) {
          const period = TT_PERIODS[pi];
          const sub    = slotSubjs[slotIdx % slotSubjs.length];
          const fac    = facPoolFinal[slotIdx % facPoolFinal.length];
          const isLab  = sub.credits === '0' || sub.name.toLowerCase().includes('lab');
          const room   = isLab
            ? (LAB_MAP[String(rndInt(1,5))] || 'Lab-1')
            : `${ROOM_MAP[sp.branch] || 'A'}${rndInt(1,4)}${String(rndInt(1,9)).padStart(2,'0')}`;
          grid[`${day}:${period}`] = { sub, fac, room, time: TT_TIMES[pi] || '03:00 PM' };
          slotIdx++;
        }
      }
      sectionGridCache[cKey] = grid;
    }

    // Write timetable slots for this student
    for (const [slotKey, slot] of Object.entries(grid)) {
      const [day, period] = slotKey.split(':');
      try {
        await prisma.timetableSlot.create({
          data: {
            studentId: s.id, subjectId: slot.sub.id, day, period,
            room: slot.room, section: sp.section, facultyName: slot.fac.name, time: slot.time,
          }
        });
        ttCnt++;
      } catch(_){}
    }
  }
  console.log(`   ✅ ${auditCnt} audit logs | ${adminNotifs.length} admin notifications | ${ttCnt} timetable slots`);

  // ── 13. Syllabus Units (5 per subject × 40 subjects = 200) ──────────────────
  console.log('\n📖   [13/17] Syllabus Units (200)…');
  const SYLLABUS_TEMPLATES = [
    ['Introduction & Fundamentals','Basic concepts, definitions, history, scope and applications of the subject.'],
    ['Core Concepts – Part I','In-depth study of primary principles, theorems, and standard methodologies with examples.'],
    ['Core Concepts – Part II','Advanced analysis, derivations, proofs, and complex problem-solving techniques.'],
    ['Applications & Case Studies','Real-world applications, industry use-cases, system design and practical implementations.'],
    ['Advanced Topics & Future Trends','Current research directions, emerging technologies, open problems, and exam preparation.'],
  ];
  let syllCnt = 0;
  for (const sub of subjectList) {
    for (let u = 0; u < 5; u++) {
      const tmpl = SYLLABUS_TEMPLATES[u];
      const done = u < rndInt(1, 4); // 1–3 units completed per subject
      try {
        await prisma.syllabusUnit.create({
          data: {
            subjectId: sub.id, unitNumber: u + 1,
            title: `Unit ${u + 1}: ${tmpl[0]}`,
            content: `${tmpl[1]} Covers ${sub.name} – Unit ${u + 1} as per JNTUH R20 curriculum. Includes textbook references, previous question bank, and important derivations.`,
            completed: done,
          }
        });
        syllCnt++;
      } catch(_){}
    }
  }
  console.log(`   ✅ ${syllCnt} syllabus units`);

  // ── 14. Student Achievements (as Notifications, type:'achievement') ──────────
  console.log('\n🏆   [14/17] Student Achievements (Notifications)…');
  const ACHIEVEMENTS = [
    // Hackathon
    { title:'SITAM Hackathon 2026 – 1st Place 🥇',          type:'hackathon', msg:'Team "ByteBuilders" (CSE Y3) won 1st place at SITAM Hackathon 2026. Project: AI-powered Smart Campus App. Prize: Rs.25,000 + Internship at Hyderabad Tech startup.' },
    { title:'SITAM Hackathon 2026 – 2nd Place 🥈',          type:'hackathon', msg:'Team "CodeCrafters" (AIML Y2) secured 2nd place at SITAM Hackathon 2026. Project: Real-time sign language translator using CV.' },
    { title:'SITAM Hackathon 2026 – 3rd Place 🥉',          type:'hackathon', msg:'Team "DataDriven" (CSE Y4) secured 3rd place at SITAM Hackathon 2026. Project: Crop disease detection using ML.' },
    { title:'Smart India Hackathon 2025 – Finalist 🏅',     type:'hackathon', msg:'Team from CSE Department reached national finals of Smart India Hackathon 2025. Problem statement: Smart Water Management.' },
    { title:'HackWithInfy 2026 – Selected Finalist',        type:'hackathon', msg:'Student 24B61A0308 selected as finalist in HackWithInfy 2026 organized by Infosys. Top 200 nationally.' },
    { title:'Google Solution Challenge 2026 – Top 100',     type:'hackathon', msg:'SITAM team ranked in Top 100 globally at Google Solution Challenge 2026. App: EduAccess for rural students.' },
    // Sports
    { title:'Inter-College Athletics – Gold Medal 🥇',      type:'sports',    msg:'Student 23B61A0118 (ECE Y3) won Gold Medal in 100m sprint at SVU Inter-College Athletics Meet 2026. Timing: 10.82s.' },
    { title:'State-Level Chess Championship – Runner-Up',   type:'sports',    msg:'Student 24B61A0215 (CSE Y2) secured Runner-Up position at Telangana State Chess Championship 2026.' },
    { title:'Inter-University Cricket – Best Bowler',       type:'sports',    msg:'Student 22B61A0312 (MECH Y4) awarded Best Bowler at JNTUH Inter-University Cricket Tournament 2025.' },
    { title:'National Badminton – Quarterfinals',           type:'sports',    msg:'Student 25B61A0127 (IT Y1) reached quarterfinals at AIUBSA National Badminton Championship 2026.' },
    { title:'KRIDA 2025 – Overall Championship',            type:'sports',    msg:'CSE Department won Overall Championship at SITAM Annual Sports Fest KRIDA 2025. Maximum points: 420.' },
    { title:'Kabaddi – District Level Gold',                type:'sports',    msg:'SITAM Kabaddi team won Gold at Rangareddy District Level Sports Meet 2026.' },
    // NCC / NSS
    { title:'NCC Best Cadet Award 2026 🎖️',               type:'ncc',       msg:'Cadet Sgt. 24B61A0422 (EEE Y2) received NCC Best Cadet Award at 5 AP Battalion Annual Training Camp 2026.' },
    { title:'NSS Special Camp – Certificate of Merit',      type:'nss',       msg:'8 NSS volunteers from SITAM received certificates of merit for rural health awareness camp conducted in Nalgonda district.' },
    { title:'Republic Day NCC Camp – Selected Cadet',       type:'ncc',       msg:'Student 23B61A0219 selected for Republic Day Camp 2026 at New Delhi representing AP&T NCC Directorate.' },
    { title:'NSS – Best Programme Officer Award',           type:'nss',       msg:'SITAM NSS Unit received Best Programme Officer Award from JNTUH for outstanding community service in AY 2025-26.' },
    // Research / Paper presentation
    { title:'Research Paper – ICACDS 2026 (Scopus)',        type:'paper',     msg:'Student 24B61A0205 (CSE Y2) paper "Federated Learning for Privacy-Preserving IoT Systems" accepted at ICACDS 2026 (Scopus Indexed). Co-authored with Dr. P. Venkatesh.' },
    { title:'Paper Presentation – NCET 2026 – 1st Prize',  type:'paper',     msg:'Students 23B61A0411 & 23B61A0412 (ECE Y3) won 1st prize at National Conference on Emerging Technologies 2026, GRIET Hyderabad.' },
    { title:'IEEE Conference – Best Paper Award',           type:'paper',     msg:'Student 22B61A0117 (CSE Final Year) received Best Paper Award at IEEE CONECCT 2025 for paper on "Attention Mechanisms in NLP".' },
    { title:'Research Internship – IIT Hyderabad',         type:'paper',     msg:'Student 23B61A0308 (AIML Y3) selected for 2-month research internship at IIT Hyderabad under Prof. Ravi Kiran, AI Lab.' },
    // Patents
    { title:'Patent Filed – IoT-Based Smart Irrigation',   type:'patent',    msg:'Patent application filed (Application No. 202441012345) by Student 22B61A0501 (CSE Y4) for IoT-based AI smart irrigation controller. Status: Under Examination.' },
    { title:'Patent Granted – Anti-Drowning Wearable',     type:'patent',    msg:'Patent granted (IN 456789) to student 22B61A0218 (ECE Y4) for smart anti-drowning wearable using pressure sensors and GSM alert.' },
    // Certificates
    { title:'AWS Certified Cloud Practitioner',            type:'cert',      msg:'Student 24B61A0401 (IT Y2) cleared AWS Certified Cloud Practitioner exam. Score: 890/1000.' },
    { title:'Google Professional ML Engineer Certification',type:'cert',     msg:'Student 23B61A0205 (CSE Y3) cleared Google Professional Machine Learning Engineer certification.' },
    { title:'Microsoft Azure AZ-900 Certified',            type:'cert',      msg:'14 students from CSE/IT cleared Microsoft Azure Fundamentals (AZ-900) certification in batch training by SITAM T&P Cell.' },
    { title:'NPTEL – Discipline of Excellence Award',      type:'cert',      msg:'25 students received NPTEL Discipline of Excellence award for scoring 90%+ in online certification courses in AY 2025-26.' },
    // Cultural
    { title:'Youth Festival – Culturals 1st Prize',        type:'cultural',  msg:'SITAM team won 1st prize in Classical Dance (Kuchipudi) at JNTUH Youth Festival 2026, Kukatpally campus.' },
    { title:'SPANDANA 2025 – Best Performer',              type:'cultural',  msg:'Student 25B61A0188 (CSE Y1) received Best Performer award at SITAM Cultural Fest SPANDANA 2025 for Western Dance.' },
  ];

  let achCnt = 0;
  for (let ai = 0; ai < ACHIEVEMENTS.length; ai++) {
    const ach = ACHIEVEMENTS[ai];
    const s   = createdStudents[rndInt(0, createdStudents.length - 1)];
    const fn  = (s._profile.name || '').split(' ')[0] || 'Student';
    try {
      await prisma.notification.create({
        data: {
          studentId: s.id,
          title:     ach.title,
          message:   ach.msg,
          type:      'achievement',
          category:  'success',
          isRead:    false,
          date:      dateStr(daysAgo(rndInt(5,120))),
        }
      });
      achCnt++;
    } catch(_){}
  }
  console.log(`   ✅ ${achCnt} achievement notifications`);

  // ── 15. Surveys (2) + 100 Responses each ─────────────────────────────────────
  console.log('\n📋   [15/17] Surveys + Responses…');
  const createdByAdmin = superAdmin.id;
  let survCnt = 0, respCnt = 0;

  const SURVEY_DEFS = [
    {
      title: 'Faculty Feedback Survey – Semester 4 (2025-26)',
      description: 'Share your honest feedback about faculty teaching quality for Semester 4. Your responses are strictly confidential and used for academic improvement.',
      isAnonymous: false,
      questions: [
        { text: 'How would you rate the overall teaching quality of your faculty?',        type: 'RATING',  options: null, order: 1 },
        { text: 'Were course objectives and syllabus clearly communicated?',               type: 'MCQ',     options: JSON.stringify(['Yes, clearly','Somewhat','No, unclear']), order: 2 },
        { text: 'How often did faculty use real-world examples or case studies?',          type: 'MCQ',     options: JSON.stringify(['Always','Often','Sometimes','Rarely']), order: 3 },
        { text: 'Were faculty accessible for doubt clearing during office hours?',         type: 'MCQ',     options: JSON.stringify(['Very accessible','Moderately','Not accessible']), order: 4 },
        { text: 'Suggestions for improving the teaching-learning process this semester.',  type: 'TEXT',    options: null, order: 5 },
      ],
    },
    {
      title: 'Campus Experience Survey 2026',
      description: 'Help us improve campus life at SITAM. Rate your experience across infrastructure, hostel, library, canteen, and extracurricular activities.',
      isAnonymous: true,
      questions: [
        { text: 'Rate the overall campus infrastructure (classrooms, labs, Wi-Fi, etc.)',    type: 'RATING', options: null, order: 1 },
        { text: 'How satisfied are you with the college canteen food quality and hygiene?',  type: 'RATING', options: null, order: 2 },
        { text: 'Would you recommend SITAM to a friend or junior seeking engineering admission?', type: 'MCQ', options: JSON.stringify(['Definitely Yes','Probably Yes','Not Sure','No']), order: 3 },
        { text: 'Which aspect of campus life needs the most improvement?',                  type: 'MCQ',   options: JSON.stringify(['Library','Sports Facilities','Internet Speed','Hostel Facilities','Canteen']), order: 4 },
        { text: 'Any additional feedback or suggestions for the management.',               type: 'TEXT',  options: null, order: 5 },
      ],
    },
  ];

  const RATING_ANSWERS    = ['4','5','3','5','4','4','5','3','4','5'];
  const MCQ_ANSWERS_QUAL  = ['Yes, clearly','Yes, clearly','Somewhat','Always','Often','Sometimes','Very accessible','Moderately'];
  const MCQ_ANSWERS_EXP   = ['Definitely Yes','Probably Yes','Not Sure','Definitely Yes','Probably Yes'];
  const TEXT_ANSWERS      = [
    'More interactive sessions and practical labs would be helpful.',
    'Faculty should post lecture notes on LMS before class.',
    'More industry expert guest lectures needed.',
    'Library hours should be extended to 10 PM.',
    'Internet speed in hostels needs improvement.',
    'Canteen should add more healthy food options.',
    'More coding competitions and hackathons please.',
    'Overall a great experience at SITAM. Very supportive faculty.',
    'Wish there were more research opportunities for UG students.',
    'Placement training should start from 2nd year itself.',
  ];

  for (const sd of SURVEY_DEFS) {
    try {
      const survey = await prisma.survey.create({
        data: {
          title: sd.title, description: sd.description, status: 'ACTIVE',
          isAnonymous: sd.isAnonymous, expiresAt: daysFromNow(30), createdBy: createdByAdmin,
        }
      });

      const qRecs = [];
      for (const q of sd.questions) {
        const qr = await prisma.surveyQuestion.create({
          data: { surveyId: survey.id, text: q.text, type: q.type, options: q.options, order: q.order }
        });
        qRecs.push(qr);
      }

      // 100 student responses per survey
      const respondents = createdStudents.slice(0, 100);
      for (const stu of respondents) {
        try {
          const resp = await prisma.surveyResponse.create({
            data: { surveyId: survey.id, studentId: stu.id }
          });
          for (const qr of qRecs) {
            let ans;
            if      (qr.type === 'RATING') ans = rnd(RATING_ANSWERS);
            else if (qr.type === 'TEXT')   ans = rnd(TEXT_ANSWERS);
            else                           ans = sd.isAnonymous ? rnd(MCQ_ANSWERS_EXP) : rnd(MCQ_ANSWERS_QUAL);
            await prisma.surveyAnswer.create({
              data: { responseId: resp.id, questionId: qr.id, answer: ans }
            });
          }
          respCnt++;
        } catch(_){}
      }
      survCnt++;
    } catch(_){}
  }
  console.log(`   ✅ ${survCnt} surveys  |  ${respCnt} responses`);

  // ── 16. Help Tickets (50) ─────────────────────────────────────────────────────
  console.log('\n🎫   [16/17] Help Tickets (50)…');
  const TICKET_DEFS = [
    // FEES
    { sub:'Fee Receipt Not Generated',            cat:'FEES',     pri:'HIGH',   desc:'I paid Tuition Fee of Rs.45,000 online on 10 July via SBI net banking. Payment was deducted from my account but fee receipt was not generated in the portal. Transaction ID: SBIX20260710XXXXXX. Please check and generate receipt urgently.' },
    { sub:'Wrong Fee Amount Shown in Portal',     cat:'FEES',     pri:'NORMAL', desc:'The portal shows my Tuition Fee as Rs.50,000 but the actual fee is Rs.45,000 as per the fee structure. Kindly correct the amount and update my fee records accordingly.' },
    { sub:'Exam Fee Exemption for SC Category',   cat:'FEES',     pri:'NORMAL', desc:'I belong to SC category and I have submitted all scholarship documents. The exam fee should be waived. Please review and update my fee status before the Hall Ticket generation deadline.' },
    { sub:'Duplicate Fee Deducted – Refund Request',cat:'FEES',  pri:'HIGH',   desc:'My Hostel Fee was deducted twice on 5 July 2026. Both transactions are visible in my bank statement. Requesting refund of the duplicate amount of Rs.18,000 at the earliest.' },
    { sub:'Partial Fee Payment – Balance Clearance', cat:'FEES', pri:'NORMAL', desc:'I had paid partial fee in April. Now I want to clear the remaining Rs.22,000 balance. Can the accounts section generate a demand notice for the balance amount so I can pay?' },
    // ACADEMIC
    { sub:'Attendance Marked Absent on Present Day',cat:'ACADEMIC',pri:'HIGH',  desc:'On 8 July 2026, I was present in CS-601 (Machine Learning) class with Dr. P. Venkatesh. However, my attendance was marked absent. Kindly correct the attendance record. I have my seat number and classmates as witness.' },
    { sub:'Marks Not Updated in Portal',          cat:'ACADEMIC', pri:'NORMAL', desc:'Unit Test I marks for CS-402 (Operating Systems) have not been updated in the student portal even though results were announced in class on 5 July. Kindly update the marks.' },
    { sub:'Grade Discrepancy in Semester 3',      cat:'ACADEMIC', pri:'HIGH',   desc:'My grade for CS-302 (Discrete Mathematics) shows "B" in the portal but the actual answer sheet correction shows I scored 84/100 which should give "A" grade. Please review and correct.' },
    { sub:'LMS Course Material Not Accessible',   cat:'TECHNICAL',pri:'NORMAL', desc:'I am unable to access course materials for LMS-CS-008 (Machine Learning). When I click on the module, I get a "403 Forbidden" error. I am properly enrolled in the course. Please fix.' },
    { sub:'Backlog Clearance – Supplementary Exam Request', cat:'ACADEMIC', pri:'HIGH', desc:'I have a backlog in CS-301 (OOP) from Semester 3. Requesting registration for the upcoming supplementary examination. Please guide me on the process and fee payment.' },
    // TECHNICAL
    { sub:'Unable to Login to Student Portal',    cat:'TECHNICAL',pri:'HIGH',   desc:'I am getting "Invalid credentials" error while logging into the SITAM Smart ERP app even though I am entering the correct password. I tried resetting but the OTP is not being received on my registered mobile number.' },
    { sub:'App Crash on Android 14',             cat:'TECHNICAL',pri:'NORMAL', desc:'The SITAM ERP app crashes immediately after the splash screen on my OnePlus 11 running Android 14. Please provide a fix or APK update compatible with Android 14.' },
    { sub:'Push Notifications Not Working',       cat:'TECHNICAL',pri:'NORMAL', desc:'I am not receiving push notifications for fee reminders, attendance alerts, or placement drives despite having notifications enabled on my phone. Other students in my class are receiving them.' },
    { sub:'Profile Photo Not Uploading',          cat:'TECHNICAL',pri:'NORMAL', desc:'When I try to upload my profile photo in the Student Profile section, I get "File size too large" error even for a 200KB image. Please fix the file upload limit.' },
    { sub:'Timetable Not Showing for Semester 5', cat:'TECHNICAL',pri:'NORMAL', desc:'My timetable shows for Semester 4 but I am now in Semester 5. The semester update happened but timetable was not updated. Please assign Semester 5 timetable to my account.' },
    // HOSTEL
    { sub:'Hostel Room Maintenance – Water Leak', cat:'HOSTEL',   pri:'HIGH',   desc:'There is a water leak from the bathroom ceiling in Room B2-214 (Boys Hostel Block B). The water is seeping into the room and damaging study materials. Urgent maintenance required.' },
    { sub:'Request for Room Change',              cat:'HOSTEL',   pri:'NORMAL', desc:'I am currently in Room B1-112 (Boys Hostel Block B, 1st floor). I am requesting a room change to Block B, 2nd floor as the ground floor has mosquito problems and poor ventilation.' },
    { sub:'Mess Food Quality Complaint',          cat:'HOSTEL',   pri:'NORMAL', desc:'The hostel mess food quality has deteriorated significantly in the past 2 weeks. Food is served cold, portions are small, and there are hygiene concerns. Requesting immediate inspection by the hostel warden.' },
    // GENERAL
    { sub:'Hall Ticket Not Generated Despite Fee Payment', cat:'GENERAL', pri:'HIGH', desc:'I have cleared all dues including Tuition Fee and Exam Fee. However, my Hall Ticket for End Semester November 2026 examinations is not being generated. The portal shows "Fee Pending" which is incorrect.' },
    { sub:'Scholarship Status Not Updated',       cat:'GENERAL',  pri:'NORMAL', desc:'I applied for the Telangana State Merit Scholarship through TGEPASS portal and received acknowledgment. However, my scholarship status in the SITAM portal still shows "None". Kindly update.' },
  ];

  const TICKET_STATUSES = ['OPEN','OPEN','IN_PROGRESS','RESOLVED','CLOSED'];
  const TICKET_REPLIES  = [
    'Thank you for reporting this. We have escalated your concern to the respective department. You will receive an update within 24 hours.',
    'We have checked your records. The issue has been identified and will be resolved by end of day. Please check the portal after 6 PM.',
    'Your request has been processed. Kindly check the student portal for the updated information. If the issue persists, please reopen this ticket.',
    'We appreciate your patience. The concerned faculty/department has been notified. Expected resolution: 48 hours.',
    'The issue has been resolved. Our technical team has pushed the fix. Please clear your app cache and try again.',
    'Your fee records have been manually verified and updated. You can now download your Hall Ticket from the portal.',
    'The attendance discrepancy has been corrected after verification. Updated records are now visible in the portal.',
  ];

  let tickCnt = 0, tcNum = 1000;
  for (let ti = 0; ti < TICKET_DEFS.length; ti++) {
    const td  = TICKET_DEFS[ti];
    const s   = createdStudents[rndInt(0, createdStudents.length - 1)];
    const status = TICKET_STATUSES[ti % TICKET_STATUSES.length];
    tcNum++;
    try {
      const ticket = await prisma.helpTicket.create({
        data: {
          studentId: s.id,
          ticketNumber: `HD-2026-${String(tcNum).padStart(6,'0')}`,
          subject: td.sub, description: td.desc,
          category: td.cat, priority: td.pri,
          status, estimatedResponseTime: '24 hours',
        }
      });
      // Add admin reply for non-open tickets
      if (status !== 'OPEN') {
        await prisma.ticketReply.create({
          data: {
            ticketId: ticket.id,
            message: rnd(TICKET_REPLIES),
            senderType: 'ADMIN',
            senderId: superAdmin.id,
            senderName: superAdmin.name,
          }
        });
      }
      tickCnt++;
    } catch(_){}
  }
  console.log(`   ✅ ${tickCnt} help tickets`);

  // ── 17. Today's Dashboard Snapshot (audit entries for "today" card) ──────────
  console.log('\n📅   [17/17] Today\'s Activity Snapshot…');
  const TODAY_EVENTS = [
    { action:'ADMIN_LOGIN',         sev:'INFO',    det:'Super Admin logged in at 09:00 AM for morning dashboard review.' },
    { action:'EXIT_PASS_APPROVED',  sev:'INFO',    det:'3 exit passes approved this morning. OTPs dispatched to students.' },
    { action:'OTP_VERIFIED',        sev:'INFO',    det:'2 exit OTPs verified at Main Gate before 10 AM.' },
    { action:'FEE_PAYMENT_RECEIVED',sev:'INFO',    det:'5 fee payments received today. Total collected: Rs.2,25,000.' },
    { action:'NOTIFICATION_SENT',   sev:'INFO',    det:'Fee reminder notifications sent to 12 students today morning.' },
    { action:'PLACEMENT_PUBLISHED', sev:'INFO',    det:'Infosys Campus Hiring drive published at 10:30 AM today.' },
    { action:'ATTENDANCE_UPDATED',  sev:'INFO',    det:'Morning batch attendance updated for 8 sections across all branches.' },
    { action:'TICKET_CREATED',      sev:'INFO',    det:'2 new help tickets created today. 1 FEES, 1 TECHNICAL.' },
    { action:'ANNOUNCEMENT_CREATED',sev:'INFO',    det:'New announcement draft saved: "Revised Hostel Regulations 2026-27".' },
    { action:'COMPANY_ARRIVED',     sev:'INFO',    det:'TCS Smart Hiring team arrived on campus at 09:30 AM. Students assembling.' },
  ];
  let todayCnt = 0;
  for (const ev of TODAY_EVENTS) {
    const admin = rnd(createdAdmins);
    const ts    = new Date();
    ts.setHours(rndInt(8,14), rndInt(0,59), 0);
    try {
      await prisma.auditLog.create({
        data: {
          admin: { connect: { id: admin.id } },
          action: ev.action, details: ev.det, severity: ev.sev,
          timestamp: ts,
        }
      });
      todayCnt++;
    } catch(_){}
  }
  console.log(`   ✅ ${todayCnt} today's activity entries`);

  // ── FINAL SUMMARY ──────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const totalAudit = auditCnt + todayCnt;
  console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
  console.log('║  ✅  SITAM Smart ERP Demo Dataset — Seeding Complete! (v2.1)          ║');
  console.log(`║  ⏱️   Total time: ${elapsed}s                                                 ║`);
  console.log('╠════════════════════════════════════════════════════════════════════════╣');
  console.log(`║  Students          : ${String(createdStudents.length).padEnd(6)} (target 500)                             ║`);
  console.log(`║  Departments (LMS) : ${String(HAS_LMS?Object.keys(departmentMap).length:'N/A').padEnd(6)}                                            ║`);
  console.log(`║  Faculty           : ${String(facultyList.length).padEnd(6)}                                            ║`);
  console.log(`║  Courses (LMS)     : ${String(coursesList.length).padEnd(6)} (target 40)                              ║`);
  console.log(`║  LMS Enrollments   : ${String(enrollCnt).padEnd(6)}                                            ║`);
  console.log(`║  LMS Assignments   : ${String(lmsAsnCnt).padEnd(6)} (target 200)                             ║`);
  console.log(`║  LMS Quizzes       : ${String(lmsQzCnt).padEnd(6)} (target ~100)                            ║`);
  console.log(`║  LMS Submissions   : ${String(subCnt).padEnd(6)}                                            ║`);
  console.log(`║  Quiz Results      : ${String(qrCnt).padEnd(6)}                                            ║`);
  console.log(`║  Certificates      : ${String(certCnt).padEnd(6)}                                            ║`);
  console.log(`║  Subjects          : ${String(subjectList.length).padEnd(6)}                                            ║`);
  console.log(`║  Syllabus Units    : ${String(syllCnt).padEnd(6)} (5 per subject)                           ║`);
  console.log(`║  Timetable Slots   : ${String(ttCnt).padEnd(6)} (all 500 students, structured)              ║`);
  console.log(`║  Attendance        : ${String(attCount).padEnd(6)} (target 15,000)                          ║`);
  console.log(`║  Mark Records      : ${String(markCount).padEnd(6)} (target 3,000)                           ║`);
  console.log(`║  Fee Records       : ${String(feeCount).padEnd(6)} (target ~500)                             ║`);
  console.log(`║  Notifications     : ${String(notifCount).padEnd(6)}                                            ║`);
  console.log(`║  Achievements      : ${String(achCnt).padEnd(6)} (as notification records)                  ║`);
  console.log(`║  Exit Passes       : ${String(epCount).padEnd(6)} (20 per status)                           ║`);
  console.log(`║  Placements        : ${String(placementCount).padEnd(6)} (35 PUBLISHED | DRAFT rest)               ║`);
  console.log(`║  Announcements     : ${String(annCnt).padEnd(6)}                                            ║`);
  console.log(`║  Fee Notices       : ${String(fnCnt).padEnd(6)}                                            ║`);
  console.log(`║  Surveys           : ${String(survCnt).padEnd(6)}  |  Responses: ${String(respCnt).padEnd(6)}                      ║`);
  console.log(`║  Help Tickets      : ${String(tickCnt).padEnd(6)}                                            ║`);
  console.log(`║  Audit Logs        : ${String(totalAudit).padEnd(6)} (incl. ${todayCnt} today's activities)              ║`);
  console.log('╠════════════════════════════════════════════════════════════════════════╣');
  console.log('║  🔐  Admin Credentials (password: Admin@1234)                         ║');
  for (const a of adminDefs) {
    console.log(`║    📧 ${(a.email + '  [' + a.role + ']').padEnd(65)}║`);
  }
  console.log('╠════════════════════════════════════════════════════════════════════════╣');
  console.log('║  🎓  Student  : <rollno>@sitamecap.co.in  |  password: Student@123   ║');
  console.log('║  🧑‍🏫  Faculty  : faculty1@sitamecap.co.in  |  password: Faculty@1234  ║');
  console.log('╚════════════════════════════════════════════════════════════════════════╝\n');
}

main()
  .catch(err => {
    console.error('\n[Seed] ❌ Fatal error:', err.message);
    if (process.env.NODE_ENV !== 'production') console.error(err.stack);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());