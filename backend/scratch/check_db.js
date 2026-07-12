const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const student = await prisma.student.findFirst();
    if (!student) {
        console.log('No student record found!');
    } else {
        console.log('--- STUDENT CORE FIELDS ---');
        console.log({
            userId: student.userId,
            name: student.name,
            dob: student.dob,
            email: student.email,
            phone: student.phone,
            fatherName: student.fatherName,
            motherName: student.motherName,
            fatherMobile: student.fatherMobile,
            hostel: student.hostel,
            roomNo: student.roomNo,
            address: student.address,
            bloodGroup: student.bloodGroup,
            emergencyContact: student.emergencyContact
        });
    }
    await prisma.$disconnect();
}

main().catch(console.error);
