'use strict';
require('dotenv').config();
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const SALT = process.env.ADMIN_PASSWORD_SALT || 'sitam-admin-salt';
function hashPassword(p) { return crypto.createHmac('sha256', SALT).update(p).digest('hex'); }
function hashOTP(otp) { return crypto.createHash('sha256').update(otp + 'sitam-otp-salt').digest('hex'); }

// ──────────────────────────────────────────────
// Helper utilities
// ──────────────────────────────────────────────
function rnd(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rndInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function rndFloat(min, max, dec) {
  dec = dec === undefined ? 2 : dec;
  return parseFloat((Math.random() * (max - min) + min).toFixed(dec));
}
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d; }
function daysFromNow(n) { const d = new Date(); d.setDate(d.getDate() + n); return d; }
function dateStr(d) { return d.toISOString().slice(0, 10); }

// ──────────────────────────────────────────────
// Name pools – real South Indian names
// ──────────────────────────────────────────────
const FIRST_NAMES_MALE = [
  'Arjun', 'Karthik', 'Venkatesh', 'Suresh', 'Ramesh', 'Anil', 'Vikram', 'Siva',
  'Harish', 'Naveen', 'Praveen', 'Ravi', 'Srikanth', 'Dinesh', 'Mahesh', 'Ganesh',
  'Pradeep', 'Rajesh', 'Lokesh', 'Kishore', 'Deepak', 'Aakash', 'Charan', 'Nithish',
  'Akshay', 'Akhil', 'Varun', 'Rohit', 'Ajay', 'Vijay', 'Sanjay', 'Balaji',
  'Santosh', 'Manoj', 'Vinod', 'Sunil', 'Aravind', 'Bharath', 'Tarun', 'Sathvik',
  'Pavan', 'Koushik', 'Sai', 'Vamsi', 'Teja', 'Surya', 'Gopal', 'Naresh',
  'Bhaskar', 'Mohan', 'Lohith', 'Sumanth', 'Shankar', 'Murali', 'Kiran', 'Aditya',
];
const FIRST_NAMES_FEMALE = [
  'Priya', 'Divya', 'Sowmya', 'Lakshmi', 'Kavya', 'Sneha', 'Anjali', 'Swathi',
  'Pooja', 'Anusha', 'Keerthi', 'Sravani', 'Bhavana', 'Haritha', 'Madhuri',
  'Nandini', 'Pallavi', 'Ranjitha', 'Sushma', 'Usha', 'Vanitha', 'Yamuna',
  'Chitra', 'Deepa', 'Gayathri', 'Hema', 'Indira', 'Jyothi', 'Kamala',
  'Revathi', 'Saritha', 'Tara', 'Uma', 'Vidya', 'Ashwini', 'Bindhu', 'Durga',
  'Anitha', 'Ramya', 'Sangeetha', 'Subha', 'Meena', 'Lavanya', 'Preeti', 'Nithya',
];
const LAST_NAMES = [
  'Reddy', 'Sharma', 'Naidu', 'Rao', 'Kumar', 'Varma', 'Chowdary', 'Pillai',
  'Krishnan', 'Iyer', 'Nair', 'Menon', 'Rajan', 'Murugan', 'Subramaniam',
  'Venkataraman', 'Goud', 'Yadav', 'Babu', 'Prasad', 'Srinivas', 'Murthy',
  'Patel', 'Sekhar', 'Raju', 'Devi', 'Lal', 'Singh', 'Bhat', 'Hegde',
];

const FATHER_FIRST = [
  'Suresh', 'Ramesh', 'Venkatesh', 'Narasimha', 'Srinivas', 'Krishna', 'Govinda',
  'Rajendra', 'Mahendra', 'Vijaykumar', 'Sudarshan', 'Prakash', 'Madhu', 'Ranga',
  'Bala', 'Chenna', 'Durga', 'Eswar', 'Ganesh', 'Hari',
];
const MOTHER_FIRST = [
  'Lakshmi', 'Saraswathi', 'Padmavathi', 'Annapurna', 'Kamakshi', 'Vijayalakshmi',
  'Sridevi', 'Parvathi', 'Meenakshi', 'Bhagya', 'Sumathi', 'Renuka', 'Vasantha',
  'Tulasi', 'Savithri', 'Mythili', 'Sharada', 'Uma', 'Geetha', 'Radhika',
];

// ──────────────────────────────────────────────
// Branch / roll-number data
// ──────────────────────────────────────────────
const BRANCH_CODES = {
  'CSE':          { prefix: 'A05', label: 'CSE' },
  'ECE':          { prefix: 'A04', label: 'ECE' },
  'MECH':         { prefix: 'A03', label: 'MECH' },
  'CIVIL':        { prefix: 'A01', label: 'CIVIL' },
  'EEE':          { prefix: 'A02', label: 'EEE' },
  'IT':           { prefix: 'A12', label: 'IT' },
  'AI&ML':        { prefix: 'A47', label: 'AI&ML' },
  'DATA_SCIENCE': { prefix: 'A46', label: 'DATA_SCIENCE' },
};

// Year -> semesters
const YEAR_SEM = {
  1: ['1', '2'],
  2: ['3', '4'],
  3: ['5', '6'],
  4: ['7', '8'],
};

// ──────────────────────────────────────────────
// Subjects (15 real CS/ECE subjects)
// ──────────────────────────────────────────────
const SUBJECTS_DATA = [
  { code: 'CS-401',  name: 'Data Structures & Algorithms',          credits: '4', semester: '4', branch: 'CSE' },
  { code: 'CS-402',  name: 'Operating Systems',                     credits: '4', semester: '4', branch: 'CSE' },
  { code: 'CS-403',  name: 'Computer Networks',                     credits: '3', semester: '4', branch: 'CSE' },
  { code: 'CS-404',  name: 'Database Management Systems',           credits: '4', semester: '4', branch: 'CSE' },
  { code: 'CS-501',  name: 'Web Technologies',                      credits: '3', semester: '5', branch: 'CSE' },
  { code: 'CS-502',  name: 'Software Engineering',                  credits: '3', semester: '5', branch: 'CSE' },
  { code: 'CS-503',  name: 'Compiler Design',                       credits: '4', semester: '5', branch: 'CSE' },
  { code: 'CS-601',  name: 'Machine Learning',                      credits: '4', semester: '6', branch: 'CSE' },
  { code: 'CS-602',  name: 'Cloud Computing',                       credits: '3', semester: '6', branch: 'CSE' },
  { code: 'CS-301',  name: 'Object Oriented Programming',           credits: '4', semester: '3', branch: 'CSE' },
  { code: 'ECE-301', name: 'Digital Electronics',                   credits: '4', semester: '3', branch: 'ECE' },
  { code: 'ECE-401', name: 'Microprocessors & Microcontrollers',    credits: '4', semester: '4', branch: 'ECE' },
  { code: 'MA-201',  name: 'Engineering Mathematics – II',          credits: '4', semester: '2', branch: ''    },
  { code: 'PH-101',  name: 'Engineering Physics',                   credits: '3', semester: '1', branch: ''    },
  { code: 'CS-701',  name: 'Artificial Intelligence',               credits: '4', semester: '7', branch: 'CSE' },
];

