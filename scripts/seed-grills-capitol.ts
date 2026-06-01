import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const app = initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  }),
});

const db = getFirestore(app);

const newItems = [
  {
    name: "FRIED YAM + PEPPER GOAT MEAT",
    description: "Nigerian fried yam chunks and tender peppered goat meat, garnished with fresh herbs and red chili peppers.",
    price: 8000,
    indoorPrice: 7000,
    image: "/images/fried_yam_goat_meat.png",
    category: "Fries",
    available: true,
    itemType: "item",
    basePrice: 8000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "grills-capitol"
  },
  {
    name: "GRILL TURKEY",
    description: "Grilled turkey steaks with crispy brown skin, grill marks, served with fresh herbs.",
    price: 8000,
    indoorPrice: 7000,
    image: "/images/grill_turkey.png",
    category: "Protein",
    available: true,
    itemType: "item",
    basePrice: 8000,
    kitchenStation: "grill",
    allowCustomPrice: false,
    restaurantId: "grills-capitol"
  },
  {
    name: "pasta salad",
    description: "Colorful pasta salad with fusilli, cherry tomatoes, black olives, bell peppers, fresh mozzarella pearls, and basil.",
    price: 8000,
    indoorPrice: 7000,
    image: "/images/pasta_salad.png",
    category: "Salad",
    available: true,
    itemType: "item",
    basePrice: 8000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "grills-capitol"
  },
  {
    name: "PEPPERED TURKEY",
    description: "Deep-fried peppered turkey chunks coated in a rich, spicy red pepper sauce and garnished with onion rings.",
    price: 8000,
    indoorPrice: 7000,
    image: "/images/peppered_turkey.png",
    category: "Protein",
    available: true,
    itemType: "item",
    basePrice: 8000,
    kitchenStation: "grill",
    allowCustomPrice: false,
    restaurantId: "grills-capitol"
  },
  {
    name: "WHITE RICE + CHICKENCURRY SAU...",
    description: "Fluffy steamed white rice served with a rich, aromatic chicken curry sauce containing chicken chunks, carrots, and potatoes.",
    price: 8000,
    indoorPrice: 7000,
    image: "/images/rice_chicken_curry.png",
    category: "Rice",
    available: true,
    itemType: "item",
    basePrice: 8000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "grills-capitol"
  }
];

async function seed() {
  console.log("Starting seeding process for grills-capitol...");
  try {
    const colRef = db.collection("prepared_items");

    for (const item of newItems) {
      console.log(`Adding prepared item: ${item.name}...`);
      const docRef = colRef.doc();
      await docRef.set({
        ...item,
        createdAt: new Date().toISOString()
      });
    }

    console.log(`✓ Seeding complete! Successfully added ${newItems.length} menu items to Firestore.`);
    process.exit(0);
  } catch (error: any) {
    console.error("Error seeding data:", error.message);
    process.exit(1);
  }
}

seed();
