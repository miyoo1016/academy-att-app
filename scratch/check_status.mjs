import admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({
    projectId: 'attmirae'
  });
}

const db = admin.firestore();

async function checkPending() {
  const snapshot = await db.collection('attendance')
    .where('processed', '==', false)
    .orderBy('time', 'desc')
    .limit(10)
    .get();

  console.log(`Found ${snapshot.size} pending attendance records.`);
  snapshot.forEach(doc => {
    const data = doc.data();
    console.log(`- ID: ${doc.id}, Name: ${data.studentName}, Time: ${data.time}, CreatedAt: ${data.createdAt?.toDate?.() || data.createdAt}`);
  });

  const tokenDoc = await db.doc('device_tokens/main_phone').get();
  if (tokenDoc.exists) {
    console.log(`Main phone token: ${tokenDoc.data().token.substring(0, 10)}...`);
    console.log(`Last updated: ${tokenDoc.data().updatedAt?.toDate?.()}`);
  } else {
    console.log('Main phone token NOT FOUND!');
  }
}

checkPending().catch(console.error);