// ──────────────────────────────────────────────
// Placements (20 records)
// ──────────────────────────────────────────────
const COMPANIES = [
  { name: 'Tata Consultancy Services',          role: 'Systems Engineer',                 pkg: '3.5',  elig: 'CSE/IT/ECE – 60% aggregate',            arv: true  },
  { name: 'Infosys',                            role: 'Systems Engineer Trainee',         pkg: '3.6',  elig: 'All Branches – 60% aggregate',           arv: false },
  { name: 'Wipro Technologies',                 role: 'Project Engineer',                 pkg: '3.5',  elig: 'CSE/IT – 65% aggregate',                 arv: true  },
  { name: 'Cognizant Technology Solutions',     role: 'Programmer Analyst',               pkg: '4.0',  elig: 'CSE/ECE/IT – 60% aggregate',             arv: false },
  { name: 'Tech Mahindra',                      role: 'Associate Software Engineer',      pkg: '3.8',  elig: 'All Branches – 60% aggregate',           arv: false },
  { name: 'Accenture',                          role: 'Associate Software Engineer',      pkg: '4.5',  elig: 'All Branches – 65% aggregate',           arv: true  },
  { name: 'Capgemini',                          role: 'Software Engineer',                pkg: '4.0',  elig: 'CSE/IT/ECE – 60% aggregate',             arv: false },
  { name: 'HCL Technologies',                   role: 'Graduate Engineer Trainee',        pkg: '3.8',  elig: 'All Branches – 60% aggregate',           arv: false },
  { name: 'IBM India',                          role: 'Application Developer',            pkg: '5.0',  elig: 'CSE/IT – 70% aggregate',                 arv: false },
  { name: 'Deloitte USI',                       role: 'Analyst',                          pkg: '6.0',  elig: 'CSE/ECE/IT – 65% aggregate',             arv: false },
  { name: 'Mphasis',                            role: 'Software Engineer',                pkg: '4.2',  elig: 'CSE/IT – 60% aggregate',                 arv: false },
  { name: 'L&T Infotech (LTIMindtree)',         role: 'Graduate Engineer Trainee',        pkg: '4.5',  elig: 'All Branches – 65% aggregate',           arv: false },
  { name: 'Hexaware Technologies',              role: 'Software Engineer',                pkg: '3.9',  elig: 'CSE/ECE/IT – 60% aggregate',             arv: false },
  { name: 'Oracle Financial Services',          role: 'Associate Consultant',             pkg: '8.0',  elig: 'CSE/IT – 70% aggregate, No Backlogs',    arv: false },
  { name: 'Amazon Development Centre India',    role: 'SDE – I',                          pkg: '12.0', elig: 'CSE/IT – 75% aggregate, No Backlogs',    arv: false },
  { name: 'Persistent Systems',                 role: 'Software Engineer',                pkg: '5.5',  elig: 'CSE/ECE/IT – 65% aggregate',             arv: false },
  { name: 'Zensar Technologies',                role: 'Software Engineer',                pkg: '4.0',  elig: 'CSE/IT – 60% aggregate',                 arv: false },
  { name: 'Mindtree',                           role: 'Software Engineer',                pkg: '4.2',  elig: 'CSE/IT/ECE – 60% aggregate',             arv: false },
  { name: 'Kyndryl (IBM Infrastructure)',       role: 'Network Support Engineer',         pkg: '4.8',  elig: 'ECE/EEE/CSE – 60% aggregate',            arv: false },
  { name: 'Genpact India',                      role: 'Process Associate',                pkg: '3.5',  elig: 'All Branches – 55% aggregate',           arv: false },
];

