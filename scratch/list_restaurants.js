const admin = require('firebase-admin');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env.local') });

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, '\n'),
  })
});

const db = admin.firestore();
db.collection('restaurants').get().then(snap => {
  snap.forEach(doc => console.log(doc.id, doc.data().name));
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
