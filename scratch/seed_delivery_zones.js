const admin = require('firebase-admin');
const dotenv = require('dotenv');
const path = require('path');
const { randomUUID } = require('crypto');

dotenv.config({ path: path.join(__dirname, '../.env.local') });

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, '\n'),
  })
});

const db = admin.firestore();

const zonesData = [
  // ₦1,000 LOCATIONS
  { name: "Casia Estate", fee: 1000 },
  { name: "Catholic Church", fee: 1000 },
  { name: "School Gate Bus Stop", fee: 1000 },
  { name: "Iya-Ibeji", fee: 1000 },
  { name: "Shepherd Way", fee: 1000 },
  { name: "Suppliers Street", fee: 1000 },
  { name: "Awoyaya Bus Stop", fee: 1000 },
  { name: "Meridian Park Estate Gate", fee: 1000 },

  // ₦1,500 LOCATIONS
  { name: "Meridian (Inside)", fee: 1500 },
  { name: "Meridian Park Estate (Inside)", fee: 1500 },
  { name: "Balogun", fee: 1500 },
  { name: "Mama T", fee: 1500 },
  { name: "Yellow House", fee: 1500 },
  { name: "Awoyaya (Inside)", fee: 1500 },
  { name: "Alaji Ibrahim", fee: 1500 },
  { name: "Parapo (After Catholic Church)", fee: 1500 },

  // ₦2,000 LOCATIONS
  { name: "Cele 2", fee: 2000 },
  { name: "Kajola Phase 2", fee: 2000 },
  { name: "Gionee Estate", fee: 2000 },
  { name: "GRA", fee: 2000 },
  { name: "Rousin Court", fee: 2000 },
  { name: "School Gate (Inside)", fee: 2000 },
  { name: "Alaji Ario", fee: 2000 },
  { name: "Blessed Seed", fee: 2000 },
  { name: "Mopo Gate", fee: 2000 },
  { name: "New Mosque", fee: 2000 },
  { name: "Mutual Garden", fee: 2000 },
  { name: "Eputu Axis", fee: 2000 },
  { name: "Ogunfayo (Inside)", fee: 2000 },
  { name: "Adawa Street", fee: 2000 },
  { name: "Golf Gate", fee: 2000 },

  // ₦2,500 LOCATIONS
  { name: "Celemedu", fee: 2500 },
  { name: "Peak Park Estate", fee: 2500 },
  { name: "Shalom Estate", fee: 2500 },
  { name: "Shoprite", fee: 2500 },
  { name: "Elesekan", fee: 2500 },
  { name: "Bogije Area", fee: 2500 },
  { name: "OlowoPopo", fee: 2500 },
  { name: "Mountain of Fire", fee: 2500 },
  { name: "Paradise Estate", fee: 2500 },
  { name: "Oribanwa Peak Park", fee: 2500 },
  { name: "Ologunfe (Inside)", fee: 2500 },

  // ₦3,500 LOCATIONS
  { name: "Baba-Adisa", fee: 3500 },
  { name: "Ocean Garden", fee: 3500 },

  // ₦4,000 LOCATIONS
  { name: "Golf (Inside)", fee: 4000 },
  { name: "Abraham Adesanya", fee: 4000 },

  // ₦5,000 LOCATIONS
  { name: "Lekki", fee: 5000 },
  { name: "Chevy View", fee: 5000 }
];

const formattedZones = zonesData.map(z => ({
  id: randomUUID(),
  name: z.name,
  fee: z.fee
}));

async function seed() {
  const docRef = db.collection('restaurants').doc('food-kapitol');
  const snap = await docRef.get();
  
  if (!snap.exists) {
    console.error("Restaurant food-kapitol does not exist");
    process.exit(1);
  }
  
  console.log("Found restaurant:", snap.data().name);
  console.log(`Setting ${formattedZones.length} delivery zones...`);
  
  await docRef.update({
    deliveryZones: formattedZones
  });
  
  console.log("Seeding complete!");
  process.exit(0);
}

seed().catch(err => {
  console.error("Error seeding data:", err);
  process.exit(1);
});