// ──────────────────────────────────────────────
// Announcements (25 records)
// ──────────────────────────────────────────────
const ANNOUNCEMENTS_DATA = [
  {
    title: 'End Semester Examinations – November 2026 Schedule Released',
    description: 'The End Semester Examination schedule for November 2026 has been released. Students are advised to download the timetable from the college portal and report to their respective examination halls 30 minutes prior to the exam. All students must carry their Hall Tickets. Contact the Exam Section for any discrepancies.',
    priority: 'URGENT', status: 'PUBLISHED',
  },
  {
    title: 'Mid-Term Examinations – Unit Test I (August 2026)',
    description: 'Unit Test I (Mid Term) examinations will be conducted from 11th August to 15th August 2026 as per the schedule uploaded on the portal. All students are instructed to be present. Attendance in mid-term exams is mandatory for eligibility.',
    priority: 'HIGH', status: 'PUBLISHED',
  },
  {
    title: 'Workshop on Full Stack Development using MERN Stack',
    description: 'The Department of CSE is organizing a 3-day workshop on Full Stack Development using the MERN Stack from 5th July to 7th July 2026. Industry experts from Hyderabad will conduct the sessions. Registration is open on the college portal. Limited seats – first come first served.',
    priority: 'NORMAL', status: 'PUBLISHED',
  },
  {
    title: 'National Sports Day – College Holiday Notice',
    description: 'In observance of National Sports Day, the college will remain closed on 29th August 2026. All scheduled classes, labs, and examinations stand postponed. A compensatory class schedule will be announced separately.',
    priority: 'HIGH', status: 'PUBLISHED',
  },
  {
    title: 'Fee Payment Deadline – Hostel Fee Q2 (July–September)',
    description: 'All hostel residents are reminded to clear their Hostel Fee for Q2 (July–September 2026) by 20th July 2026. Failure to pay will result in suspension of hostel facilities. Students with financial difficulties may apply for the Fee Waiver Scheme through the Accounts Section.',
    priority: 'URGENT', status: 'PUBLISHED',
  },
  {
    title: 'Library Book Return Notice – Extended Due Date',
    description: 'All students who have borrowed library books during Semester 4 are requested to return them by 30th June 2026. The library will conduct an inventory audit from 1st July. A fine of Rs. 5 per day will be charged for overdue books after the deadline.',
    priority: 'NORMAL', status: 'PUBLISHED',
  },
  {
    title: 'SITAM Hackathon 2026 – Registrations Open',
    description: 'The annual SITAM Hackathon 2026 is open for registrations. The event will be held on 20th–21st July 2026. Teams of 2–4 members can register on the portal. Problem statements will be released 48 hours before the event. Winner teams get internship opportunities with sponsoring companies.',
    priority: 'HIGH', status: 'PUBLISHED',
  },
  {
    title: 'Anti-Ragging Committee – Awareness Program',
    description: 'An awareness program on Anti-Ragging policies will be conducted on 5th July 2026 in the college auditorium for all first-year students. Attendance is compulsory. Parents are also invited to attend the session. Please report any ragging incidents at ragging@sitamecap.co.in.',
    priority: 'URGENT', status: 'PUBLISHED',
  },
  {
    title: 'Project Submission Deadline – Final Year B.Tech Projects',
    description: 'Final year B.Tech project teams are reminded that the project report submission deadline is 10th July 2026. Hard-bound copies (2 sets) should be submitted to the respective Department Project Coordinator. Viva-voce examinations will be scheduled from 15th July onwards.',
    priority: 'HIGH', status: 'PUBLISHED',
  },
  {
    title: 'Campus Placement Drive – TCS Smart Hiring 2026',
    description: 'Tata Consultancy Services will be conducting their Smart Hiring 2026 placement drive on campus on 18th July 2026. Eligible students (CSE/IT/ECE, 60% aggregate) can register through the Training and Placement portal. Selection process includes an online test followed by TR and HR rounds.',
    priority: 'HIGH', status: 'PUBLISHED',
  },
  {
    title: 'Scholarship Applications – State Government Merit Scholarships',
    description: 'Applications are invited from eligible students for the Telangana State Government Merit Scholarship 2026-27. Students with CGPA 7.0 and above and family income below 2.5 lakh per annum are eligible. Apply online through the TGEPASS portal by 31st July 2026.',
    priority: 'NORMAL', status: 'PUBLISHED',
  },
  {
    title: 'Inauguration of New Computer Lab (Lab-7) – Block C',
    description: 'The new High-Performance Computing Lab (Lab-7) in Block C has been inaugurated. It is equipped with 60 workstations with i7-13th Gen processors, 32 GB RAM, and GPU cards. The lab will be accessible for CSE/AI&ML/Data Science students from 1st July 2026.',
    priority: 'NORMAL', status: 'PUBLISHED',
  },
  {
    title: 'Industrial Visit – Third Year CSE/IT (Hyderabad Tech Park)',
    description: 'A one-day industrial visit is organized for III Year CSE/IT students to the Hyderabad Tech Park (Microsoft and Google campuses) on 12th July 2026. Interested students must register and pay the nominal transport fee of Rs. 300 by 8th July. Bring your college ID cards.',
    priority: 'NORMAL', status: 'PUBLISHED',
  },
  {
    title: 'Student Feedback Survey – Semester 4 Faculty Feedback',
    description: 'The Semester 4 Faculty Feedback survey is now open on the SITAM portal. All students are requested to submit their honest and constructive feedback before 5th July 2026. Feedback is strictly confidential and is used for faculty development and academic improvement.',
    priority: 'NORMAL', status: 'PUBLISHED',
  },
  {
    title: 'Alumni Interaction Session – Career Guidance for II & III Year Students',
    description: 'The Alumni Association is organizing an interaction session on 8th July 2026 in the Seminar Hall, Block A. Alumni from TCS, Infosys, and Microsoft will share their career experiences. All II and III year students are encouraged to attend and interact with the alumni.',
    priority: 'NORMAL', status: 'PUBLISHED',
  },
  {
    title: 'NAAC Accreditation Preparation – Student Briefing',
    description: 'The college is preparing for the NAAC Peer Team Visit scheduled in October 2026. A student briefing session will be held on 7th July 2026 to inform students about the NAAC process and their role. Student representatives from each branch must attend.',
    priority: 'HIGH', status: 'PUBLISHED',
  },
  {
    title: 'Yoga & Wellness Day – 21st June 2026',
    description: 'On the occasion of International Yoga Day, the NSS unit of SITAM is organizing a Yoga & Wellness session on 21st June 2026 in the college grounds at 6:00 AM. All students and staff are invited to participate. Certificates will be issued to participants.',
    priority: 'NORMAL', status: 'PUBLISHED',
  },
  {
    title: 'Dress Code Reminder – Academic Year 2026-27',
    description: 'All students are reminded to adhere to the prescribed college dress code during working days. Students found violating the dress code will be denied entry. Casual wear is only permitted on designated Saturdays. Please refer to the Student Handbook for details.',
    priority: 'NORMAL', status: 'PUBLISHED',
  },
  {
    title: 'Sports Day – SITAM Annual Sports Fest KRIDA 2026',
    description: 'SITAM Annual Sports Fest KRIDA 2026 will be held from 15th to 18th September 2026. Events include athletics, cricket, volleyball, badminton, chess, and kabaddi. Registration open till 10th September. Champions will receive cash prizes and trophies. Represent your branch!',
    priority: 'NORMAL', status: 'PUBLISHED',
  },
  {
    title: '[DRAFT] Revised Academic Calendar – Semester 5 (2026-27)',
    description: 'The revised academic calendar for Semester 5, Academic Year 2026-27 is being finalized. Expected commencement: 1st August 2026. Details will be published after the Board of Studies approval. This is a draft notice.',
    priority: 'NORMAL', status: 'DRAFT',
  },
  {
    title: '[DRAFT] New Elective Subjects Offered – Semester 7 (2026-27)',
    description: 'The CSE department proposes to offer the following elective subjects in Semester 7: (1) Blockchain Technology (2) Quantum Computing Fundamentals (3) DevOps & MLOps (4) Cybersecurity & Ethical Hacking. Student preference survey to be launched soon.',
    priority: 'NORMAL', status: 'DRAFT',
  },
  {
    title: '[DRAFT] Updated Hostel Regulations – 2026-27',
    description: 'Revised hostel regulations for the academic year 2026-27 are under review. Key changes include new gate-pass procedures, updated mess timings, and WiFi usage policies. The final regulation document will be shared after warden approval.',
    priority: 'HIGH', status: 'DRAFT',
  },
  {
    title: '[DRAFT] Cultural Fest SPANDANA 2026 – Event Categories',
    description: 'The cultural committee is planning the annual cultural fest SPANDANA 2026. Event categories under consideration: Classical Dance, Western Dance, Singing, Skit, Ramp Walk, Rangoli, and Photography Contest. Event dates tentatively set for October 2026.',
    priority: 'NORMAL', status: 'DRAFT',
  },
  {
    title: '[DRAFT] IEEE Student Chapter – New Committee Formation',
    description: 'The SITAM IEEE Student Chapter is forming a new committee for 2026-27. Nominations are being called for President, Vice-President, Secretary, and Treasurer positions. Eligible candidates (III Year, CGPA 7.5 and above) may submit their applications to the faculty advisor.',
    priority: 'NORMAL', status: 'DRAFT',
  },
  {
    title: '[DRAFT] Revised Fee Structure – Academic Year 2027-28',
    description: 'The college management is reviewing the fee structure for the Academic Year 2027-28. Proposed changes include a 5% revision in Tuition Fee and introduction of a Digital Learning Fee of Rs. 1,000 per semester. Final structure pending University approval.',
    priority: 'HIGH', status: 'DRAFT',
  },
  {
    title: 'Emergency Contact Numbers – Campus Security Update',
    description: 'The campus security emergency contact numbers have been updated. For any emergency, students may contact the Security Control Room at 040-2345-6789 (24x7). The numbers are also posted on the college notice boards and the SITAM Smart ERP app.',
    priority: 'NORMAL', status: 'PUBLISHED',
  },
];

