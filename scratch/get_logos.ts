import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const app = initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  })
});

const db = getFirestore(app);

async function run() {
  const snapshot = await db.collection('restaurants').get();
  snapshot.forEach(doc => {
    console.log(`ID: ${doc.id}`);
    console.log(`Name: ${doc.data().name || doc.data().restaurantName}`);
    console.log(`Logo: ${doc.data().logo || doc.data().logoUrl || doc.data().image}`);
    console.log('---');
  });
}

run().catch(console.error);
