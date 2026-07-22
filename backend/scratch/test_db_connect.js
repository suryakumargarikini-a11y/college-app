const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
    datasources: {
        db: {
            url: "postgresql://college_app_q7aa_user:KQyi0y3YrJKvrgiBJEpzRZkQUJFpiPB0@dpg-d92biglckfvc73dgp7og-a.oregon-postgres.render.com/college_app_q7aa?sslmode=require"
        }
    }
});

async function main() {
    console.log('Connecting and starting timing test...');
    try {
        // Run a warm-up query outside transaction to establish connection pool
        console.log('--- WARM UP QUERY ---');
        const t0 = performance.now();
        await prisma.$queryRaw`SELECT 1`;
        console.log(`Warm-up query took ${(performance.now() - t0).toFixed(2)}ms`);

        console.log('\n--- TRANSACTION TIMING ---');
        const tStart = performance.now();
        const result = await prisma.$transaction(async (tx) => {
            const tAcquired = performance.now();
            console.log(`Transaction acquired in ${(tAcquired - tStart).toFixed(2)}ms`);

            // 1. findUnique query simulation (read a record)
            const tFindStart = performance.now();
            const pass = await tx.exitPass.findFirst({
                include: { student: true }
            });
            const tFindEnd = performance.now();
            console.log(`findFirst (findUnique equivalent) took ${(tFindEnd - tFindStart).toFixed(2)}ms`);

            if (!pass) {
                console.log('No exit pass found in DB.');
                return;
            }

            // 2. update query simulation (write status)
            const tUpdateStart = performance.now();
            const updated = await tx.exitPass.update({
                where: { id: pass.id },
                data: { remarks: pass.remarks } // no-op update to verify timing
            });
            const tUpdateEnd = performance.now();
            console.log(`update took ${(tUpdateEnd - tUpdateStart).toFixed(2)}ms`);

            // 3. create query simulation (write audit log)
            const tCreateStart = performance.now();
            const log = await tx.auditLog.create({
                data: {
                    action: 'TEST_TIMING',
                    details: 'Test timing run',
                    severity: 'INFO',
                    timestamp: new Date()
                }
            });
            const tCreateEnd = performance.now();
            console.log(`auditLog.create took ${(tCreateEnd - tCreateStart).toFixed(2)}ms`);

            // Cleanup created log so we don't pollute
            await tx.auditLog.delete({ where: { id: log.id } });

            return pass;
        });

        const tEnd = performance.now();
        console.log(`Transaction committed in ${(tEnd - tStart).toFixed(2)}ms total`);

    } catch (err) {
        console.error('Test run failed:', err);
    } finally {
        await prisma.$disconnect();
    }
}

main();
