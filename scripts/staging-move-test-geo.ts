/**
 * Move the synthetic staging restaurant and the synthetic customer's delivery
 * address to wherever physical-device QA is actually happening.
 *
 * The rider app filters unclaimed jobs to 5 km of the rider's live GPS. That
 * filter is real product behaviour and is NOT touched here — instead the two
 * synthetic ends of the journey are moved to the tester, so a real phone with
 * real GPS falls inside the existing radius and the tester can physically ride
 * the route.
 *
 * Refuses to run against anything but restoflow-staging, and refuses to touch a
 * restaurant that is not flagged synthetic. Prints the previous values so the
 * move can be undone.
 *
 *   npx tsx scripts/staging-move-test-geo.ts <lat> <lng>
 *   npx tsx scripts/staging-move-test-geo.ts --restore
 *
 * `--restore` puts both back to the seeded Lagos fixtures, so staging does not
 * keep whatever coordinates the last tester happened to be standing on.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.staging" });

const ALLOWED = ["restoflow-staging"];
const DENIED = ["restaurant-saas-64235", "demo-rest"];

const RESTAURANT_SLUG = "stg-trishas-kitchen";
const CUSTOMER_EMAIL = "staging.customer@example.invalid";
const ADDRESS_ID = "addr-home";

/** Metres per degree at the equator, close enough for a few kilometres. */
const KM_PER_DEG_LAT = 110.574;
function kmPerDegLng(lat: number) {
  return 111.32 * Math.cos((lat * Math.PI) / 180);
}

function haversineKm(a: [number, number], b: [number, number]) {
  const R = 6371;
  const p = Math.PI / 180;
  return (
    2 *
    R *
    Math.asin(
      Math.sqrt(
        0.5 -
          Math.cos((b[0] - a[0]) * p) / 2 +
          (Math.cos(a[0] * p) * Math.cos(b[0] * p) * (1 - Math.cos((b[1] - a[1]) * p))) / 2
      )
    )
  );
}

/** The seeded Lagos fixtures, from scripts/seed-staging-marketplace.ts. */
const SEEDED = {
  restaurant: {
    latitude: 6.4474,
    longitude: 3.4736,
    address: "14 Synthetic Close, Lekki Phase 1, Lagos",
    city: "Lekki",
    state: "Lagos",
  },
  address: {
    line1: "22 Synthetic Road, Lekki Phase 1, Lagos",
    location: { lat: 6.4413, lng: 3.4712 },
  },
};

async function main() {
  const lat = Number(process.argv[2]);
  const lng = Number(process.argv[3]);
  const restoring = process.argv[2] === "--restore";
  if (!restoring && (!Number.isFinite(lat) || !Number.isFinite(lng))) {
    throw new Error("Usage: staging-move-test-geo.ts <lat> <lng> | --restore");
  }

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID ?? "";
  if (DENIED.includes(projectId)) throw new Error(`REFUSING: "${projectId}" is not a QA project.`);
  if (!ALLOWED.includes(projectId)) throw new Error(`REFUSING: "${projectId}" is not restoflow-staging.`);

  const { initializeApp, cert } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const { getAuth } = await import("firebase-admin/auth");

  const app = initializeApp({
    credential: cert({
      projectId,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL!,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY!.replace(/\\n/g, "\n"),
    }),
  });
  const db = getFirestore(app);

  // Pickup sits a short way off the tester so there is a ride to the
  // restaurant; dropoff sits about a kilometre beyond it so there is a second
  // leg to ride. Both comfortably inside the rider's 5 km radius.
  const pickup: [number, number] = [lat + 0.4 / KM_PER_DEG_LAT, lng];
  const dropoff: [number, number] = [pickup[0], pickup[1] + 0.9 / kmPerDegLng(lat)];

  const rRef = db.collection("restaurants").doc(RESTAURANT_SLUG);
  const rSnap = await rRef.get();
  if (!rSnap.exists) throw new Error(`restaurant ${RESTAURANT_SLUG} not found`);
  const r = rSnap.data()!;
  if (r.isStagingSynthetic !== true) {
    throw new Error("REFUSING: restaurant is not flagged isStagingSynthetic");
  }

  console.log("PREVIOUS restaurant:", JSON.stringify({
    latitude: r.latitude, longitude: r.longitude, address: r.address, city: r.city, state: r.state,
  }));

  await rRef.update(
    restoring
      ? { ...SEEDED.restaurant, geoStatus: "confirmed", updatedAt: Date.now() }
      : {
          latitude: pickup[0],
          longitude: pickup[1],
          address: "QA Pickup Point (staging synthetic)",
          city: "QA Test Area",
          state: "QA Test Area",
          geoStatus: "confirmed",
          updatedAt: Date.now(),
        }
  );

  const uid = (await getAuth(app).getUserByEmail(CUSTOMER_EMAIL)).uid;
  const aRef = db.collection("customers").doc(uid).collection("addresses").doc(ADDRESS_ID);
  const aSnap = await aRef.get();
  if (!aSnap.exists) throw new Error(`address ${ADDRESS_ID} not found for ${CUSTOMER_EMAIL}`);
  const a = aSnap.data()!;
  console.log("PREVIOUS address:", JSON.stringify({ line1: a.line1, location: a.location }));

  await aRef.update(
    restoring
      ? SEEDED.address
      : {
          line1: "QA Delivery Point (staging synthetic)",
          location: { lat: dropoff[0], lng: dropoff[1] },
        }
  );

  if (restoring) {
    console.log("");
    console.log("RESTORED to the seeded Lagos fixtures.");
    process.exit(0);
  }

  console.log("");
  console.log("NEW pickup :", pickup[0].toFixed(6), pickup[1].toFixed(6));
  console.log("NEW dropoff:", dropoff[0].toFixed(6), dropoff[1].toFixed(6));
  console.log("tester → pickup  : " + haversineKm([lat, lng], pickup).toFixed(2) + " km");
  console.log("pickup → dropoff : " + haversineKm(pickup, dropoff).toFixed(2) + " km");
  console.log("tester → dropoff : " + haversineKm([lat, lng], dropoff).toFixed(2) + " km");
  process.exit(0);
}

main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
