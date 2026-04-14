import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc } from "firebase/firestore";
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load .env.local file
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Check if config exists
if (!firebaseConfig.projectId) {
  console.error("Error: Missing Firebase configuration in .env.local");
  process.exit(1);
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const restaurants = [
  {
    id: "g-001",
    name: "Grills Capitol",
    slug: "grills-capitol",
    logo: "https://images.unsplash.com/photo-1594212699903-ec8a3eca50f5?w=500&auto=format",
    coverImage: "https://images.unsplash.com/photo-1544025162-d76694265947?w=1600&auto=format",
    phone: "123-456-7890",
    address: "123 Grill Drive, City center",
    description: "The best grills in town. Specializing in steak, chicken, and prime ribs.",
    createdAt: new Date().toISOString()
  },
  {
    id: "d-002",
    name: "Demo Restaurant",
    slug: "demo-restaurant",
    logo: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=500&auto=format",
    coverImage: "https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=1600&auto=format",
    phone: "098-765-4321",
    address: "999 Demo Street",
    description: "A demo restaurant for testing purpose. Try our placeholder food!",
    createdAt: new Date().toISOString()
  }
];

const menuItems = [
  // Grills Capitol Items
  {
    id: "m-gc-1",
    restaurantId: "grills-capitol",
    name: "Classic Prime Rib",
    description: "Slow-roasted prime rib served with au jus and creamy horseradish.",
    price: 35.99,
    image: "https://images.unsplash.com/photo-1600891964599-f61ba0e24092?w=800&auto=format",
    category: "Mains",
    available: true
  },
  {
    id: "m-gc-2",
    restaurantId: "grills-capitol",
    name: "BBQ Smoked Chicken",
    description: "Half chicken smoked hickory style with our signature BBQ sauce.",
    price: 24.50,
    image: "https://images.unsplash.com/photo-1598515214211-89d3c73ae83b?w=800&auto=format",
    category: "Mains",
    available: true
  },
  {
    id: "m-gc-3",
    restaurantId: "grills-capitol",
    name: "Grilled Asparagus",
    description: "Fresh asparagus spears grilled with olive oil and parmesan.",
    price: 8.99,
    image: "https://images.unsplash.com/photo-1608039829572-78524f79c4c7?w=800&auto=format",
    category: "Sides",
    available: true
  },
  {
    id: "m-gc-4",
    restaurantId: "grills-capitol",
    name: "Loaded Baked Potato",
    description: "Idaho potato with butter, sour cream, bacon crust, and cheddar.",
    price: 6.50,
    image: "https://images.unsplash.com/photo-1541544741938-0af808871cc0?w=800&auto=format",
    category: "Sides",
    available: true
  },
  {
    id: "m-gc-5",
    restaurantId: "grills-capitol",
    name: "Capitol Signature Mac & Cheese",
    description: "Five-cheese blend baked perfectly with a crispy Panko topping.",
    price: 12.00,
    image: "https://images.unsplash.com/photo-1543339308-43e59d6b73a6?w=800&auto=format",
    category: "Sides",
    available: true
  },
  {
    id: "m-gc-6",
    restaurantId: "grills-capitol",
    name: "New York Cheesecake",
    description: "Classic vanilla bean cheesecake with strawberry compote.",
    price: 9.00,
    image: "https://images.unsplash.com/photo-1533134242443-d4fd215305ad?w=800&auto=format",
    category: "Desserts",
    available: true
  },
  // Demo Restaurant Items
  {
    id: "m-dr-1",
    restaurantId: "demo-restaurant",
    name: "Demo Burger",
    description: "A placeholder burger for testing.",
    price: 10.99,
    image: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800&auto=format",
    category: "Mains",
    available: true
  },
  {
    id: "m-dr-2",
    restaurantId: "demo-restaurant",
    name: "Demo Fries",
    description: "A placeholder basket of fries.",
    price: 4.99,
    image: "https://images.unsplash.com/photo-1573037153445-5626cc96760e?w=800&auto=format",
    category: "Sides",
    available: true
  }
];

async function seed() {
  console.log("Starting seed process...");
  try {
    for (const restaurant of restaurants) {
      console.log(`Adding Restaurant: ${restaurant.name}...`);
      await setDoc(doc(db, "restaurants", restaurant.slug), restaurant);
    }
    
    console.log("Adding Menu Items...");
    for (const item of menuItems) {
      console.log(`Adding Item: ${item.name}...`);
      // Use the explicitly defined ID for menu items
      await setDoc(doc(db, "menu_items", item.id), item);
    }
    
    console.log("Seeding complete! Added 2 restaurants and 8 menu items.");
    process.exit(0);
  } catch (error) {
    console.error("Error seeding data:", error);
    process.exit(1);
  }
}

seed();