// ──────────────────────────────────────────────
// Fee Notice data (15 records)
// ──────────────────────────────────────────────
const FEE_NOTICES_DATA = [
  { title: 'Tuition Fee – Semester 5 Due Notice', description: 'Tuition Fee for Semester 5 (Academic Year 2026-27) is now due. All students are requested to pay the full amount of Rs. 45,000 by the due date. Late payment will attract a penalty of Rs. 100 per day. Contact the Accounts Section for fee receipts.', dueDate: dateStr(daysFromNow(12)), targetBatch: 'ALL', priority: 'HIGH', popupEnabled: true, hallTicketBlockWarning: true, isActive: true },
  { title: 'Hostel Fee – Q3 (October–December 2026)', description: 'Hostel fee for Q3 (October to December 2026) amounting to Rs. 18,000 must be paid by 5th October 2026. Students with outstanding dues from previous quarters must clear them first. Non-payment will result in hostel facility suspension.', dueDate: dateStr(daysFromNow(8)), targetBatch: 'HOSTEL', priority: 'HIGH', popupEnabled: true, hallTicketBlockWarning: false, isActive: true },
  { title: 'Examination Fee – End Semester (November 2026)', description: 'Examination fee for the End Semester Examinations (November 2026) is Rs. 1,200 per student. Payment must be made online through the college fee portal or at the Accounts Section counter. Fee payment is mandatory to receive the Hall Ticket.', dueDate: dateStr(daysFromNow(5)), targetBatch: 'ALL', priority: 'URGENT', popupEnabled: true, hallTicketBlockWarning: true, isActive: true },
  { title: 'Library Fine Payment – Overdue Books', description: 'Students who have overdue library books are notified to clear library fines before 30th June 2026. The fine amount varies per student; individual statements can be collected from the library counter. Hall Tickets will not be issued until library dues are cleared.', dueDate: dateStr(daysFromNow(3)), targetBatch: 'ALL', priority: 'HIGH', popupEnabled: true, hallTicketBlockWarning: true, isActive: true },
  { title: 'Bus Fee – Semester 5 (Annual Route Fee)', description: 'Annual Bus Route Fee for the Academic Year 2026-27 is due. Fee varies by route (Rs. 8,000 to Rs. 15,000). Students availing college bus services must pay before 31st July 2026. Contact the Transport Office for route-wise fee details.', dueDate: dateStr(daysFromNow(14)), targetBatch: 'DAY_SCHOLARS', priority: 'NORMAL', popupEnabled: true, hallTicketBlockWarning: false, isActive: true },
  { title: 'Special Fee – Laboratory Development (Sem 5)', description: 'Laboratory Development Fee of Rs. 2,000 is applicable for all students for Semester 5. This fee covers equipment maintenance, consumables, and new lab installations. Payment due by 20th August 2026.', dueDate: dateStr(daysFromNow(20)), targetBatch: 'ALL', priority: 'NORMAL', popupEnabled: true, hallTicketBlockWarning: false, isActive: true },
  { title: 'Tuition Fee – Semester 3 Balance Due (2025-26)', description: 'Students who have pending balance in Tuition Fee for Semester 3 (2025-26) are requested to clear the dues immediately. Continued default will result in Hall Ticket withholding for upcoming exams. Contact Accounts Section with fee receipts for reconciliation.', dueDate: dateStr(daysFromNow(2)), targetBatch: 'ALL', priority: 'URGENT', popupEnabled: true, hallTicketBlockWarning: true, isActive: true },
  { title: 'Sports & Games Fee – Annual (2026-27)', description: 'Annual Sports & Games Fee of Rs. 500 is due for all students for the academic year 2026-27. This fee supports KRIDA 2026 sports events and purchase of sports equipment for student use. Payment at the Accounts counter by 15th August 2026.', dueDate: dateStr(daysFromNow(25)), targetBatch: 'ALL', priority: 'NORMAL', popupEnabled: false, hallTicketBlockWarning: false, isActive: true },
  { title: 'Caution Deposit – First Year Students', description: 'First year students who have not paid the Caution Deposit of Rs. 5,000 are reminded to pay the same before 31st July 2026. The Caution Deposit is refundable at the time of course completion, subject to no dues. Receipts must be kept safely.', dueDate: dateStr(daysFromNow(30)), targetBatch: 'FIRST_YEAR', priority: 'NORMAL', popupEnabled: true, hallTicketBlockWarning: false, isActive: true },
  { title: 'Hostel Maintenance Fee – Annual (2026-27)', description: 'Annual hostel maintenance fee of Rs. 3,000 covers room maintenance, plumbing, electrical repairs, and common area upkeep. All hostel residents must pay by 31st August 2026. Payment can be made at the Accounts Section.', dueDate: dateStr(daysFromNow(40)), targetBatch: 'HOSTEL', priority: 'NORMAL', popupEnabled: false, hallTicketBlockWarning: false, isActive: true },
  { title: 'Smart ERP App Registration – Nominal Fee', description: 'A one-time nominal fee of Rs. 100 is applicable for SITAM Smart ERP App registration. This covers app maintenance and server costs. Students who have not yet registered on the app are requested to pay and complete registration before 15th July 2026.', dueDate: dateStr(daysFromNow(18)), targetBatch: 'ALL', priority: 'NORMAL', popupEnabled: false, hallTicketBlockWarning: false, isActive: true },
  { title: '[CLOSED] Tuition Fee – Semester 4 (2025-26)', description: 'The due date for Semester 4 Tuition Fee payment has passed. Students who have still not paid are requested to visit the Accounts Section immediately. Penalty charges have been applied. This notice is kept for record purposes.', dueDate: dateStr(daysAgo(10)), targetBatch: 'ALL', priority: 'HIGH', popupEnabled: false, hallTicketBlockWarning: true, isActive: false },
  { title: '[CLOSED] Exam Fee – Mid-Term Unit Test II (2025-26)', description: 'The examination fee collection for Mid-Term Unit Test II has been closed. Students who missed the payment window are advised to contact the Exam Section before the make-up deadline. This notice is archived.', dueDate: dateStr(daysAgo(20)), targetBatch: 'ALL', priority: 'NORMAL', popupEnabled: false, hallTicketBlockWarning: false, isActive: false },
  { title: 'NSS Activity Fee – Annual Contribution (2026-27)', description: 'NSS enrolled students are required to pay the annual contribution of Rs. 200 for NSS activities, camps, and community service programs for 2026-27. Payment due by 30th July 2026 at the NSS Office.', dueDate: dateStr(daysFromNow(35)), targetBatch: 'NSS', priority: 'NORMAL', popupEnabled: false, hallTicketBlockWarning: false, isActive: true },
  { title: 'Alumni Association Membership Fee – Final Year Students', description: 'Final year students are requested to pay the one-time Alumni Association membership fee of Rs. 500. This gives lifetime membership to the SITAM Alumni Association, access to alumni network, job referrals, and event invitations. Payment before 30th September 2026.', dueDate: dateStr(daysFromNow(60)), targetBatch: 'FINAL_YEAR', priority: 'NORMAL', popupEnabled: false, hallTicketBlockWarning: false, isActive: true },
];

// ──────────────────────────────────────────────
// Exit pass reasons / destinations
// ──────────────────────────────────────────────
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
];
const EXIT_DESTINATIONS = [
  'Yashoda Hospitals, Secunderabad',
  'KPHB Colony, Hyderabad',
  'SBI Bank, Ameerpet',
  'Begumpet, Hyderabad',
  'Dr. Reddy Diagnostics, Ameerpet',
  'Secunderabad Railway Station',
  'Uppal Government Hospital',
  'LV Prasad Eye Institute, Banjara Hills',
  'Masab Tank, Hyderabad',
  'SR Nagar, Hyderabad',
  'Dilsukhnagar, Hyderabad',
  'Kukatpally, Hyderabad',
  'Nampally RTO, Hyderabad',
  'Mehdipatnam, Hyderabad',
  'MGBS Imlibun Bus Station, Hyderabad',
];

