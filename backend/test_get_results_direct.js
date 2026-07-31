const dataProvider = require('./adapters/dataProvider');

async function run() {
    console.log('Testing dataProvider.getMarks("23B61A0449")...');
    const res = await dataProvider.getMarks('23B61A0449');
    console.log('Returned semesters count:', res?.semesters?.length);
    console.log('Complete Response:\n', JSON.stringify(res, null, 2));
}

run().catch(console.error);
