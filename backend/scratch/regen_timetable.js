// Re-generate timetable with Saturday and realistic Telugu faculty names for all students
const { PrismaClient } = require('@prisma/client');
const { timetableRepository } = require('../repositories');

const p = new PrismaClient();

const subjectNameMap = {
    'LAC': 'Linear Algebra & Calculus',
    'EP': 'Engineering Physics',
    'CE': 'Computer Engineering',
    'BCME': 'Basic Civil & Mech. Engg.',
    'IP': 'Introduction to Programming',
    'CE LAB': 'Computer Engg. Lab',
    'EP LAB': 'Engineering Physics Lab',
    'EW LAB': 'Engineering Workshop Lab',
    'IT LAB': 'IT Workshop Lab',
    'IP LAB': 'Programming Lab',
    'HWYS': 'Human Values & Yoga',
    'ENG': 'English Communication',
    'MATH': 'Mathematics',
    'PHY': 'Engineering Physics',
    'CHEM': 'Engineering Chemistry',
    'DS': 'Data Structures',
    'OS': 'Operating Systems',
    'DBMS': 'Database Management',
    'CN': 'Computer Networks',
    'SE': 'Software Engineering',
    'AI': 'Artificial Intelligence',
    'ML': 'Machine Learning',
    'WEB': 'Web Technologies',
};

const getRoomForSubject = (code) => {
    const upper = (code || '').toUpperCase();
    if (upper.includes('LAB')) return 'Lab Block';
    if (upper.includes('MATH') || upper.includes('LAC') || upper.includes('EP')) return 'Room 201';
    if (upper.includes('CE') || upper.includes('IP') || upper.includes('DS')) return 'Room 305';
    return 'Room 102';
};

const subjectFacultyMap = {
    'LAC': 'Dr. Ch. Venkata Ramana',
    'EP': 'Dr. K. Prasada Rao',
    'CE': 'Mr. B. Satish Kumar',
    'BCME': 'Mr. G. Srinivasa Rao',
    'IP': 'Mrs. T. Durga Devi',
    'CE LAB': 'Mr. B. Satish Kumar',
    'EP LAB': 'Dr. K. Prasada Rao',
    'EW LAB': 'Mr. D. Jagadeesh',
    'IT LAB': 'Mrs. K. Lakshmi',
    'IP LAB': 'Mrs. T. Durga Devi',
    'HWYS': 'Prof. K. Srilatha',
    'ENG': 'Prof. V. Sandhya',
    'MATH': 'Dr. Ch. Venkata Ramana',
    'PHY': 'Dr. K. Prasada Rao',
    'CHEM': 'Dr. S. Rambabu',
    'DS': 'Mr. P. Rama Krishna',
    'OS': 'Mr. B. Satish Kumar',
    'DBMS': 'Mrs. K. Lakshmi',
    'CN': 'Mr. G. Srinivasa Rao',
    'SE': 'Prof. K. Srilatha',
    'AI': 'Dr. M. Venugopal',
    'ML': 'Dr. M. Venugopal',
    'WEB': 'Mrs. T. Durga Devi'
};

const fallbackFaculties = [
    'Dr. Ch. Venkata Ramana', 'Prof. K. Srilatha', 'Mr. B. Satish Kumar',
    'Mrs. T. Durga Devi', 'Dr. K. Prasada Rao'
];

async function main() {
    const students = await p.student.findMany({
        include: { marks: { include: { subject: true } } }
    });
    console.log(`Found ${students.length} students to update.`);

    for (const student of students) {
        // Get active subjects from marks
        let activeSubjects = student.marks.map(m => m.subject.code);
        if (activeSubjects.length === 0) {
            activeSubjects = ['LAC', 'EP', 'CE', 'BCME', 'IP'];
        }
        console.log(`Student ${student.userId} (${student.name}) active subjects:`, activeSubjects);

        const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const periods = [
            { id: 1, time: '09:00 AM' },
            { id: 2, time: '10:00 AM' },
            { id: 3, time: '11:15 AM' },
            { id: 4, time: '02:00 PM' },
        ];

        const timetableSlots = [];
        let subjIndex = 0;
        days.forEach(day => {
            periods.forEach(period => {
                const subjectCode = activeSubjects[subjIndex % activeSubjects.length];
                const subjectName = subjectNameMap[subjectCode.toUpperCase()] || subjectCode;
                const facultyName = subjectFacultyMap[subjectCode.toUpperCase()] || fallbackFaculties[subjIndex % fallbackFaculties.length];
                timetableSlots.push({
                    day, period: period.id,
                    room: getRoomForSubject(subjectCode),
                    section: student.section || 'A',
                    facultyName,
                    time: period.time,
                    subjectCode, subjectName
                });
                subjIndex++;
            });
        });

        await timetableRepository.saveTimetable(student.id, timetableSlots);
        console.log(`✅ Timetable regenerated for ${student.userId} with ${timetableSlots.length} slots (including Saturday)`);
    }
}

main().catch(console.error).finally(() => p.$disconnect());