// ──────────────────────────────────────────────
// Audit log entries (30 records)
// ──────────────────────────────────────────────
const AUDIT_ENTRIES = [
  { action: 'ADMIN_LOGIN',         severity: 'INFO',     detail: 'Admin logged in from IP 192.168.1.105 using Chrome on Windows.' },
  { action: 'ADMIN_LOGIN',         severity: 'SECURITY', detail: 'Admin login from unusual IP 103.45.67.89 – flagged for review.' },
  { action: 'ADMIN_LOGOUT',        severity: 'INFO',     detail: 'Admin session ended after 2h 15m. All changes saved.' },
  { action: 'ADMIN_LOGOUT',        severity: 'INFO',     detail: 'Admin auto-logged out due to session timeout (30 min idle).' },
  { action: 'EXIT_PASS_APPROVED',  severity: 'INFO',     detail: 'Exit pass approved for student 25B61A0501. OTP dispatched via notification.' },
  { action: 'EXIT_PASS_APPROVED',  severity: 'INFO',     detail: 'Exit pass approved for student 24B61A0412. Reason: Medical appointment.' },
  { action: 'EXIT_PASS_APPROVED',  severity: 'INFO',     detail: 'Exit pass approved for student 23B61A0301. Reason: Family emergency.' },
  { action: 'OTP_VERIFIED',        severity: 'INFO',     detail: 'OTP verified at main gate for exit pass. Gate scan by security guard Ravi Kumar.' },
  { action: 'OTP_VERIFIED',        severity: 'INFO',     detail: 'OTP verified successfully. Student exit recorded at 14:35.' },
  { action: 'OTP_VERIFIED',        severity: 'WARNING',  detail: 'OTP verification attempted after expiry. Student directed to warden for re-approval.' },
  { action: 'FEE_NOTICE_CREATED',  severity: 'INFO',     detail: 'New fee notice created: Tuition Fee Semester 5 Due Notice. Popup enabled.' },
  { action: 'FEE_NOTICE_CREATED',  severity: 'INFO',     detail: 'New fee notice created: Examination Fee End Semester November 2026. Hall ticket block warning set.' },
  { action: 'FEE_NOTICE_CREATED',  severity: 'INFO',     detail: 'Fee notice for Hostel Fee Q3 created and activated. Target: HOSTEL batch.' },
  { action: 'PLACEMENT_PUBLISHED', severity: 'INFO',     detail: 'Placement drive for TCS Smart Hiring 2026 published. Notifications sent to 382 eligible students.' },
  { action: 'PLACEMENT_PUBLISHED', severity: 'INFO',     detail: 'Placement drive for Infosys Campus Hiring published. Drive date: 25th July 2026.' },
  { action: 'PLACEMENT_PUBLISHED', severity: 'INFO',     detail: 'Amazon SDE-I placement drive published. Restricted to CSE/IT students with 75%+ aggregate.' },
  { action: 'MAINTENANCE_TOGGLE',  severity: 'WARNING',  detail: 'System maintenance mode ENABLED by Super Admin. All student logins blocked temporarily.' },
  { action: 'MAINTENANCE_TOGGLE',  severity: 'WARNING',  detail: 'System maintenance mode DISABLED. Normal operations resumed. Duration: 45 minutes.' },
  { action: 'ADMIN_LOGIN',         severity: 'SECURITY', detail: 'Multiple failed login attempts detected for admin account accounts@sitamecap.co.in. Account temporarily locked.' },
  { action: 'OTP_VERIFIED',        severity: 'CRITICAL', detail: 'OTP reuse attempt detected for exit pass. Security incident logged. Pass invalidated.' },
  { action: 'EXIT_PASS_APPROVED',  severity: 'INFO',     detail: 'Batch exit pass approval: 3 students approved for industrial visit to Tech Park.' },
  { action: 'ADMIN_LOGOUT',        severity: 'INFO',     detail: 'Accounts admin session ended. Fee notice updates committed successfully.' },
  { action: 'FEE_NOTICE_CREATED',  severity: 'INFO',     detail: 'Library Fine Payment notice created with Hall Ticket block warning. 47 students affected.' },
  { action: 'PLACEMENT_PUBLISHED', severity: 'INFO',     detail: 'companyArrivedToday flag set for TCS, Wipro, Accenture. Live banners activated on student portal.' },
  { action: 'MAINTENANCE_TOGGLE',  severity: 'WARNING',  detail: 'Scheduled maintenance window started for database migration (Prisma migration v2.1).' },
  { action: 'OTP_VERIFIED',        severity: 'INFO',     detail: 'Exit OTP verified for 5 students simultaneously during industrial visit departure.' },
  { action: 'ADMIN_LOGIN',         severity: 'INFO',     detail: 'Placement admin logged in. New placement drives to be published for next week.' },
  { action: 'FEE_NOTICE_CREATED',  severity: 'INFO',     detail: 'Exam fee notice created and popupEnabled set. Notifications queued for dispatch.' },
  { action: 'EXIT_PASS_APPROVED',  severity: 'INFO',     detail: 'Exit pass approved for student who lost phone. OTP sent to registered email as fallback.' },
  { action: 'ADMIN_LOGOUT',        severity: 'INFO',     detail: 'Security guard account logged out after shift end at 22:00.' },
];

