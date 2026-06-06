const prisma = require('./services/dbService');

async function test() {
    console.log('=== Database Verification Test ===');
    
    try {
        // Clean up previous test if any
        await prisma.student.deleteMany({ where: { userId: 'TEST-123' } });
        await prisma.subject.deleteMany({ where: { code: 'TEST-CS' } });

        console.log('1. Creating a mock student...');
        const student = await prisma.student.create({
            data: {
                userId: 'TEST-123',
                password: 'password123',
                name: 'Julian Sterling',
                roll: 'TEST-123',
                program: 'B.Tech',
                branch: 'CSE',
                semester: 'II Semester',
                year: 'Year 1',
                gender: 'Male',
                dob: '2005-01-01',
                email: 'julian@test.com',
                phone: '1234567890',
                fatherName: 'Father',
                motherName: 'Mother',
                fatherMobile: '0987654321',
                hostel: 'A-Hostel',
                roomNo: '101',
                cgpa: '8.5',
                percentage: '80%',
                address: '123 Test St, Tech City'
            }
        });
        console.log('✅ Student created successfully:', student.name, `(ID: ${student.id})`);

        console.log('2. Creating a subject...');
        const subject = await prisma.subject.create({
            data: {
                code: 'TEST-CS',
                name: 'Test Computer Science',
                credits: '4.0',
                semester: 'II Semester'
            }
        });
        console.log('✅ Subject created successfully:', subject.name, `(ID: ${subject.id})`);

        console.log('3. Linking subject & student via MarkRecord...');
        const mark = await prisma.markRecord.create({
            data: {
                studentId: student.id,
                subjectId: subject.id,
                grade: 'A+',
                credits: '4.0',
                type: 'Core',
                status: 'Pass'
            }
        });
        console.log('✅ Mark record created successfully:', mark.grade);

        console.log('4. Querying relations...');
        const query = await prisma.student.findUnique({
            where: { id: student.id },
            include: {
                marks: {
                    include: {
                        subject: true
                    }
                }
            }
        });

        console.log('✅ Query relation results:');
        console.log(`- Student: ${query.name}`);
        console.log(`- Marks count: ${query.marks.length}`);
        if (query.marks.length > 0) {
            console.log(`  - Subject: ${query.marks[0].subject.name} | Grade: ${query.marks[0].grade}`);
        }

        console.log('5. Deleting test data...');
        await prisma.student.delete({ where: { id: student.id } });
        await prisma.subject.delete({ where: { id: subject.id } });
        console.log('✅ Test data cleaned up successfully!');
        
        console.log('\nDATABASE VERIFICATION PASSED SUCCESSFULLY! 🎉');

    } catch (error) {
        console.error('❌ Database verification FAILED:', error);
    } finally {
        await prisma.$disconnect();
    }
}

test();
