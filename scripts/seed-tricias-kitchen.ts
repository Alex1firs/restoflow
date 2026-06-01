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
    restaurantId: "tricias-kitchen"
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
    restaurantId: "tricias-kitchen"
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
    restaurantId: "tricias-kitchen"
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
    restaurantId: "tricias-kitchen"
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
    restaurantId: "tricias-kitchen"
  },
  {
    name: "WHITE RICE + TOMATO SAUCE",
    description: "Fluffy steamed white rice with a classic rich red tomato sauce poured over it and garnished with fresh parsley.",
    price: 8000,
    indoorPrice: 7000,
    image: "/images/rice_tomato_sauce.png",
    category: "Rice",
    available: true,
    itemType: "item",
    basePrice: 8000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "WHITE RICE + VEGETABLE SAUCE",
    description: "Fluffy steamed white rice served with a colorful mixed vegetable sauce (carrots, green peas, sweet corn, green beans).",
    price: 8000,
    indoorPrice: 7000,
    image: "/images/rice_vegetable_sauce.png",
    category: "Rice",
    available: true,
    itemType: "item",
    basePrice: 8000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "WHITE RICE + VEGETABLE STEW",
    description: "Fluffy steamed white rice accompanied by a rich Nigerian vegetable stew with spinach, red bell peppers, onions, and beef chunks.",
    price: 8000,
    indoorPrice: 7000,
    image: "/images/rice_vegetable_stew.png",
    category: "Rice",
    available: true,
    itemType: "item",
    basePrice: 8000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "NSALA SOUP",
    description: "Steaming hot Nigerian Nsala Soup (White Soup) garnished with fresh utazi leaves, containing chicken chunks, fish, and yam cubes.",
    price: 9000,
    indoorPrice: 7000,
    image: "/images/nsala_soup.png",
    category: "Soup",
    available: true,
    itemType: "item",
    basePrice: 9000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "BAKED POTATOES WITH FISH FINGER",
    description: "Golden crispy baked potatoes alongside golden-brown crispy fish fingers (fish sticks), served with tartar sauce dip.",
    price: 8000,
    indoorPrice: 7714.29,
    image: "/images/baked_potatoes_fish_fingers.png",
    category: "Fries",
    available: true,
    itemType: "item",
    basePrice: 8000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "CHINESE FRIED RICE + SHREDDED C",
    description: "Chinese fried rice mixed with finely shredded tender chicken pieces, green peas, diced carrots, and spring onions.",
    price: 9000,
    indoorPrice: 8000,
    image: "/images/chinese_fried_rice.png",
    category: "Rice",
    available: true,
    itemType: "item",
    basePrice: 9000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "SINGAPORE NOODLES + SHRIMPS",
    description: "Singapore thin rice vermicelli curry noodles with juicy pan-seared shrimps, shredded vegetables, and scrambled egg ribbons.",
    price: 10000,
    indoorPrice: 9000,
    image: "/images/singapore_noodles.png",
    category: "Pasta",
    available: true,
    itemType: "item",
    basePrice: 10000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "VEGETABLE SALAD + CHICKEN",
    description: "Fresh vegetable garden salad topped with sliced juicy grilled chicken breast, cucumbers, cherry tomatoes, and ranch dressing.",
    price: 10000,
    indoorPrice: 9000,
    image: "/images/vegetable_salad_chicken.png",
    category: "Salad",
    available: true,
    itemType: "item",
    basePrice: 10000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "PEPPERED SNAIL",
    description: "Spicy peppered snails roasted and coated in a rich, sizzling red pepper and onion sauce, garnished with green onions.",
    price: 15000,
    indoorPrice: 12000,
    image: "/images/peppered_snail.png",
    category: "Protein",
    available: true,
    itemType: "item",
    basePrice: 15000,
    kitchenStation: "grill",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "FISHERMAN SOUP",
    description: "Nigerian Fisherman Soup, rich and red with fresh seafood (shrimps, crabs, fish chunks, calamari), steaming hot.",
    price: 15000,
    indoorPrice: 14000,
    image: "/images/fisherman_soup.png",
    category: "Soup",
    available: true,
    itemType: "item",
    basePrice: 15000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "SEA FOOD OKRO",
    description: "Premium seafood okro (okra) soup filled with fresh large prawns, crabs, fish chunks, and calamari.",
    price: 15000,
    indoorPrice: 14000,
    image: "/images/sea_food_okro.png",
    category: "Soup",
    available: true,
    itemType: "item",
    basePrice: 15000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "RED WINE",
    description: "Premium bottle of deep red wine with rich ruby reflections, perfect for pairing.",
    price: 35000,
    indoorPrice: 30000,
    image: "/images/red_wine.png",
    category: "Drinks",
    available: true,
    itemType: "item",
    basePrice: 35000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  }
];

async function seed() {
  console.log("Starting seeding process for tricias-kitchen...");
  try {
    // 1. Ensure the restaurant document exists
    const restRef = db.collection("restaurants").doc("tricias-kitchen");
    const restDoc = await restRef.get();
    if (!restDoc.exists) {
      console.log("Restaurant tricias-kitchen does not exist. Creating it...");
      await restRef.set({
        name: "Tricia's Kitchen",
        slug: "tricias-kitchen",
        createdAt: new Date().toISOString()
      }, { merge: true });
      console.log("✓ Created restaurant document tricias-kitchen");
    }

    // 2. Clear existing prepared_items for tricias-kitchen
    const colRef = db.collection("prepared_items");
    const snapshot = await colRef.where("restaurantId", "==", "tricias-kitchen").get();
    if (!snapshot.empty) {
      console.log(`Found ${snapshot.size} existing items for tricias-kitchen. Deleting...`);
      const batch = db.batch();
      snapshot.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      console.log("✓ Cleared old prepared_items for tricias-kitchen");
    }

    // 3. Insert all 17 items
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
