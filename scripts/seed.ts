/**
 * Seeds prepared menu items using the Firebase Admin SDK.
 * Bypasses Firestore client-side security rules to avoid PERMISSION_DENIED.
 * Uses the correct "prepared_items" collection expected by the POS.
 */

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

const menuItems = [
  // Grills Capitol Items (restaurantId: "grills-capitol")
  {
    name: "Classic Prime Rib",
    description: "Slow-roasted prime rib served with au jus and creamy horseradish.",
    price: 15000,
    indoorPrice: 17000,
    image: "https://images.unsplash.com/photo-1600891964599-f61ba0e24092?w=800&auto=format",
    category: "Mains",
    available: true,
    itemType: "item",
    basePrice: 15000,
    kitchenStation: "grill",
    allowCustomPrice: false,
    restaurantId: "grills-capitol",
    sizes: [
      { name: "Regular", price: 0 },
      { name: "Jumbo", price: 5000 }
    ],
    modifierGroups: [
      {
        groupName: "Doneness",
        selectionType: "single",
        required: true,
        options: [
          { name: "Rare", price: 0 },
          { name: "Medium Rare", price: 0 },
          { name: "Medium", price: 0 },
          { name: "Well Done", price: 0 }
        ]
      }
    ]
  },
  {
    name: "BBQ Smoked Chicken",
    description: "Half chicken smoked hickory style with our signature BBQ sauce.",
    price: 8500,
    indoorPrice: 9500,
    image: "https://images.unsplash.com/photo-1598515214211-89d3c73ae83b?w=800&auto=format",
    category: "Mains",
    available: true,
    itemType: "item",
    basePrice: 8500,
    kitchenStation: "grill",
    allowCustomPrice: false,
    restaurantId: "grills-capitol"
  },
  {
    name: "Grilled Asparagus",
    description: "Fresh asparagus spears grilled with olive oil and parmesan.",
    price: 3200,
    indoorPrice: 3200,
    image: "https://images.unsplash.com/photo-1608039829572-78524f79c4c7?w=800&auto=format",
    category: "Sides",
    available: true,
    itemType: "item",
    basePrice: 3200,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "grills-capitol"
  },
  {
    name: "Loaded Baked Potato",
    description: "Idaho potato with butter, sour cream, bacon crust, and cheddar.",
    price: 2500,
    indoorPrice: 2500,
    image: "https://images.unsplash.com/photo-1541544741938-0af808871cc0?w=800&auto=format",
    category: "Sides",
    available: true,
    itemType: "item",
    basePrice: 2500,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "grills-capitol"
  },
  {
    name: "Capitol Signature Mac & Cheese",
    description: "Five-cheese blend baked perfectly with a crispy Panko topping.",
    price: 4500,
    indoorPrice: 4800,
    image: "https://images.unsplash.com/photo-1543339308-43e59d6b73a6?w=800&auto=format",
    category: "Sides",
    available: true,
    itemType: "item",
    basePrice: 4500,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "grills-capitol"
  },
  {
    name: "New York Cheesecake",
    description: "Classic vanilla bean cheesecake with strawberry compote.",
    price: 3500,
    indoorPrice: 3500,
    image: "https://images.unsplash.com/photo-1533134242443-d4fd215305ad?w=800&auto=format",
    category: "Desserts",
    available: true,
    itemType: "item",
    basePrice: 3500,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "grills-capitol"
  }
];

async function seed() {
  console.log("Starting Firebase Admin seed process...");
  try {
    const colRef = db.collection("prepared_items");

    // Add each menu item to the prepared_items collection
    for (const item of menuItems) {
      console.log(`Adding prepared item: ${item.name} to ${item.restaurantId}...`);
      
      // Generate a deterministic or random document ID
      const docRef = colRef.doc();
      await docRef.set({
        ...item,
        createdAt: new Date().toISOString()
      });
    }

    console.log(`✓ Seeding complete! Successfully added ${menuItems.length} prepared menu items to Firestore.`);
    process.exit(0);
  } catch (error: any) {
    console.error("Error seeding data:", error.message);
    process.exit(1);
  }
}

seed();
