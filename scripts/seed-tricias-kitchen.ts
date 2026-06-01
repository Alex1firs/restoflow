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
  // List 1 Items (1 to 17)
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
  },

  // List 2 Items
  {
    name: "creamy macaroni salad",
    description: "Creamy macaroni salad with veggies and a rich signature dressing.",
    price: 7000,
    indoorPrice: 6000,
    image: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=800&auto=format",
    category: "Salad",
    available: true,
    itemType: "item",
    basePrice: 7000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "CROACKER FISH ONLY",
    description: "Perfectly seasoned and fried or grilled Croaker fish, rich in flavor.",
    price: 6000,
    indoorPrice: 6000,
    image: "https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=800&auto=format",
    category: "Protein",
    available: true,
    itemType: "item",
    basePrice: 6000,
    kitchenStation: "grill",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "EDIKANIKONG SOUP",
    description: "Traditional Nigerian Edikang Ikong soup loaded with fresh pumpkin leaves, waterleaves, and premium meats.",
    price: 7000,
    indoorPrice: 6000,
    image: "https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=800&auto=format",
    category: "Soup",
    available: true,
    itemType: "item",
    basePrice: 7000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "EFORIRO SOUP",
    description: "Rich and savory Nigerian Efo Riro (stewed spinach soup) cooked with red bell peppers, locust beans, and assorted meats.",
    price: 7000,
    indoorPrice: 6000,
    image: "https://images.unsplash.com/photo-1604382354936-07c5d9983bd3?w=800&auto=format",
    category: "Soup",
    available: true,
    itemType: "item",
    basePrice: 7000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "FRESH FISH",
    description: "Freshly cooked fish steak in a light seasoned broth or grilled.",
    price: 6000,
    indoorPrice: 6000,
    image: "https://images.unsplash.com/photo-1498654896293-37aacf113fd9?w=800&auto=format",
    category: "Protein",
    available: true,
    itemType: "item",
    basePrice: 6000,
    kitchenStation: "grill",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "GOAT MEAT PEPPER SOUP",
    description: "Highly aromatic and spicy Nigerian goat meat pepper soup, served piping hot.",
    price: 6000,
    indoorPrice: 6000,
    image: "https://images.unsplash.com/photo-1547592180-85f173990554?w=800&auto=format",
    category: "Soup",
    available: true,
    itemType: "item",
    basePrice: 6000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "GOAT MEAT PEPPER SOUP + AGIDI",
    description: "Steaming hot goat meat pepper soup accompanied by traditional smooth Agidi (cornstarch paste).",
    price: 7000,
    indoorPrice: 6000,
    image: "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800&auto=format",
    category: "Soup",
    available: true,
    itemType: "item",
    basePrice: 7000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "ONUGBU SOUP",
    description: "Authentic Nigerian Bitterleaf soup (Ofe Onugbu) cooked with cocoyam paste, palm oil, and premium assorted meats.",
    price: 7000,
    indoorPrice: 6000,
    image: "https://images.unsplash.com/photo-1543339308-43e59d6b73a6?w=800&auto=format",
    category: "Soup",
    available: true,
    itemType: "item",
    basePrice: 7000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "POTATO CHIPS + SAUCE",
    description: "Crispy golden potato chips served with a rich, seasoned tomato and pepper dipping sauce.",
    price: 6000,
    indoorPrice: 6000,
    image: "https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=800&auto=format",
    category: "Fries",
    available: true,
    itemType: "item",
    basePrice: 6000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "Potato salad",
    description: "Classic creamy potato salad with boiled potatoes, hard-boiled eggs, mayonnaise, and fresh herbs.",
    price: 7000,
    indoorPrice: 6000,
    image: "https://images.unsplash.com/photo-1608039829572-78524f79c4c7?w=800&auto=format",
    category: "Salad",
    available: true,
    itemType: "item",
    basePrice: 7000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "SHAWARMA + SUSAGE",
    description: "Rich, tightly wrapped double-sausage chicken shawarma with creamy garlic mayonnaise sauce.",
    price: 6000,
    indoorPrice: 6000,
    image: "https://images.unsplash.com/photo-1561651823-34fed022540e?w=800&auto=format",
    category: "Fast Food",
    available: true,
    itemType: "item",
    basePrice: 6000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "WHITE RICE + OFEAKWU",
    description: "Fluffy steamed white rice served with Ofe Akwu (traditional Igbo palm nut stew) rich in local spices.",
    price: 7000,
    indoorPrice: 6000,
    image: "https://images.unsplash.com/photo-1586201375761-83865001e31c?w=800&auto=format",
    category: "Rice",
    available: true,
    itemType: "item",
    basePrice: 7000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "CHINESE FRIED RICE + SHREDDED B",
    description: "Chinese wok-fried rice tossed with shredded tender beef strips, carrots, green peas, and scallions.",
    price: 8000,
    indoorPrice: 7000,
    image: "https://images.unsplash.com/photo-1603133872878-685f588c7915?w=800&auto=format",
    category: "Rice",
    available: true,
    itemType: "item",
    basePrice: 8000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "COWTAIL",
    description: "Rich, tender cowtail cutlets, cooked in a delicious peppered sauce.",
    price: 7000,
    indoorPrice: 7000,
    image: "https://images.unsplash.com/photo-1544025162-d76694265947?w=800&auto=format",
    category: "Protein",
    available: true,
    itemType: "item",
    basePrice: 7000,
    kitchenStation: "grill",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "FRENCH FRIES WITH CHICKEN",
    description: "Golden French fries served with a crispy seasoned chicken drumstick or wing.",
    price: 8000,
    indoorPrice: 7000,
    image: "https://images.unsplash.com/photo-1569058242253-92a9c755a0ec?w=800&auto=format",
    category: "Fries",
    available: true,
    itemType: "item",
    basePrice: 8000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },

  // List 3 Items (16 unique items)
  {
    name: "OKRO SOUP",
    description: "Deliciously slimy traditional Okro (Okra) soup cooked with fresh vegetables and fish.",
    price: 6000,
    indoorPrice: 5000,
    image: "https://images.unsplash.com/photo-1541832676-9b763b0239ab?w=800&auto=format",
    category: "Soup",
    available: true,
    itemType: "item",
    basePrice: 6000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "ONLY SHAWARMA",
    description: "Single chicken shawarma wrap filled with sliced seasoned chicken and creamy garlic sauce.",
    price: 5000,
    indoorPrice: 5000,
    image: "https://images.unsplash.com/photo-1608219992759-8d74ed8d76eb?w=800&auto=format",
    category: "Fast Food",
    available: true,
    itemType: "item",
    basePrice: 5000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "ORA SOUP",
    description: "Authentic Nigerian Oha soup (Ora) thickened with cocoyam paste and flavored with local spices.",
    price: 6000,
    indoorPrice: 5000,
    image: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&auto=format",
    category: "Soup",
    available: true,
    itemType: "item",
    basePrice: 6000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "SPAGHETTI",
    description: "Flavorful Jollof or stir-fried spaghetti, rich in local spices.",
    price: 6000,
    indoorPrice: 5000,
    image: "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=800&auto=format",
    category: "Pasta",
    available: true,
    itemType: "item",
    basePrice: 6000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "UKWA + DRY FISH",
    description: "Traditional Igbo breadfruit porridge (Ukwa) cooked to perfection with dry fish chunks.",
    price: 6000,
    indoorPrice: 5000,
    image: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=800&auto=format",
    category: "Local Delicacy",
    available: true,
    itemType: "item",
    basePrice: 6000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "UNRIPE PLANTAIN + VEGETABLE STE",
    description: "Healthy boiled unripe plantain served with a rich and tasty vegetable stew.",
    price: 6000,
    indoorPrice: 5000,
    image: "https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=800&auto=format",
    category: "Local Delicacy",
    available: true,
    itemType: "item",
    basePrice: 6000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "VEGETABLE SALAD",
    description: "Fresh garden salad with crisp cucumbers, carrots, lettuce, and cabbage.",
    price: 6000,
    indoorPrice: 5000,
    image: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=800&auto=format",
    category: "Salad",
    available: true,
    itemType: "item",
    basePrice: 6000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "WHITE BEAN + VEGETABLE STEW",
    description: "Soft boiled white beans served with a rich, savory vegetable stew.",
    price: 6000,
    indoorPrice: 5000,
    image: "https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=800&auto=format",
    category: "Local Delicacy",
    available: true,
    itemType: "item",
    basePrice: 6000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "YAM + EGG SUACE",
    description: "Boiled or fried soft white yam served with a rich, seasoned fried egg and tomato sauce.",
    price: 5000,
    indoorPrice: 5000,
    image: "https://images.unsplash.com/photo-1525351484163-7529414344d8?w=800&auto=format",
    category: "Fries",
    available: true,
    itemType: "item",
    basePrice: 5000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "AFANG SOUP",
    description: "Rich, thick Efik soup cooked with wild Afang leaves and fresh waterleaves, loaded with assorted meats.",
    price: 7000,
    indoorPrice: 6000,
    image: "https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=800&auto=format",
    category: "Soup",
    available: true,
    itemType: "item",
    basePrice: 7000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "BAKED POTATOES",
    description: "Gently baked potato wedges, seasoned with light herbs.",
    price: 6000,
    indoorPrice: 6000,
    image: "https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=800&auto=format",
    category: "Fries",
    available: true,
    itemType: "item",
    basePrice: 6000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "CATFISH PEPPER SOUP + AGIDI",
    description: "Spicy catfish pepper soup infused with native scent leaves, served with soft wrapped Agidi.",
    price: 7000,
    indoorPrice: 6000,
    image: "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800&auto=format",
    category: "Soup",
    available: true,
    itemType: "item",
    basePrice: 7000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "CHICKEN BURGER",
    description: "Juicy seasoned chicken patty in a toasted sesame bun with lettuce and creamy mayonnaise.",
    price: 7000,
    indoorPrice: 6000,
    image: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800&auto=format",
    category: "Burger",
    available: true,
    itemType: "item",
    basePrice: 7000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "CHICKEN PEPPER SOUP + AGIDI",
    description: "Hot, spicy, and soothing chicken pepper soup accompanied by wrapped soft Agidi.",
    price: 7000,
    indoorPrice: 6000,
    image: "https://images.unsplash.com/photo-1547592180-85f173990554?w=800&auto=format",
    category: "Soup",
    available: true,
    itemType: "item",
    basePrice: 7000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "COW LEG PEPER SOUP + AGIDI",
    description: "Tender, gelatinous slow-cooked cow leg pepper soup served with a wrapped soft Agidi.",
    price: 7000,
    indoorPrice: 6000,
    image: "https://images.unsplash.com/photo-1543339308-43e59d6b73a6?w=800&auto=format",
    category: "Soup",
    available: true,
    itemType: "item",
    basePrice: 7000,
    kitchenStation: "kitchen",
    allowCustomPrice: false,
    restaurantId: "tricias-kitchen"
  },
  {
    name: "COW TAIL PEPER SOUP + AGIDI",
    description: "Rich, tender peppered cow tail soup in a hot local herb broth, served with wrapped smooth Agidi.",
    price: 7000,
    indoorPrice: 6000,
    image: "https://images.unsplash.com/photo-1544025162-d76694265947?w=800&auto=format",
    category: "Soup",
    available: true,
    itemType: "item",
    basePrice: 7000,
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

    // 3. Insert all 48 items
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