// ══════════════════════════════════════════════
// MAIN SEED FUNCTION
// ══════════════════════════════════════════════
async function main() {
  console.log('🌱 Starting SITAM Smart ERP demo data seed...\n');

  // ── 0. System Setting ────────────────────────
  console.log('⚙️  Upserting SystemSetting...');
  await prisma.systemSetting.upsert({
    where:  { id: 'system' },
    update: {},
    create: {
      id: 'system',
      maintenanceMode: false,
      maintenanceMessage: 'SITAM Smart ERP is currently undergoing scheduled maintenance. Please try again later.',
    },
  });

  // ── 1. Admin accounts ────────────────────────
  console.log('👤  Upserting admin accounts...');
  const adminDefs = [
    { email: 'admin@sitamecap.co.in',      name: 'Super Administrator',     role: 'SUPER_ADMIN' },
    { email: 'accounts@sitamecap.co.in',   name: 'Accounts Admin',          role: 'ACCOUNTS_ADMIN' },
    { email: 'placements@sitamecap.co.in', name: 'Placements Admin',        role: 'PLACEMENT_ADMIN' },
    { email: 'security@sitamecap.co.in',   name: 'Security Guard – Gate 1', role: 'SECURITY_GUARD' },
  ];
  const createdAdmins = [];
  for (const a of adminDefs) {
    const admin = await prisma.admin.upsert({
      where:  { email: a.email },
      update: { name: a.name, role: a.role, isActive: true },
      create: { email: a.email, passwordHash: hashPassword('Admin@1234'), name: a.name, role: a.role, isActive: true },
    });
    createdAdmins.push(admin);
  }
  console.log('   ✅ ' + createdAdmins.length + ' admins ready');

  // ── 2. Subjects ──────────────────────────────
  console.log('\n📚  Upserting subjects...');
  const subjectMap = {};
  for (const s of SUBJECTS_DATA) {
    const subject = await prisma.subject.upsert({
      where:  { code: s.code },
      update: { name: s.name, credits: s.credits, semester: s.semester, branch: s.branch },
      create: { code: s.code, name: s.name, credits: s.credits, semester: s.semester, branch: s.branch },
    });
    subjectMap[s.code] = subject;
  }
  const subjectList = Object.values(subjectMap);
  console.log('   ✅ ' + subjectList.length + ' subjects ready');

  // ── 3. Students (100) ────────────────────────
  console.log('\n🎓  Creating 100 students...');

  const studentPassword = hashPassword('Student@123');
  const FEE_TYPES   = ['Tuition Fee', 'Hostel Fee', 'Exam Fee', 'Library Fine', 'Bus Fee', 'Lab Fee'];
  const MARK_TYPES  = ['Core', 'Lab'];

  // Student distribution: [branch, year, count] – totals 100
  const DIST = [
    ['CSE',          1, 8], ['CSE',          2, 7], ['CSE',          3, 7], ['CSE',          4, 6],
    ['ECE',          1, 6], ['ECE',          2, 5], ['ECE',          3, 5], ['ECE',          4, 4],
    ['IT',           1, 4], ['IT',           2, 3], ['IT',           3, 3], ['IT',           4, 3],
    ['AI&ML',        1, 5], ['AI&ML',        2, 4],
    ['DATA_SCIENCE', 1, 4], ['DATA_SCIENCE', 2, 3],
    ['MECH',         1, 4], ['MECH',         2, 3], ['MECH',         3, 3],
    ['EEE',          1, 3], ['EEE',          2, 3],
    ['CIVIL',        1, 3], ['CIVIL',        2, 3],
  ];

  const ADDRESSES = [
    'Rajiv Nagar, Hyderabad – 500072',
    'KPHB Phase 5, Kukatpally, Hyderabad – 500085',
    'Srinivasa Apartments, Ameerpet, Hyderabad – 500016',
    'Ramachandra Nagar, Secunderabad – 500015',
    'Vidyanagar Colony, Nampally, Hyderabad – 500001',
    'Teachers Colony, Dilsukhnagar, Hyderabad – 500060',
    'Srinagar Colony, Banjara Hills, Hyderabad – 500034',
    'Jawaharlal Nehru Road, Warangal – 506001',
    'Ghanpur Village, Jangaon, Warangal – 506167',
    'Swapna Residency, LB Nagar, Hyderabad – 500074',
    'Vidya Nagar, Nizamabad – 503001',
    'Shivaji Nagar, Karimnagar – 505001',
    'Gandhi Nagar, Khammam – 507001',
    'Padmavathi Nagar, Nalgonda – 508001',
    'Subhash Nagar, Adilabad – 504001',
  ];

  const studentProfiles = [];
  const usedRolls = new Set();
  let globalSeq = 1;

  for (const entry of DIST) {
    const branch = entry[0];
    const year   = entry[1];
    const count  = entry[2];
    const bc     = BRANCH_CODES[branch];
    const sems   = YEAR_SEM[year];
    const sem    = sems[Math.floor(Math.random() * sems.length)];

    // Year prefix for roll number
    const yearPrefixMap = { 1: '25', 2: '24', 3: '23', 4: '22' };
    const yearPrefix = yearPrefixMap[year];

    for (let i = 0; i < count; i++) {
      const gender    = Math.random() < 0.6 ? 'Male' : 'Female';
      const firstName = gender === 'Male' ? rnd(FIRST_NAMES_MALE) : rnd(FIRST_NAMES_FEMALE);
      const lastName  = rnd(LAST_NAMES);
      const name      = firstName + ' ' + lastName;

      // Build unique roll number
      let roll;
      let attempts = 0;
      do {
        const seq = String(globalSeq + attempts).padStart(2, '0');
        roll = yearPrefix + bc.prefix + seq;
        attempts++;
      } while (usedRolls.has(roll) && attempts < 100);
      globalSeq += attempts;
      usedRolls.add(roll);

      const email   = roll.toLowerCase() + '@sitamecap.co.in';
      const phone   = rnd(['7', '8', '9']) + String(rndInt(100000000, 999999999));
      const fPhone  = rnd(['7', '8', '9']) + String(rndInt(100000000, 999999999));
      const cgpa    = rndFloat(5.5, 9.8, 2).toFixed(2);
      const pct     = Math.max(40, parseFloat(cgpa) * 10 - rndInt(0, 5)).toFixed(2);
      const dobYear = rndInt(2000, 2005);
      const dobMon  = String(rndInt(1, 12)).padStart(2, '0');
      const dobDay  = String(rndInt(1, 28)).padStart(2, '0');
      const dob     = dobYear + '-' + dobMon + '-' + dobDay;
      const hostel  = Math.random() < 0.4 ? 'Yes' : 'No';
      const roomNo  = hostel === 'Yes' ? 'B' + rndInt(1, 4) + '-' + rndInt(100, 450) : 'N/A';
      const section = rnd(['A', 'B', 'C']);
      const fatherName = rnd(FATHER_FIRST) + ' ' + lastName;
      const motherName = rnd(MOTHER_FIRST) + ' ' + lastName;

      studentProfiles.push({
        roll, name, email, phone, fPhone, cgpa, pct: String(pct), dob,
        hostel, roomNo, section, branch, year: String(year),
        semester: String(parseInt(sem, 10)), gender, fatherName, motherName,
        address: rndInt(1, 99) + ', ' + rnd(ADDRESSES),
        program: 'B.Tech',
      });
    }
  }

  // Ensure exactly 100
  const finalStudents = studentProfiles.slice(0, 100);
  const createdStudents = [];

  for (let idx = 0; idx < finalStudents.length; idx++) {
    const sp = finalStudents[idx];
    if ((idx + 1) % 10 === 0) {
      console.log('   ... seeded ' + (idx + 1) + '/100 students');
    }
    try {
      const student = await prisma.student.upsert({
        where:  { userId: sp.roll },
        update: {
          name: sp.name, email: sp.email, phone: sp.phone,
          lastSync: new Date(), branch: sp.branch,
          semester: sp.semester, year: sp.year,
          cgpa: sp.cgpa, percentage: sp.pct,
        },
        create: {
          userId:       sp.roll,
          password:     studentPassword,
          name:         sp.name,
          roll:         sp.roll,
          roll_number:  sp.roll,
          program:      sp.program,
          branch:       sp.branch,
          semester:     sp.semester,
          section:      sp.section,
          year:         sp.year,
          gender:       sp.gender,
          dob:          sp.dob,
          email:        sp.email,
          phone:        sp.phone,
          fatherName:   sp.fatherName,
          motherName:   sp.motherName,
          fatherMobile: sp.fPhone,
          hostel:       sp.hostel,
          roomNo:       sp.roomNo,
          cgpa:         sp.cgpa,
          percentage:   sp.pct,
          address:      sp.address,
          lastSync:     new Date(),
        },
      });
      // Attach profile for later use
      student._profile = sp;
      createdStudents.push(student);
    } catch (err) {
      console.warn('   ⚠️  Could not upsert student ' + sp.roll + ': ' + err.message);
    }
  }
  console.log('   ✅ ' + createdStudents.length + ' students ready\n');

  // ── 4. Fee Records (4–6 per student) ─────────
  console.log('💰  Creating fee records...');
  let feeCount = 0;
  for (const s of createdStudents) {
    const numFees  = rndInt(4, 6);
    const usedTypes = new Set();
    for (let f = 0; f < numFees; f++) {
      let feeType;
      let tries = 0;
      do { feeType = rnd(FEE_TYPES); tries++; } while (usedTypes.has(feeType) && tries < 20);
      usedTypes.add(feeType);

      const amount    = rndFloat(1000, 50000, 2);
      const paid      = rndFloat(0, amount, 2);
      const due       = parseFloat((amount - paid).toFixed(2));
      const payStatus = due <= 0 ? 'Paid' : paid === 0 ? 'Unpaid' : 'Partial';
      const dueDaysOff = rndInt(-30, 60);
      const dueDateObj = dueDaysOff >= 0 ? daysFromNow(dueDaysOff) : daysAgo(Math.abs(dueDaysOff));

      try {
        await prisma.fee.create({
          data: {
            studentId:     s.id,
            semester:      s._profile.semester,
            feeType,
            amount,
            paidAmount:    paid,
            dueAmount:     Math.max(0, due),
            dueDate:       dateStr(dueDateObj),
            paymentStatus: payStatus,
          },
        });
        feeCount++;
      } catch (err) {
        console.warn('   ⚠️  Fee create failed: ' + err.message);
      }
    }
  }
  console.log('   ✅ ' + feeCount + ' fee records created');

  // ── 5. Attendance Records (5–8 per student) ───
  console.log('\n📋  Creating attendance records...');
  let attCount = 0;
  for (const s of createdStudents) {
    const numAtt   = rndInt(5, 8);
    const usedSubs = new Set();
    for (let a = 0; a < numAtt; a++) {
      let sub;
      let tries = 0;
      do { sub = rnd(subjectList); tries++; } while (usedSubs.has(sub.id) && tries < 30);
      usedSubs.add(sub.id);

      const held     = rndInt(20, 60);
      const attended = rndInt(Math.floor(held * 0.5), held);
      const pct      = parseFloat(((attended / held) * 100).toFixed(2));
      const status   = pct >= 90 ? 'Excellent' : pct >= 80 ? 'Good' : pct >= 75 ? 'Acceptable' : 'Warning';

      try {
        await prisma.attendanceRecord.create({
          data: {
            studentId:  s.id,
            subjectId:  sub.id,
            held,
            attended,
            percentage: pct,
            status,
            date:       dateStr(daysAgo(rndInt(1, 30))),
          },
        });
        attCount++;
      } catch (err) {
        console.warn('   ⚠️  Attendance create failed: ' + err.message);
      }
    }
  }
  console.log('   ✅ ' + attCount + ' attendance records created');

  // ── 6. Mark Records (3–5 per student) ────────
  console.log('\n📝  Creating mark records...');
  let markCount = 0;
  for (const s of createdStudents) {
    const numMarks = rndInt(3, 5);
    const usedSubs = new Set();
    for (let m = 0; m < numMarks; m++) {
      let sub;
      let tries = 0;
      do { sub = rnd(subjectList); tries++; } while (usedSubs.has(sub.id) && tries < 30);
      usedSubs.add(sub.id);

      const marks    = rndInt(0, 100);
      const maxMarks = 100;
      let grade, status;
      if (marks >= 90)      { grade = 'O';  status = 'Pass'; }
      else if (marks >= 80) { grade = 'A+'; status = 'Pass'; }
      else if (marks >= 70) { grade = 'A';  status = 'Pass'; }
      else if (marks >= 60) { grade = 'B+'; status = 'Pass'; }
      else if (marks >= 50) { grade = 'B';  status = 'Pass'; }
      else if (marks >= 40) { grade = 'C';  status = 'Pass'; }
      else                  { grade = 'F';  status = Math.random() < 0.5 ? 'Fail' : 'Backlog'; }

      try {
        await prisma.markRecord.create({
          data: {
            studentId: s.id,
            subjectId: sub.id,
            grade,
            credits:   sub.credits,
            type:      rnd(MARK_TYPES),
            marks,
            maxMarks,
            status,
          },
        });
        markCount++;
      } catch (err) {
        console.warn('   ⚠️  Mark create failed: ' + err.message);
      }
    }
  }
  console.log('   ✅ ' + markCount + ' mark records created');

  // ── 7. Notifications (1–3 per student) ────────
  console.log('\n🔔  Creating student notifications...');

  function buildNotif(s) {
    const templates = [
      {
        title: 'Attendance Warning',
        message: 'Your attendance has dropped below 75% in Data Structures & Algorithms. Attend all classes to avoid being marked as a defaulter, ' + s.name + '.',
        type: 'attendance', category: 'alert',
      },
      {
        title: 'Marks Updated',
        message: 'Mid-Term Unit Test I marks for Operating Systems have been updated. Your score: ' + rndInt(40, 98) + '/100. Check the portal for details.',
        type: 'marks', category: 'update',
      },
      {
        title: 'Fee Reminder',
        message: 'Tuition Fee payment of Rs. ' + rndInt(5000, 45000) + ' is due in ' + rndInt(3, 15) + ' days. Pay before the due date to avoid penalties, ' + s.name + '.',
        type: 'fees', category: 'reminder',
      },
      {
        title: 'New Assignment Posted',
        message: 'A new assignment on Binary Trees – Traversal Techniques has been posted for CS-401. Due date: ' + dateStr(daysFromNow(7)) + '. Submit via portal.',
        type: 'assignments', category: 'update',
      },
      {
        title: 'Exam Schedule Released',
        message: 'End Semester Examination schedule for November 2026 is now available. Download your hall ticket from the portal. Exam starts at 09:00 AM.',
        type: 'exams', category: 'alert',
      },
      {
        title: 'Welcome to SITAM Smart ERP',
        message: 'Hello ' + s.name + '! Welcome to the SITAM Smart ERP portal. Stay updated with your attendance, marks, and college notifications in real-time.',
        type: 'announcement', category: 'success',
      },
      {
        title: 'Attendance Improved',
        message: 'Great job, ' + s.name + '! Your attendance in Computer Networks improved to 82% this week. Keep attending all classes.',
        type: 'attendance', category: 'success',
      },
      {
        title: 'Hostel Fee Due',
        message: 'Hostel fee for Q3 (October–December 2026) is now due. Pay Rs. 18,000 by 5th October 2026 to avoid suspension of hostel facility.',
        type: 'fees', category: 'reminder',
      },
      {
        title: 'Placement Drive: TCS Smart Hiring 2026',
        message: 'TCS Smart Hiring 2026 is scheduled on 18th July 2026. You are eligible! Register now through the T&P portal before 15th July 2026.',
        type: 'announcement', category: 'alert',
      },
      {
        title: 'Marks – Excellent Performance',
        message: 'Congratulations ' + s.name + '! You scored O grade (95/100) in Web Technologies. Keep up the excellent work!',
        type: 'marks', category: 'success',
      },
    ];
    return rnd(templates);
  }

  let notifCount = 0;
  for (const s of createdStudents) {
    const numNotifs = rndInt(1, 3);
    for (let n = 0; n < numNotifs; n++) {
      const tmpl = buildNotif(s);
      try {
        await prisma.notification.create({
          data: {
            studentId: s.id,
            title:     tmpl.title,
            message:   tmpl.message,
            type:      tmpl.type,
            category:  tmpl.category,
            isRead:    Math.random() < 0.4,
            date:      dateStr(daysAgo(rndInt(0, 30))),
          },
        });
        notifCount++;
      } catch (err) {
        console.warn('   ⚠️  Notification create failed: ' + err.message);
      }
    }
  }
  console.log('   ✅ ' + notifCount + ' notifications created');

  // ── 8. Exit Passes (20 total, 5 per status) ───
  console.log('\n🚪  Creating exit pass records...');

  const EP_GROUPS = [
    { status: 'PENDING',  count: 5 },
    { status: 'APPROVED', count: 5 },
    { status: 'USED',     count: 5 },
    { status: 'REJECTED', count: 5 },
  ];

  const REJECTION_NOTES = [
    'Insufficient reason provided. Please submit a supporting document.',
    'Parent approval letter required for medical leave.',
    'Late request – exit passes must be submitted before 9 AM on working days.',
    'Destination not within permitted radius for same-day return.',
    'Previous exit pass pending clearance. Resolve first.',
  ];

  let epCount = 0;
  let epStudentIdx = 0;
  const superAdmin = createdAdmins[0];

  for (const epGroup of EP_GROUPS) {
    for (let i = 0; i < epGroup.count; i++) {
      const s = createdStudents[epStudentIdx % createdStudents.length];
      epStudentIdx += 7; // spread across different students

      const reason      = rnd(EXIT_REASONS);
      const destination = rnd(EXIT_DESTINATIONS);
      const reqDate     = dateStr(daysAgo(rndInt(0, 15)));

      let extraData = {};

      if (epGroup.status === 'APPROVED') {
        const otp = String(rndInt(100000, 999999));
        extraData = {
          otpHash:    hashOTP(otp),
          otpExpiry:  daysFromNow(1),
          approvedAt: daysAgo(rndInt(0, 3)),
          approvedBy: superAdmin.id,
          qrCode:     'https://sitam-erp.app/ep/verify/' + crypto.randomBytes(8).toString('hex'),
        };
      } else if (epGroup.status === 'USED') {
        const otp = String(rndInt(100000, 999999));
        extraData = {
          otpHash:    hashOTP(otp),
          otpExpiry:  daysAgo(rndInt(1, 5)),
          approvedAt: daysAgo(rndInt(2, 7)),
          approvedBy: superAdmin.id,
          verifiedAt: daysAgo(rndInt(0, 2)),
          verifiedBy: superAdmin.id,
          qrCode:     'https://sitam-erp.app/ep/verify/' + crypto.randomBytes(8).toString('hex'),
        };
      } else if (epGroup.status === 'REJECTED') {
        extraData = { rejectionNote: rnd(REJECTION_NOTES) };
      }

      try {
        await prisma.exitPass.create({
          data: {
            studentId:     s.id,
            reason,
            destination,
            requestedDate: reqDate,
            status:        epGroup.status,
            ...extraData,
          },
        });
        epCount++;
      } catch (err) {
        console.warn('   ⚠️  ExitPass create failed: ' + err.message);
      }
    }
  }
  console.log('   ✅ ' + epCount + ' exit passes created (5 PENDING, 5 APPROVED, 5 USED, 5 REJECTED)');

  // ── 9. Placements (20) ────────────────────────
  console.log('\n🏢  Creating placement records...');

  const DRIVE_FORM_LINKS = [
    'https://docs.google.com/forms/d/e/1FAIpQLSdemo_TCS_2026/viewform',
    'https://docs.google.com/forms/d/e/1FAIpQLSdemo_Infosys_2026/viewform',
    'https://docs.google.com/forms/d/e/1FAIpQLSdemo_Wipro_2026/viewform',
    'https://docs.google.com/forms/d/e/1FAIpQLSdemo_CTS_2026/viewform',
    'https://docs.google.com/forms/d/e/1FAIpQLSdemo_Accenture_2026/viewform',
    'https://docs.google.com/forms/d/e/1FAIpQLSdemo_HCL_2026/viewform',
    'https://docs.google.com/forms/d/e/1FAIpQLSdemo_IBM_2026/viewform',
    'https://forms.gle/SITAMPlacementDrive2026A',
    'https://forms.gle/SITAMPlacementDrive2026B',
    'https://forms.gle/SITAMPlacementDrive2026C',
  ];

  function buildPlacementDesc(c) {
    const year = new Date().getFullYear();
    const opts = [
      c.name + ' is visiting SITAM for campus recruitment ' + year + '. Selected candidates will join as ' + c.role + '. Process: Online Aptitude Test → Technical Round → HR Interview. Dress code: Formals. Bring 3 copies of resume, 2 passport photos, and original mark sheets (Sem 1–latest).',
      c.name + ' Campus Drive ' + year + ' at SITAM Engineering College. Role: ' + c.role + '. CTC: ' + c.pkg + ' LPA. Eligibility: ' + c.elig + '. Bond: None. Location: Hyderabad / Bengaluru / Chennai. Online test via HackerRank platform. First-time selection is final.',
      c.name + ' walk-in drive for ' + c.role + ' positions. Package: ' + c.pkg + ' LPA. Eligibility: ' + c.elig + '. Students must bring college ID, mark sheets, and printed resume. Assessment includes coding test, technical interview, and HR discussion.',
    ];
    return rnd(opts);
  }

  let placementCount = 0;
  for (let i = 0; i < COMPANIES.length; i++) {
    const c         = COMPANIES[i];
    // First 12 PUBLISHED, last 8 DRAFT
    const status    = i < 12 ? 'PUBLISHED' : 'DRAFT';
    // Mix of future (0–60d) and past (1–30d) drive dates
    const driveDaysOff = i < 10 ? rndInt(5, 60) : -rndInt(1, 30);
    const driveDateObj = driveDaysOff >= 0 ? daysFromNow(driveDaysOff) : daysAgo(Math.abs(driveDaysOff));

    try {
      await prisma.placement.create({
        data: {
          companyName:         c.name,
          jobRole:             c.role,
          packageLpa:          c.pkg,
          eligibility:         c.elig,
          description:         buildPlacementDesc(c),
          registrationLink:    rnd(DRIVE_FORM_LINKS),
          driveDate:           dateStr(driveDateObj),
          status,
          notificationSent:    status === 'PUBLISHED',
          companyArrivedToday: c.arv,
        },
      });
      placementCount++;
    } catch (err) {
      console.warn('   ⚠️  Placement create failed for ' + c.name + ': ' + err.message);
    }
  }
  console.log('   ✅ ' + placementCount + ' placement records created (12 PUBLISHED, 8 DRAFT, 3 arrived today)');

  // ── 10. Announcements (25) ────────────────────
  console.log('\n📢  Creating announcements...');
  let announcementCount = 0;
  for (const a of ANNOUNCEMENTS_DATA) {
    try {
      const hasLink = a.status === 'PUBLISHED' && Math.random() < 0.4;
      await prisma.announcement.create({
        data: {
          title:       a.title,
          description: a.description,
          priority:    a.priority,
          status:      a.status,
          link:        hasLink ? 'https://sitamecap.co.in/notices/' + crypto.randomBytes(4).toString('hex') : null,
        },
      });
      announcementCount++;
    } catch (err) {
      console.warn('   ⚠️  Announcement create failed: ' + err.message);
    }
  }
  console.log('   ✅ ' + announcementCount + ' announcements created (18 PUBLISHED, 7 DRAFT)');

  // ── 11. Fee Notices (15) ──────────────────────
  console.log('\n💳  Creating fee notices...');
  let feeNoticeCount = 0;
  for (const fn of FEE_NOTICES_DATA) {
    try {
      await prisma.feeNotice.create({
        data: {
          title:                  fn.title,
          description:            fn.description,
          dueDate:                fn.dueDate,
          targetBatch:            fn.targetBatch,
          priority:               fn.priority,
          popupEnabled:           fn.popupEnabled,
          notificationEnabled:    true,
          hallTicketBlockWarning: fn.hallTicketBlockWarning,
          isActive:               fn.isActive,
        },
      });
      feeNoticeCount++;
    } catch (err) {
      console.warn('   ⚠️  FeeNotice create failed: ' + err.message);
    }
  }
  console.log('   ✅ ' + feeNoticeCount + ' fee notices created (12 active, 3 inactive, 5 with hall-ticket block warning)');

  // ── 12. Audit Logs (30) ───────────────────────
  console.log('\n📊  Creating audit log entries...');
  let auditCount = 0;
  for (let i = 0; i < AUDIT_ENTRIES.length; i++) {
    const entry     = AUDIT_ENTRIES[i];
    const admin     = rnd(createdAdmins);
    const student   = Math.random() < 0.4 ? rnd(createdStudents) : null;
    const tsOffset  = rndInt(0, 29);
    const timestamp = daysAgo(tsOffset);
    timestamp.setHours(rndInt(8, 22), rndInt(0, 59), rndInt(0, 59));

    try {
      await prisma.auditLog.create({
        data: {
          adminId:   admin.id,
          studentId: student ? student.id : null,
          action:    entry.action,
          details:   entry.detail,
          severity:  entry.severity,
          timestamp,
        },
      });
      auditCount++;
    } catch (err) {
      console.warn('   ⚠️  AuditLog create failed: ' + err.message);
    }
  }
  console.log('   ✅ ' + auditCount + ' audit log entries created (spread over last 30 days)');

  // ── Final Summary ──────────────────────────────
  console.log('\n══════════════════════════════════════════════════');
  console.log('✅  SITAM Smart ERP Demo Data Seeding Complete!');
  console.log('══════════════════════════════════════════════════');
  console.log('   Students:       ' + createdStudents.length);
  console.log('   Subjects:       ' + subjectList.length);
  console.log('   Fee Records:    ' + feeCount);
  console.log('   Attendance:     ' + attCount);
  console.log('   Marks:          ' + markCount);
  console.log('   Notifications:  ' + notifCount);
  console.log('   Exit Passes:    ' + epCount);
  console.log('   Placements:     ' + placementCount);
  console.log('   Announcements:  ' + announcementCount);
  console.log('   Fee Notices:    ' + feeNoticeCount);
  console.log('   Audit Logs:     ' + auditCount);
  console.log('──────────────────────────────────────────────────');
  console.log('   Admin credentials:');
  for (const a of adminDefs) {
    console.log('     📧 ' + a.email + '  [' + a.role + ']  password: Admin@1234');
  }
  console.log('   Student login:  <rollnumber>@sitamecap.co.in  password: Student@123');
  console.log('══════════════════════════════════════════════════\n');
}

main()
  .catch(err => {
    console.error('\n[Seed] ❌ Fatal error:', err.message);
    if (process.env.NODE_ENV !== 'production') console.error(err.stack);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
